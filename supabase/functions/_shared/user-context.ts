import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.49.1';

interface RawProfile {
  id: string;
  username: string;
  display_name: string;
  total_meters_scrolled: number | string | null;
  created_at: string;
}

interface RawScrollSession {
  site: string;
  meters_scrolled: number | string | null;
  session_start: string;
  session_end: string;
  created_at: string;
}

interface RawAchievement {
  title: string;
  earned_at: string;
}

export interface UserBehaviorContext {
  userId: string;
  username: string;
  displayName: string;
  profileCreatedAt: string;
  totalMeters: number;
  recentMeters: number;
  topSite: string | null;
  siteMix: Record<string, number>;
  uniqueSites: number;
  avgSessionMeters: number;
  avgSessionDurationSec: number;
  maxBurstMeters5Min: number;
  activeHourBuckets: number[];
  activeDays: number;
  streakDays: number;
  recentAchievementTitles: string[];
  rank: number | null;
  percentile: number | null;
  sampleWindowDays: number;
}

function toFiniteNumber(value: number | string | null | undefined): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function dayKey(ts: number): string {
  const date = new Date(ts);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function computeStreak(dayKeys: string[]): number {
  if (dayKeys.length === 0) return 0;
  const unique = Array.from(new Set(dayKeys)).sort().reverse();
  let streak = 0;
  let cursor = new Date(`${unique[0]}T00:00:00.000Z`).getTime();

  for (const key of unique) {
    const expected = dayKey(cursor);
    if (key !== expected) break;
    streak += 1;
    cursor -= 24 * 60 * 60 * 1000;
  }

  return streak;
}

function computeBurstMeters5Min(sessions: RawScrollSession[]): number {
  if (sessions.length === 0) return 0;

  const points = sessions
    .map((session) => ({
      at: new Date(session.created_at).getTime(),
      meters: Math.max(0, toFiniteNumber(session.meters_scrolled)),
    }))
    .filter((point) => Number.isFinite(point.at) && point.at > 0)
    .sort((a, b) => a.at - b.at);

  let best = 0;
  let left = 0;
  let windowMeters = 0;

  for (let right = 0; right < points.length; right += 1) {
    windowMeters += points[right].meters;
    while (points[right].at - points[left].at > 5 * 60 * 1000) {
      windowMeters -= points[left].meters;
      left += 1;
    }
    if (windowMeters > best) best = windowMeters;
  }

  return best;
}

function computeSiteMix(sessions: RawScrollSession[]): { siteMix: Record<string, number>; topSite: string | null; recentMeters: number } {
  const rawBySite: Record<string, number> = {};
  let recentMeters = 0;

  for (const session of sessions) {
    const site = (session.site || 'unknown').toLowerCase();
    const meters = Math.max(0, toFiniteNumber(session.meters_scrolled));
    if (meters <= 0) continue;
    rawBySite[site] = (rawBySite[site] ?? 0) + meters;
    recentMeters += meters;
  }

  const siteEntries = Object.entries(rawBySite).sort((a, b) => b[1] - a[1]);
  const topSite = siteEntries.length > 0 ? siteEntries[0][0] : null;

  const siteMix: Record<string, number> = {};
  if (recentMeters > 0) {
    for (const [site, meters] of siteEntries) {
      siteMix[site] = Number((meters / recentMeters).toFixed(4));
    }
  }

  return { siteMix, topSite, recentMeters };
}

interface ContextOptions {
  includeRank?: boolean;
  sampleWindowDays?: number;
}

interface AuthUserLike {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

function normalizeBaseUsername(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (normalized.length >= 3) return normalized.slice(0, 20);
  return `user_${Math.random().toString(36).slice(2, 6)}`;
}

function buildDisplayName(user: AuthUserLike): string {
  const fromMeta = typeof user.user_metadata?.display_name === 'string'
    ? user.user_metadata.display_name.trim()
    : '';
  if (fromMeta.length > 0) return fromMeta.slice(0, 40);

  const fromEmail = (user.email ?? '').split('@')[0].trim();
  if (fromEmail.length > 0) return fromEmail.slice(0, 40);
  return 'Doom Scroller';
}

export async function ensureProfileExistsForUser(
  supabase: SupabaseClient,
  user: AuthUserLike,
): Promise<void> {
  const existing = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (existing.data?.id) return;

  const emailLocal = (user.email ?? '').split('@')[0] ?? '';
  const base = normalizeBaseUsername(emailLocal || `user_${user.id.slice(0, 6)}`);
  const displayName = buildDisplayName(user);
  const candidates = [
    base.slice(0, 20),
    `${base.slice(0, 15)}_${user.id.replace(/-/g, '').slice(0, 4)}`.slice(0, 20),
    `user_${user.id.replace(/-/g, '').slice(0, 8)}`.slice(0, 20),
  ];

  for (const username of candidates) {
    const insertRes = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        username,
        display_name: displayName,
        is_public: true,
      });

    if (!insertRes.error) return;
    const message = (insertRes.error.message ?? '').toLowerCase();
    const isUniqueConflict = insertRes.error.code === '23505' || message.includes('duplicate key');
    if (!isUniqueConflict) break;
  }

  // A final read helps if profile was created concurrently by trigger/session race.
  const finalRead = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (finalRead.data?.id) return;
  throw new Error(existing.error?.message || 'Could not ensure profile row');
}

