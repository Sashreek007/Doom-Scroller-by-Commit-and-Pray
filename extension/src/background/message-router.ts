// Routes messages from content scripts and popup to appropriate handlers

import { addScrollData, getBatches } from './scroll-aggregator';
import type { ExtensionMessage, GetStatsResponse } from '../shared/messages';
import { getSupabase } from './supabase-client';
import { toCanonicalSite } from '../shared/constants';
import { triggerOpportunisticSync } from './alarm-handlers';

const TOTAL_CACHE_TTL_MS = 60000;
const totalMetersCache = new Map<string, { value: number; updatedAt: number }>();

export function handleMessage(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): boolean {
  switch (message.type) {
    case 'SCROLL_UPDATE': {
      const { site, pixels, meters } = message.payload;
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

  // Get today's start in local time
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: todaySessions } = await supabase
    .from('scroll_sessions')
    .select('site, meters_scrolled')
    .eq('user_id', session.user.id)
    .gte('created_at', todayStart.toISOString());

  const todayBysite: Record<string, number> = {};
  let todayMeters = 0;

  if (todaySessions) {
    for (const s of todaySessions) {
      const site = toCanonicalSite(s.site);
      if (!site) continue;
      const meters = Number(s.meters_scrolled);
      todayMeters += meters;
      todayBysite[site] = (todayBysite[site] ?? 0) + meters;
    }
  }

  // Merge local unsynced data on top of Supabase data
  for (const [site, meters] of Object.entries(localBysite)) {
    todayMeters += meters;
    todayBysite[site] = (todayBysite[site] ?? 0) + meters;
  }

  // Get total from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('total_meters_scrolled')
    .eq('id', session.user.id)
    .single();

  const totalFromDb = profile ? Number(profile.total_meters_scrolled) : 0;
  const accurateTotal = await getAccurateTotalMeters(session.user.id);
  const baseTotal = accurateTotal ?? totalFromDb;

  // Self-heal drifted profile totals in background (best effort).
  if (accurateTotal !== null && Math.abs(accurateTotal - totalFromDb) > 0.01) {
    void supabase
      .from('profiles')
      .update({ total_meters_scrolled: parseFloat(accurateTotal.toFixed(2)) })
      .eq('id', session.user.id);
  }

  return {
    todayMeters: parseFloat(todayMeters.toFixed(2)),
    todayBysite,
    totalMeters: parseFloat((baseTotal + localMeters).toFixed(2)),
  };
}

async function getAccurateTotalMeters(userId: string): Promise<number | null> {
  const cached = totalMetersCache.get(userId);
  if (cached && (Date.now() - cached.updatedAt) < TOTAL_CACHE_TTL_MS) {
    return cached.value;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('scroll_sessions')
    .select('meters_scrolled')
    .eq('user_id', userId);

  if (error || !data) {
    return null;
  }

  const total = data.reduce((sum, row) => sum + Number(row.meters_scrolled ?? 0), 0);
  totalMetersCache.set(userId, {
    value: total,
    updatedAt: Date.now(),
  });
  return total;
}
