// Handles chrome.alarms for periodic data sync to Supabase

import { drainBatches } from './scroll-aggregator';
import { getSupabase } from './supabase-client';
import { SYNC_INTERVAL_MINUTES } from '../shared/constants';

const SYNC_ALARM_NAME = 'sync-scroll';

export function setupAlarms() {
  chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: SYNC_INTERVAL_MINUTES,
  });
}

export function handleAlarm(alarm: chrome.alarms.Alarm) {
  if (alarm.name === SYNC_ALARM_NAME) {
    syncToSupabase();
  }
}

async function syncToSupabase() {
  const supabase = getSupabase();

  // Check if user is authenticated
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return; // Not logged in, skip sync
  }

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

  const { error } = await supabase
    .from('scroll_sessions')
    .insert(sessions);

  if (error) {
    console.error('[DoomScroller] Sync failed:', error.message);
  } else {
    console.log(`[DoomScroller] Synced ${sessions.length} session(s) to Supabase`);
    // Update total meters on profile
    const totalMeters = sessions.reduce((sum, s) => sum + s.meters_scrolled, 0);
    await supabase.rpc('increment_total_meters', {
      user_id_input: session.user.id,
      meters_to_add: totalMeters,
    }).then(({ error: rpcError }) => {
      if (rpcError) {
        // Fallback: direct update if RPC doesn't exist
        supabase
          .from('profiles')
          .select('total_meters_scrolled')
          .eq('id', session.user.id)
          .single()
          .then(({ data }) => {
            if (data) {
              const newTotal = Number(data.total_meters_scrolled) + totalMeters;
              supabase
                .from('profiles')
                .update({ total_meters_scrolled: newTotal })
                .eq('id', session.user.id)
                .then(() => {});
            }
          });
      }
    });
  }
}
