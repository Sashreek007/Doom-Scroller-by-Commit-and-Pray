import type { ScrollBatch } from '../shared/types';
import type { GetStatsResponse } from '../shared/messages';
import { toCanonicalSite } from '../shared/constants';

export interface DbStatsSnapshot {
  dayKey: string;
  todayMeters: number;
  todayBysite: Record<string, number>;
  totalMeters: number;
  totalBysite: Record<string, number>;
  allTimeBysiteUpdatedAt: number;
  updatedAt: number;
}

const dbStatsCache = new Map<string, DbStatsSnapshot>();

function toDayKeyFromDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toDayKeyFromMs(ms: number): string {
  return toDayKeyFromDate(new Date(ms));
}

export function getCurrentDayKey(): string {
  return toDayKeyFromDate(new Date());
}

export function getDayStartIso(): string {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return todayStart.toISOString();
}

export function getCachedDbStats(userId: string, currentDayKey: string): DbStatsSnapshot {
  const cached = dbStatsCache.get(userId);
  if (!cached) {
    return {
      dayKey: currentDayKey,
      todayMeters: 0,
      todayBysite: {},
      totalMeters: 0,
      totalBysite: {},
      allTimeBysiteUpdatedAt: 0,
      updatedAt: 0,
    };
  }

  if (cached.dayKey !== currentDayKey) {
    const rolled: DbStatsSnapshot = {
      ...cached,
      dayKey: currentDayKey,
      todayMeters: 0,
      todayBysite: {},
    };
    dbStatsCache.set(userId, rolled);
    return rolled;
  }

  return cached;
}

export function setDbStatsFromServer(
  userId: string,
  dayKey: string,
  response: GetStatsResponse,
  allTimeBysiteUpdatedAt?: number,
) {
  const previous = dbStatsCache.get(userId);
  dbStatsCache.set(userId, {
    dayKey,
    todayMeters: response.todayMeters,
    todayBysite: { ...response.todayBysite },
    totalMeters: response.totalMeters,
    totalBysite: { ...response.totalBysite },
    allTimeBysiteUpdatedAt: allTimeBysiteUpdatedAt ?? previous?.allTimeBysiteUpdatedAt ?? 0,
    updatedAt: Date.now(),
  });
}

export function applySyncedBatchesToDbCache(userId: string, batches: ScrollBatch[]) {
  const currentDayKey = getCurrentDayKey();
  const cached = getCachedDbStats(userId, currentDayKey);
  const updated: DbStatsSnapshot = {
    ...cached,
    todayBysite: { ...cached.todayBysite },
    totalBysite: { ...cached.totalBysite },
  };

  for (const batch of batches) {
    const meters = Number(batch.totalMeters || 0);
    if (!Number.isFinite(meters) || meters <= 0) continue;

    updated.totalMeters += meters;
    const site = toCanonicalSite(batch.site);
    if (!site) continue;
    updated.totalBysite[site] = (updated.totalBysite[site] ?? 0) + meters;

    // Only increment today's cache when the batch end timestamp is today (local time).
    if (toDayKeyFromMs(batch.lastUpdate) === currentDayKey) {
      updated.todayMeters += meters;
      updated.todayBysite[site] = (updated.todayBysite[site] ?? 0) + meters;
    }
  }

  updated.updatedAt = Date.now();
  dbStatsCache.set(userId, updated);
}
