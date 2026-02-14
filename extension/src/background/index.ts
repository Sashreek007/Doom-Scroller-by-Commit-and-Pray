// DoomScroller Background Service Worker
// Handles scroll data aggregation, Supabase sync, and message routing

console.log('[DoomScroller] Background service worker loaded');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[DoomScroller] Extension installed');
});
