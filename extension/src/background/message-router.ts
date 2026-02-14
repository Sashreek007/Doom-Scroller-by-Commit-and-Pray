// Routes messages from content scripts and popup to appropriate handlers

import { addScrollData, getBatches } from './scroll-aggregator';
import type {
  BattleRoundResultSummary,
  ExtensionMessage,
  GetBattleTimerResponse,
  GetStatsResponse,
} from '../shared/messages';
import { getSupabase } from './supabase-client';
import { toCanonicalSite } from '../shared/constants';
import { triggerOpportunisticSync } from './alarm-handlers';
import {
  getCachedDbStats,
  getCurrentDayKey,
  getDayStartIso,
  setDbStatsFromServer,
} from './stats-cache';
import { getBackgroundFeatureFlags } from './feature-flags';
import { processScrollForAchievements } from './achievement-engine';
import { enqueueAchievementJob, triggerAchievementQueueProcessing } from './achievement-queue';

const DB_STATS_REFRESH_INTERVAL_MS = 5000;
const INITIAL_DB_REFRESH_WAIT_MS = 250;
const BATTLE_TIMER_CACHE_TTL_MS = 1500;

const dbRefreshInFlight = new Map<string, Promise<void>>();
const battleTimerCache = new Map<string, { updatedAt: number; value: GetBattleTimerResponse }>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getActiveUserId(): Promise<string | null> {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

function parseBattleRoundResultSummary(
  row: {
    id: unknown;
    room_key: unknown;
    selected_game_type: unknown;
    round_result: unknown;
  },
): BattleRoundResultSummary | null {
  if (!row.round_result || typeof row.round_result !== 'object') return null;
  const value = row.round_result as Record<string, unknown>;
  const settledAt = typeof value.settledAt === 'string' ? value.settledAt : null;
  const pot = Number(value.pot);
  const betCoins = Number(value.betCoins);
  if (!settledAt || !Number.isFinite(pot) || !Number.isFinite(betCoins)) return null;

  const winnerIds = Array.isArray(value.winnerIds)
    ? value.winnerIds.filter((entry): entry is string => typeof entry === 'string')
    : [];

  const payouts: Record<string, number> = {};
  if (value.payouts && typeof value.payouts === 'object') {
    for (const [key, raw] of Object.entries(value.payouts as Record<string, unknown>)) {
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) payouts[key] = numeric;
    }
  }

  return {
    roomId: typeof row.id === 'string' ? row.id : '',
    roomKey: typeof row.room_key === 'string' ? row.room_key : '',
    gameType: typeof row.selected_game_type === 'string' ? row.selected_game_type : null,
    settledAt,
    winnerIds,
    payouts,
    pot: Math.max(0, Math.floor(pot)),
    betCoins: Math.max(0, Math.floor(betCoins)),
  };
}

async function fetchBattleTimerFromDb(userId: string): Promise<GetBattleTimerResponse> {
  const supabase = getSupabase();
  const { data: memberships, error: membershipError } = await supabase
    .from('battle_room_members')
    .select('room_id, joined_at')
    .eq('user_id', userId)
    .eq('status', 'joined')
    .order('joined_at', { ascending: false })
    .limit(12);

  if (membershipError) return { active: false, viewerUserId: userId };
  const roomIds = (memberships ?? [])
    .map((row) => row.room_id as string | null)
    .filter((value): value is string => Boolean(value));
  if (roomIds.length === 0) return { active: false, viewerUserId: userId };

  const { data: rooms, error: roomError } = await supabase
    .from('battle_rooms')
    .select('id, room_key, status, selected_game_type, round_started_at, round_ends_at, timer_seconds, round_result, updated_at')
    .in('id', roomIds)
    .order('updated_at', { ascending: false });

  if (roomError || !rooms || rooms.length === 0) return { active: false, viewerUserId: userId };

  let latestRoundResult: BattleRoundResultSummary | null = null;
  for (const room of rooms) {
    const parsed = parseBattleRoundResultSummary(room);
    if (parsed) {
      latestRoundResult = parsed;
      break;
    }
  }

  const nowMs = Date.now();
  const activeRoom = rooms.find((room) => {
    if (room.status !== 'active' || !room.round_started_at || !room.round_ends_at) return false;
    const endMs = Date.parse(room.round_ends_at as string);
    return Number.isFinite(endMs) && endMs > nowMs;
  });
  if (!activeRoom) {
    return {
      active: false,
      viewerUserId: userId,
      latestRoundResult,
    };
  }

  return {
    active: true,
    viewerUserId: userId,
    roomId: activeRoom.id as string,
    roomKey: activeRoom.room_key as string,
    gameType: (activeRoom.selected_game_type as string | null) ?? null,
    roundStartedAt: activeRoom.round_started_at as string,
    roundEndsAt: activeRoom.round_ends_at as string,
    timerSeconds: Number(activeRoom.timer_seconds ?? 0),
    latestRoundResult,
  };
}

async function getBattleTimer(userId: string): Promise<GetBattleTimerResponse> {
  const cached = battleTimerCache.get(userId);
  const now = Date.now();
  if (cached && (now - cached.updatedAt) < BATTLE_TIMER_CACHE_TTL_MS) {
    return cached.value;
  }

  const value = await fetchBattleTimerFromDb(userId);
  battleTimerCache.set(userId, { updatedAt: now, value });
  return value;
}

