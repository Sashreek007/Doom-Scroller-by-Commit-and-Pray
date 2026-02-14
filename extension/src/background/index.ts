// DoomScroller Background Service Worker
// Central coordinator: message routing, scroll aggregation, Supabase sync

import { loadBatches } from './scroll-aggregator';
import { setupAlarms, handleAlarm, syncToSupabaseNow } from './alarm-handlers';
import { handleMessage } from './message-router';

console.log('[DoomScroller] Background service worker loaded');

// Restore persisted scroll batches on SW restart
loadBatches();

// Set up periodic sync alarm
chrome.runtime.onInstalled.addListener(() => {
  console.log('[DoomScroller] Extension installed');
  setupAlarms();
});

// Also set up alarms on SW startup (alarms persist but good to ensure)
setupAlarms();

// Attempt immediate sync on startup so persisted batches are uploaded quickly.
void syncToSupabaseNow();

// Route messages from content scripts and popup
chrome.runtime.onMessage.addListener(handleMessage);

// Handle alarms (periodic sync)
chrome.alarms.onAlarm.addListener(handleAlarm);
