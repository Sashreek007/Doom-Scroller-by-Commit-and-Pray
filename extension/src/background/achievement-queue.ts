import { getSupabase } from './supabase-client';
import { getBackgroundFeatureFlags } from './feature-flags';
import type { AchievementUnlockEvent } from './achievement-engine';

const STORAGE_KEY = 'achievementJobsQueue';
const RETRY_DELAYS_MS = [2000, 10000, 30000, 120000, 300000] as const;
const PROCESS_COOLDOWN_MS = 2000;

type QueueRarity = 'common' | 'rare' | 'epic' | 'legendary';

interface AchievementQueueJob {
  userId: string;
  eventKey: string;
  trigger: {
    type: string;
    value: number;
    site: string | null;
    timestamp: number;
  };
  runtimeSnapshot: {
    dayKey: string;
    todayMeters: number;
    todayBySite: Record<string, number>;
    rolling30Meters: number;
    sessionMeters: number;
    sessionDurationSec: number;
  };
  toast: {
    title: string;
    description: string;
    icon: string;
    rarity: QueueRarity;
    roastLine: string;
    appScope?: string | null;
  };
  meta: Record<string, unknown>;
  attempt: number;
  nextAttemptAt: number;
  createdAt: number;
}

let jobs: AchievementQueueJob[] = [];
let queueHydrated = false;
let processInFlight = false;
let lastProcessAt = 0;

function clampText(input: string, maxLength: number, fallback: string): string {
  const normalized = String(input ?? '').trim();
  if (!normalized) return fallback;
  return normalized.slice(0, maxLength);
}