export async function loadUserBehaviorContext(
  supabase: SupabaseClient,
  userId: string,
  options: ContextOptions = {},
): Promise<UserBehaviorContext> {
  const sampleWindowDays = Math.max(3, Math.min(90, options.sampleWindowDays ?? 30));
  const sinceIso = new Date(Date.now() - sampleWindowDays * 24 * 60 * 60 * 1000).toISOString();

  const [profileRes, sessionsRes, achievementsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, display_name, total_meters_scrolled, created_at')
      .eq('id', userId)
      .single(),
    supabase
      .from('scroll_sessions')
      .select('site, meters_scrolled, session_start, session_end, created_at')
      .eq('user_id', userId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(800),
    supabase
      .from('achievements')
      .select('title, earned_at')
      .eq('user_id', userId)
      .order('earned_at', { ascending: false })
      .limit(20),
  ]);

  if (profileRes.error || !profileRes.data) {
    throw new Error(profileRes.error?.message ?? 'Profile unavailable');
  }

  const profile = profileRes.data as RawProfile;
  const sessions = ((sessionsRes.data ?? []) as RawScrollSession[])
    .filter((row) => !!row.created_at);
  const achievements = (achievementsRes.data ?? []) as RawAchievement[];

  const { siteMix, topSite, recentMeters } = computeSiteMix(sessions);

  let sessionDurationSumSec = 0;
  let sessionMetersSum = 0;
  for (const session of sessions) {
    const start = new Date(session.session_start).getTime();
    const end = new Date(session.session_end).getTime();
    const duration = Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? (end - start) / 1000
      : 0;
    sessionDurationSumSec += duration;
    sessionMetersSum += Math.max(0, toFiniteNumber(session.meters_scrolled));
  }

  const activeDayKeys = sessions.map((session) => dayKey(new Date(session.created_at).getTime()));
  const activeHourSet = new Set<number>();
  for (const session of sessions) {
    const hour = new Date(session.created_at).getUTCHours();
    activeHourSet.add(hour);
  }

  const totalMeters = Math.max(0, toFiniteNumber(profile.total_meters_scrolled));
  const avgSessionMeters = sessions.length > 0 ? sessionMetersSum / sessions.length : 0;
  const avgSessionDurationSec = sessions.length > 0 ? sessionDurationSumSec / sessions.length : 0;

  let rank: number | null = null;
  let percentile: number | null = null;
  if (options.includeRank) {
    const [countAllRes, countAboveRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true }),
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gt('total_meters_scrolled', totalMeters),
    ]);

    const visibleCount = typeof countAllRes.count === 'number' ? countAllRes.count : null;
    const aboveCount = typeof countAboveRes.count === 'number' ? countAboveRes.count : null;

    if (visibleCount && aboveCount !== null) {
      rank = aboveCount + 1;
      if (visibleCount > 1) {
        percentile = Number((((visibleCount - rank) / (visibleCount - 1)) * 100).toFixed(1));
      } else {
        percentile = 100;
      }
    }
  }

  return {
    userId,
    username: profile.username,
    displayName: profile.display_name,
    profileCreatedAt: profile.created_at,
    totalMeters,
    recentMeters,
    topSite,
    siteMix,
    uniqueSites: Object.keys(siteMix).length,
    avgSessionMeters: Number(avgSessionMeters.toFixed(2)),
    avgSessionDurationSec: Number(avgSessionDurationSec.toFixed(2)),
    maxBurstMeters5Min: Number(computeBurstMeters5Min(sessions).toFixed(2)),
    activeHourBuckets: Array.from(activeHourSet).sort((a, b) => a - b),
    activeDays: new Set(activeDayKeys).size,
    streakDays: computeStreak(activeDayKeys),
    recentAchievementTitles: achievements.map((row) => row.title).filter(Boolean).slice(0, 8),
    rank,
    percentile,
    sampleWindowDays,
  };
}