function buildTodayFromSessions(
  sessions: Array<{ site: string; meters_scrolled: number | string | null }>,
): { todayMeters: number; todayBysite: Record<string, number> } {
  const todayBysite: Record<string, number> = {};
  let todayMeters = 0;

  for (const row of sessions) {
    const site = toCanonicalSite(row.site);
    if (!site) continue;
    const meters = Number(row.meters_scrolled ?? 0);
    if (!Number.isFinite(meters)) continue;
    todayMeters += meters;
    todayBysite[site] = (todayBysite[site] ?? 0) + meters;
  }

  return {
    todayMeters,
    todayBysite,
  };
}

function requestDbRefresh(userId: string, dayKey: string, dayStartIso: string): Promise<void> {
  const existing = dbRefreshInFlight.get(userId);
  if (existing) return existing;

  const promise = (async () => {
    const supabase = getSupabase();
    const [{ data: todaySessions }, { data: profile }] = await Promise.all([
      supabase
        .from('scroll_sessions')
        .select('site, meters_scrolled')
        .eq('user_id', userId)
        .gte('created_at', dayStartIso),
      supabase
        .from('profiles')
        .select('total_meters_scrolled')
        .eq('id', userId)
        .single(),
    ]);

    const today = buildTodayFromSessions(
      (todaySessions ?? []) as Array<{ site: string; meters_scrolled: number | string | null }>,
    );
    const totalMeters = Number(profile?.total_meters_scrolled ?? 0);

    setDbStatsFromServer(userId, dayKey, {
      todayMeters: parseFloat(today.todayMeters.toFixed(2)),
      todayBysite: today.todayBysite,
      totalMeters: parseFloat(totalMeters.toFixed(2)),
    });
  })().finally(() => {
    dbRefreshInFlight.delete(userId);
  });

  dbRefreshInFlight.set(userId, promise);
  return promise;
}

async function processScrollAchievements(
  site: string,
  meters: number,
  timestamp: number,
  tabId?: number,
): Promise<void> {
  const userId = await getActiveUserId();
  if (!userId) return;

  const flags = getBackgroundFeatureFlags();
  const unlocks = await processScrollForAchievements(
    {
      userId,
      site,
      meters,
      timestamp,
    },
    flags,
  );

  if (unlocks.length === 0) return;

  for (const unlock of unlocks) {
    if (flags.achievementToast && typeof tabId === 'number') {
      void chrome.tabs.sendMessage(tabId, {
        type: 'ACHIEVEMENT_TOAST',
        payload: unlock.toast,
      }).catch(() => {
        // Tab may no longer have content script attached.
      });
    }

    await enqueueAchievementJob(unlock);
  }

  triggerAchievementQueueProcessing();
}

export function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): boolean {
  switch (message.type) {
    case 'SCROLL_UPDATE': {
      const { site, pixels, meters, timestamp } = message.payload;
      const canonicalSite = toCanonicalSite(site);
      if (
        !canonicalSite
        || !Number.isFinite(pixels)
        || !Number.isFinite(meters)
        || pixels <= 0
        || meters <= 0
      ) {
        sendResponse({ ok: false });
        return false;
      }

      addScrollData(canonicalSite, pixels, meters);
      triggerOpportunisticSync();
      void processScrollAchievements(canonicalSite, meters, timestamp, sender.tab?.id);

      sendResponse({ ok: true });
      return false; // synchronous response
    }

    case 'GET_STATS': {
      // Async: fetch stats from Supabase + merge local unsynced data
      getStats().then(sendResponse).catch(() => {
        sendResponse({ todayMeters: 0, todayBysite: {}, totalMeters: 0 });
      });
      return true; // async response
    }

    case 'GET_BATTLE_TIMER': {
      getActiveUserId()
        .then((userId) => (userId ? getBattleTimer(userId) : { active: false }))
        .then(sendResponse)
        .catch(() => {
          sendResponse({ active: false });
        });
      return true;
    }

    default:
      return false;
  }
}

async function getStats(): Promise<GetStatsResponse> {
  // Always include local unsynced batches so data shows immediately
  const localBatches = getBatches();
  let localMeters = 0;
  const localBysite: Record<string, number> = {};
  for (const [rawSite, batch] of localBatches) {
    const site = toCanonicalSite(rawSite);
    if (!site) continue;
    localMeters += batch.totalMeters;
    localBysite[site] = (localBysite[site] ?? 0) + batch.totalMeters;
  }

  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    // Not logged in — just return local data
    return {
      todayMeters: parseFloat(localMeters.toFixed(2)),
      todayBysite: localBysite,
      totalMeters: parseFloat(localMeters.toFixed(2)),
    };
  }

  const userId = session.user.id;
  const dayKey = getCurrentDayKey();
  const dayStartIso = getDayStartIso();

  let cached = getCachedDbStats(userId, dayKey);
  const isUninitialized = cached.updatedAt === 0;
  const isStale = (Date.now() - cached.updatedAt) > DB_STATS_REFRESH_INTERVAL_MS;

  if (isUninitialized) {
    await Promise.race([
      requestDbRefresh(userId, dayKey, dayStartIso),
      sleep(INITIAL_DB_REFRESH_WAIT_MS),
    ]);
  } else if (isStale) {
    void requestDbRefresh(userId, dayKey, dayStartIso);
  }

  cached = getCachedDbStats(userId, dayKey);

  const todayBysite: Record<string, number> = { ...cached.todayBysite };
  for (const [site, meters] of Object.entries(localBysite)) {
    todayBysite[site] = (todayBysite[site] ?? 0) + meters;
  }

  const todayMeters = cached.todayMeters + localMeters;
  const totalMeters = cached.totalMeters + localMeters;

  return {
    todayMeters: parseFloat(todayMeters.toFixed(2)),
    todayBysite,
    totalMeters: parseFloat(totalMeters.toFixed(2)),
  };
}