function nextRetryDelay(attempt: number): number {
  const index = Math.min(Math.max(attempt - 1, 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index];
}

function normalizeRarity(value: unknown): QueueRarity {
  if (value === 'legendary' || value === 'epic' || value === 'rare') return value;
  return 'common';
}

function normalizeJobs(value: unknown): AchievementQueueJob[] {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .filter((entry) => !!entry && typeof entry === 'object')
    .map((entry) => entry as Partial<AchievementQueueJob>)
    .filter((entry) => typeof entry.userId === 'string' && typeof entry.eventKey === 'string')
    .map((entry) => ({
      userId: String(entry.userId),
      eventKey: String(entry.eventKey),
      trigger: {
        type: clampText(String(entry.trigger?.type ?? 'scroll_pattern'), 64, 'scroll_pattern'),
        value: Number(entry.trigger?.value ?? 0),
        site: entry.trigger?.site ? String(entry.trigger.site).toLowerCase() : null,
        timestamp: Number(entry.trigger?.timestamp ?? Date.now()),
      },
      runtimeSnapshot: {
        dayKey: clampText(String(entry.runtimeSnapshot?.dayKey ?? ''), 32, ''),
        todayMeters: Number(entry.runtimeSnapshot?.todayMeters ?? 0),
        todayBySite: (entry.runtimeSnapshot?.todayBySite && typeof entry.runtimeSnapshot.todayBySite === 'object')
          ? Object.fromEntries(
            Object.entries(entry.runtimeSnapshot.todayBySite as Record<string, number>)
              .filter(([, meters]) => Number.isFinite(meters))
              .map(([site, meters]) => [site, Number(meters)]),
          )
          : {},
        rolling30Meters: Number(entry.runtimeSnapshot?.rolling30Meters ?? 0),
        sessionMeters: Number(entry.runtimeSnapshot?.sessionMeters ?? 0),
        sessionDurationSec: Number(entry.runtimeSnapshot?.sessionDurationSec ?? 0),
      },
      toast: {
        title: clampText(String(entry.toast?.title ?? 'Doom Achievement'), 64, 'Doom Achievement'),
        description: clampText(String(entry.toast?.description ?? ''), 200, ''),
        icon: clampText(String(entry.toast?.icon ?? '🏆'), 4, '🏆'),
        rarity: normalizeRarity(entry.toast?.rarity),
        roastLine: clampText(String(entry.toast?.roastLine ?? ''), 220, ''),
        appScope: entry.toast?.appScope ? String(entry.toast.appScope) : null,
      },
      meta: entry.meta && typeof entry.meta === 'object' ? entry.meta as Record<string, unknown> : {},
      attempt: Number(entry.attempt ?? 0),
      nextAttemptAt: Number(entry.nextAttemptAt ?? Date.now()),
      createdAt: Number(entry.createdAt ?? Date.now()),
    }))
    .filter((entry) => Number.isFinite(entry.nextAttemptAt) && Number.isFinite(entry.createdAt));

  return normalized;
}

async function hydrateQueue() {
  if (queueHydrated) return;
  const result = await chrome.storage.local.get(STORAGE_KEY);
  jobs = normalizeJobs(result[STORAGE_KEY]);
  queueHydrated = true;
}

async function persistQueue() {
  await chrome.storage.local.set({ [STORAGE_KEY]: jobs });
}

function queueKey(job: { userId: string; eventKey: string }): string {
  return `${job.userId}::${job.eventKey}`;
}

function hasJob(userId: string, eventKey: string): boolean {
  const key = `${userId}::${eventKey}`;
  return jobs.some((job) => queueKey(job) === key);
}

function buildDeterministicPayload(job: AchievementQueueJob) {
  return {
    user_id: job.userId,
    trigger_type: clampText(job.trigger.type, 64, 'scroll_pattern'),
    trigger_value: Number.isFinite(job.trigger.value) ? Number(job.trigger.value) : 0,
    title: clampText(job.toast.title, 64, 'Doom Achievement'),
    description: clampText(job.toast.description || job.toast.roastLine, 180, 'You unlocked a doomscroll achievement.'),
    icon: clampText(job.toast.icon, 4, '🏆'),
    earned_at: new Date().toISOString(),
    event_key: clampText(job.eventKey, 180, `event_${Date.now()}`),
    rarity: job.toast.rarity,
    app_scope: job.toast.appScope ?? job.trigger.site,
    meta: {
      roast_line: job.toast.roastLine,
      trigger: job.trigger,
      runtime_snapshot: job.runtimeSnapshot,
      rule_meta: job.meta,
    },
    source: 'rule',
  };
}

async function insertDeterministicAchievement(job: AchievementQueueJob): Promise<{ id?: string } | null> {
  const supabase = getSupabase();
  const fullPayload = buildDeterministicPayload(job);

  const fullInsert = await supabase
    .from('achievements')
    .insert(fullPayload)
    .select('id')
    .single();

  if (!fullInsert.error) {
    return fullInsert.data ?? null;
  }

  const message = fullInsert.error.message.toLowerCase();

  if (message.includes('duplicate key')) {
    const existing = await supabase
      .from('achievements')
      .select('id')
      .eq('user_id', job.userId)
      .eq('event_key', fullPayload.event_key)
      .order('earned_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existing.error) return existing.data ?? null;
  }

  if (message.includes('event_key') || message.includes('rarity') || message.includes('app_scope') || message.includes('meta')) {
    const legacyInsert = await supabase
      .from('achievements')
      .insert({
        user_id: job.userId,
        trigger_type: fullPayload.trigger_type,
        trigger_value: fullPayload.trigger_value,
        title: fullPayload.title,
        description: fullPayload.description,
        icon: fullPayload.icon,
        earned_at: fullPayload.earned_at,
      })
      .select('id')
      .single();

    if (!legacyInsert.error) return legacyInsert.data ?? null;
  }

  throw fullInsert.error;
}

async function invokeAiFunction(job: AchievementQueueJob): Promise<{ id?: string } | null> {
  const supabase = getSupabase();

  const response = await supabase.functions.invoke('generate-achievement', {
    body: {
      eventKey: job.eventKey,
      trigger: job.trigger,
      runtimeSnapshot: job.runtimeSnapshot,
    },
  });

  if (response.error) {
    throw response.error;
  }

  const data = response.data as { achievement?: { id?: string } } | null;
  return data?.achievement ?? null;
}

async function processJob(job: AchievementQueueJob): Promise<{ id?: string } | null> {
  const flags = getBackgroundFeatureFlags();

  if (!flags.aiAchievements) {
    return insertDeterministicAchievement(job);
  }

  try {
    return await invokeAiFunction(job);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('function') || message.includes('404') || message.includes('network') || message.includes('failed to fetch')) {
      return insertDeterministicAchievement(job);
    }
    throw error;
  }
}

function scheduleRetry(job: AchievementQueueJob) {
  job.attempt += 1;
  job.nextAttemptAt = Date.now() + nextRetryDelay(job.attempt);
}

function notifyAchievementSynced(job: AchievementQueueJob, achievementId?: string) {
  void chrome.runtime.sendMessage({
    type: 'ACHIEVEMENT_SYNCED',
    payload: {
      userId: job.userId,
      eventKey: job.eventKey,
      achievementId,
    },
  }).catch(() => {
    // Popup may not be open.
  });
}

export async function enqueueAchievementJob(unlock: AchievementUnlockEvent): Promise<void> {
  await hydrateQueue();
  if (hasJob(unlock.userId, unlock.eventKey)) return;

  jobs.push({
    userId: unlock.userId,
    eventKey: unlock.eventKey,
    trigger: unlock.trigger,
    runtimeSnapshot: unlock.runtimeSnapshot,
    toast: unlock.toast,
    meta: unlock.meta,
    attempt: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
  });

  await persistQueue();
}

export async function processAchievementQueueNow(): Promise<void> {
  if (processInFlight) return;
  processInFlight = true;

  try {
    await hydrateQueue();

    if (jobs.length === 0) return;

    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;

    const now = Date.now();
    const currentUserId = session.user.id;

    const nextJobs: AchievementQueueJob[] = [];

    for (const job of jobs) {
      if (job.userId !== currentUserId) {
        nextJobs.push(job);
        continue;
      }

      if (job.nextAttemptAt > now) {
        nextJobs.push(job);
        continue;
      }

      try {
        const result = await processJob(job);
        notifyAchievementSynced(job, result?.id);
      } catch {
        scheduleRetry(job);
        nextJobs.push(job);
      }
    }

    jobs = nextJobs;
    await persistQueue();
  } finally {
    processInFlight = false;
  }
}

export function triggerAchievementQueueProcessing(): void {
  const now = Date.now();
  if ((now - lastProcessAt) < PROCESS_COOLDOWN_MS) return;
  lastProcessAt = now;
  void processAchievementQueueNow();
}
