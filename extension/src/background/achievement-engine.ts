import { evaluateAchievementRules, type RuleUnlockCandidate } from './achievement-rules';
import type { FeatureFlags } from '../shared/feature-flags';
import type { AchievementToastPayload } from '../shared/messages';

const STORAGE_PREFIX = 'achievementRuntimeState:';
const SESSION_GAP_MS = 5 * 60 * 1000;
const ROLLING_WINDOW_MS = 30 * 1000;
const MAX_UNLOCKED_EVENT_KEYS = 400;
const PERSIST_DEBOUNCE_MS = 1200;

interface RollingPoint {
  timestamp: number;
  meters: number;
  site: string;
}

export interface AchievementRuntimeState {
  dayKey: string;
  todayMeters: number;
  todayBySite: Record<string, number>;
  rollingWindow: RollingPoint[];
  sessionStartTs: number;
  sessionMeters: number;
  lastScrollTs: number;
  unlockedEventKeys: string[];
}

export interface AchievementRuntimeSnapshot {
  dayKey: string;
  todayMeters: number;
  todayBySite: Record<string, number>;
  rolling30Meters: number;
  sessionMeters: number;
  sessionDurationSec: number;
}

export interface AchievementUnlockEvent {
  userId: string;
  eventKey: string;
  trigger: {
    type: string;
    value: number;
    site: string | null;
    timestamp: number;
  };
  toast: AchievementToastPayload;
  runtimeSnapshot: AchievementRuntimeSnapshot;
  meta: Record<string, unknown>;
}

interface ScrollAchievementInput {
  userId: string;
  site: string;
  meters: number;
  timestamp: number;
}

const stateByUser = new Map<string, AchievementRuntimeState>();
const hydrateInFlight = new Map<string, Promise<void>>();
const hasHydrated = new Set<string>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

function stateStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function toDayKey(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createEmptyState(timestamp: number): AchievementRuntimeState {
  const dayKey = toDayKey(timestamp);
  return {
    dayKey,
    todayMeters: 0,
    todayBySite: {},
    rollingWindow: [],
    sessionStartTs: timestamp,
    sessionMeters: 0,
    lastScrollTs: timestamp,
    unlockedEventKeys: [],
  };
}

function normalizeState(raw: unknown, fallbackTimestamp: number): AchievementRuntimeState {
  if (!raw || typeof raw !== 'object') {
    return createEmptyState(fallbackTimestamp);
  }

  const candidate = raw as Partial<AchievementRuntimeState>;
  const state = createEmptyState(fallbackTimestamp);

  if (typeof candidate.dayKey === 'string') state.dayKey = candidate.dayKey;
  if (Number.isFinite(candidate.todayMeters)) state.todayMeters = Number(candidate.todayMeters);
  if (candidate.todayBySite && typeof candidate.todayBySite === 'object') {
    state.todayBySite = Object.fromEntries(
      Object.entries(candidate.todayBySite)
        .filter(([, meters]) => Number.isFinite(meters as number))
        .map(([site, meters]) => [site, Number(meters)]),
    );
  }

  if (Array.isArray(candidate.rollingWindow)) {
    state.rollingWindow = candidate.rollingWindow
      .filter((entry) => !!entry && typeof entry === 'object')
      .map((entry) => ({
        timestamp: Number((entry as RollingPoint).timestamp ?? 0),
        meters: Number((entry as RollingPoint).meters ?? 0),
        site: String((entry as RollingPoint).site ?? 'unknown').toLowerCase(),
      }))
      .filter((entry) => Number.isFinite(entry.timestamp) && Number.isFinite(entry.meters) && entry.meters > 0);
  }

  if (Number.isFinite(candidate.sessionStartTs)) state.sessionStartTs = Number(candidate.sessionStartTs);
  if (Number.isFinite(candidate.sessionMeters)) state.sessionMeters = Number(candidate.sessionMeters);
  if (Number.isFinite(candidate.lastScrollTs)) state.lastScrollTs = Number(candidate.lastScrollTs);
  if (Array.isArray(candidate.unlockedEventKeys)) {
    state.unlockedEventKeys = candidate.unlockedEventKeys
      .map((key) => String(key))
      .filter((key) => key.length > 0)
      .slice(-MAX_UNLOCKED_EVENT_KEYS);
  }

  return state;
}

function getOrCreateState(userId: string, timestamp: number): AchievementRuntimeState {
  const existing = stateByUser.get(userId);
  if (existing) return existing;
  const created = createEmptyState(timestamp);
  stateByUser.set(userId, created);
  return created;
}

function schedulePersist(userId: string) {
  if (persistTimers.has(userId)) return;
  const timerId = setTimeout(() => {
    persistTimers.delete(userId);
    const state = stateByUser.get(userId);
    if (!state) return;
    void chrome.storage.local.set({ [stateStorageKey(userId)]: state });
  }, PERSIST_DEBOUNCE_MS);
  persistTimers.set(userId, timerId);
}

async function hydrateState(userId: string, timestamp: number): Promise<void> {
  if (hasHydrated.has(userId)) return;
  const inFlight = hydrateInFlight.get(userId);
  if (inFlight) {
    await inFlight;
    return;
  }

  const hydration = (async () => {
    const result = await chrome.storage.local.get(stateStorageKey(userId));
    const restored = normalizeState(result[stateStorageKey(userId)], timestamp);

    const currentDayKey = toDayKey(timestamp);
    if (restored.dayKey !== currentDayKey) {
      restored.dayKey = currentDayKey;
      restored.todayMeters = 0;
      restored.todayBySite = {};
      restored.rollingWindow = [];
      restored.sessionStartTs = timestamp;
      restored.sessionMeters = 0;
    }

    stateByUser.set(userId, restored);
    hasHydrated.add(userId);
  })().finally(() => {
    hydrateInFlight.delete(userId);
  });

  hydrateInFlight.set(userId, hydration);
  await hydration;
}

function pruneRollingWindow(state: AchievementRuntimeState, timestamp: number) {
  const minTs = timestamp - ROLLING_WINDOW_MS;
  state.rollingWindow = state.rollingWindow.filter((point) => point.timestamp >= minTs);
}

function rollingMeters(state: AchievementRuntimeState): number {
  return state.rollingWindow.reduce((sum, point) => sum + point.meters, 0);
}

function buildSnapshot(state: AchievementRuntimeState, timestamp: number): AchievementRuntimeSnapshot {
  const sessionDurationSec = Math.max(0, (timestamp - state.sessionStartTs) / 1000);
  return {
    dayKey: state.dayKey,
    todayMeters: Number(state.todayMeters.toFixed(2)),
    todayBySite: { ...state.todayBySite },
    rolling30Meters: Number(rollingMeters(state).toFixed(2)),
    sessionMeters: Number(state.sessionMeters.toFixed(2)),
    sessionDurationSec: Number(sessionDurationSec.toFixed(2)),
  };
}

function toToastPayload(candidate: RuleUnlockCandidate): AchievementToastPayload {
  return {
    eventKey: candidate.eventKey,
    title: candidate.title,
    description: candidate.description,
    icon: candidate.icon,
    rarity: candidate.rarity,
    roastLine: candidate.roastLine,
    appScope: candidate.appScope,
  };
}

function markUnlocked(state: AchievementRuntimeState, eventKey: string): boolean {
  if (state.unlockedEventKeys.includes(eventKey)) return false;
  state.unlockedEventKeys.push(eventKey);
  if (state.unlockedEventKeys.length > MAX_UNLOCKED_EVENT_KEYS) {
    state.unlockedEventKeys = state.unlockedEventKeys.slice(-MAX_UNLOCKED_EVENT_KEYS);
  }
  return true;
}

export async function processScrollForAchievements(
  input: ScrollAchievementInput,
  flags: FeatureFlags,
): Promise<AchievementUnlockEvent[]> {
  if (!flags.aiAchievements && !flags.achievementToast) {
    return [];
  }

  const meters = Number(input.meters);
  if (!Number.isFinite(meters) || meters <= 0) return [];

  await hydrateState(input.userId, input.timestamp);
  const state = getOrCreateState(input.userId, input.timestamp);

  const currentDayKey = toDayKey(input.timestamp);
  if (state.dayKey !== currentDayKey) {
    state.dayKey = currentDayKey;
    state.todayMeters = 0;
    state.todayBySite = {};
    state.rollingWindow = [];
    state.sessionStartTs = input.timestamp;
    state.sessionMeters = 0;
  }

  if ((input.timestamp - state.lastScrollTs) > SESSION_GAP_MS) {
    state.sessionStartTs = input.timestamp;
    state.sessionMeters = 0;
    state.rollingWindow = [];
  }

  pruneRollingWindow(state, input.timestamp);
  const previousRolling = rollingMeters(state);
  const previousTodayMeters = state.todayMeters;
  const previousTodayBySite = { ...state.todayBySite };
  const previousSessionMeters = state.sessionMeters;
  const previousSessionDurationSec = Math.max(0, (input.timestamp - state.sessionStartTs) / 1000);

  state.todayMeters += meters;
  state.todayBySite[input.site] = (state.todayBySite[input.site] ?? 0) + meters;
  state.sessionMeters += meters;
  state.lastScrollTs = input.timestamp;
  state.rollingWindow.push({
    timestamp: input.timestamp,
    meters,
    site: input.site,
  });
  pruneRollingWindow(state, input.timestamp);

  const nowRolling = rollingMeters(state);
  const nowSessionDurationSec = Math.max(0, (input.timestamp - state.sessionStartTs) / 1000);

  const candidates = evaluateAchievementRules({
    dayKey: state.dayKey,
    site: input.site,
    timestamp: input.timestamp,
    todayMeters: state.todayMeters,
    todayBySite: state.todayBySite,
    rolling30Meters: nowRolling,
    sessionMeters: state.sessionMeters,
    sessionDurationSec: nowSessionDurationSec,
    previousTodayMeters,
    previousTodayBySite,
    previousRolling30Meters: previousRolling,
    previousSessionMeters,
    previousSessionDurationSec,
  });

  const unlocks: AchievementUnlockEvent[] = [];
  for (const candidate of candidates) {
    if (!markUnlocked(state, candidate.eventKey)) continue;
    unlocks.push({
      userId: input.userId,
      eventKey: candidate.eventKey,
      trigger: {
        type: candidate.triggerType,
        value: candidate.triggerValue,
        site: candidate.appScope,
        timestamp: input.timestamp,
      },
      toast: toToastPayload(candidate),
      runtimeSnapshot: buildSnapshot(state, input.timestamp),
      meta: candidate.meta,
    });
  }

  schedulePersist(input.userId);
  return unlocks;
}
