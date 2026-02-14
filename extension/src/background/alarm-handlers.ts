// Handles chrome.alarms for periodic data sync to Supabase

import { confirmSyncedBatches, drainBatches, restoreBatches } from './scroll-aggregator';
import { getSupabase } from './supabase-client';
import { SYNC_INTERVAL_MINUTES } from '../shared/constants';
import { ensureProfileExists } from '../shared/profile';
import { applySyncedBatchesToDbCache } from './stats-cache';

const SYNC_ALARM_NAME = 'sync-scroll';
const OPPORTUNISTIC_SYNC_INTERVAL_MS = 5000;

let syncInFlight = false;
let lastOpportunisticSyncAt = 0;

export function setupAlarms() {
  chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: SYNC_INTERVAL_MINUTES,
  });
}

export function handleAlarm(alarm: chrome.alarms.Alarm) {
  if (alarm.name === SYNC_ALARM_NAME) {
    void syncToSupabaseNow();
  }
}

export function triggerOpportunisticSync() {
  const now = Date.now();
  if (syncInFlight) return;
  if (now - lastOpportunisticSyncAt < OPPORTUNISTIC_SYNC_INTERVAL_MS) return;
  lastOpportunisticSyncAt = now;
  void syncToSupabaseNow();
}

function isMissingProfileForeignKeyError(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  return msg.includes('foreign key') && msg.includes('scroll_sessions_user_id_fkey');
}

export async function syncToSupabaseNow() {
  if (syncInFlight) return;
  syncInFlight = true;

  const supabase = getSupabase();

  try {
    // Check if user is authenticated.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return;
    }

    // Best-effort self-heal for accounts that are missing a profiles row.
    await ensureProfileExists(supabase, session.user);

    const batches = drainBatches();
    if (batches.length === 0) return;

    const sessions = batches.map((batch) => ({
      user_id: session.user.id,
      site: batch.site,
      pixels_scrolled: Math.round(batch.totalPixels),
      meters_scrolled: parseFloat(batch.totalMeters.toFixed(4)),
      duration_seconds: Math.round((batch.lastUpdate - batch.sessionStart) / 1000),
      session_start: new Date(batch.sessionStart).toISOString(),
      session_end: new Date(batch.lastUpdate).toISOString(),
    }));

    let { error } = await supabase
      .from('scroll_sessions')
      .insert(sessions);

    // If profile was missing and FK failed, try creating profile once and retry insert.
    if (error && isMissingProfileForeignKeyError(error.message)) {
      await ensureProfileExists(supabase, session.user);
      const retry = await supabase.from('scroll_sessions').insert(sessions);
      error = retry.error;
    }

    if (error) {
      console.error('[DoomScroller] Sync failed:', error.message);
      // Restore drained batches so data is not lost and can be retried next alarm.
      restoreBatches(batches);
    } else {
      applySyncedBatchesToDbCache(session.user.id, batches);
      confirmSyncedBatches(batches);
      console.log(`[DoomScroller] Synced ${sessions.length} session(s) to Supabase`);
      // Profile totals are updated by DB trigger on scroll_sessions insert.
    }
  } finally {
    syncInFlight = false;
  }
}
