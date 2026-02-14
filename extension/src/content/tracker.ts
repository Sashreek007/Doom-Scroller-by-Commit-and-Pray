// DoomScroller Content Script - Scroll Tracker
// Injected on social media sites to track scroll distance in pixels,
// then sends batched updates to the background service worker.

import { getSiteConfig, getScrollContainer, getScrollPosition } from './site-config';
import { METERS_PER_PIXEL, CONTENT_FLUSH_INTERVAL_MS } from '../shared/constants';
import type { ScrollUpdateMessage } from '../shared/messages';

const config = getSiteConfig();
if (!config) {
  console.warn('[DoomScroller] No config for', window.location.hostname);
} else {
  let lastScrollY = getScrollPosition(config);
  let accumulatedPixels = 0;

  function handleScroll() {
    if (!config) return;
    const currentY = getScrollPosition(config);
    const delta = Math.abs(currentY - lastScrollY);
    // Ignore tiny deltas (noise) and impossibly large jumps (page navigation)
    if (delta > 1 && delta < 50000) {
      accumulatedPixels += delta;
    }
    lastScrollY = currentY;
  }

  // Attach passive scroll listener — does NOT block scrolling
  const scrollTarget = getScrollContainer(config);
  scrollTarget.addEventListener('scroll', handleScroll, { passive: true });

  // For sites with custom scroll containers, the container might not exist on page load.
  // Retry finding it after a delay.
  if (config.scrollContainerSelector) {
    const retryInterval = setInterval(() => {
      const el = document.querySelector(config.scrollContainerSelector!);
      if (el) {
        el.addEventListener('scroll', handleScroll, { passive: true });
        clearInterval(retryInterval);
      }
    }, 2000);

    // Stop retrying after 30 seconds
    setTimeout(() => clearInterval(retryInterval), 30000);
  }

  // Periodically flush accumulated scroll data to background service worker
  setInterval(() => {
    if (accumulatedPixels > 0) {
      const message: ScrollUpdateMessage = {
        type: 'SCROLL_UPDATE',
        payload: {
          site: window.location.hostname,
          pixels: accumulatedPixels,
          meters: accumulatedPixels * METERS_PER_PIXEL,
          timestamp: Date.now(),
        },
      };

      chrome.runtime.sendMessage(message).catch(() => {
        // Background SW might be inactive, data will be sent on next flush
      });

      accumulatedPixels = 0;
    }
  }, CONTENT_FLUSH_INTERVAL_MS);

  console.log('[DoomScroller] Tracking scroll on', config.hostname);
}
