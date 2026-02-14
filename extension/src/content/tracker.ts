// DoomScroller Content Script - Scroll Tracker
// Injected on social media sites to track scroll distance in pixels,
// then sends batched updates to the background service worker.

import { getSiteConfig, getScrollContainer, getScrollPosition } from './site-config';
import { METERS_PER_PIXEL, CONTENT_FLUSH_INTERVAL_MS } from '../shared/constants';
import type { ScrollUpdateMessage } from '../shared/messages';

const REBIND_INTERVAL_MS = 2000;

const config = getSiteConfig();
if (!config) {
  console.warn('[DoomScroller] No config for', window.location.hostname);
} else {
  const activeConfig = config;
  let accumulatedPixels = 0;
  let currentTarget: Element | Window | null = null;
  let lastScrollY = 0;

  function handleScroll() {
    if (!currentTarget) return;
    const currentY = getScrollPosition(currentTarget);
    const delta = Math.abs(currentY - lastScrollY);
    // Ignore tiny deltas (noise) and impossibly large jumps (page navigation)
    if (delta > 1 && delta < 50000) {
      accumulatedPixels += delta;
    }
    lastScrollY = currentY;
  }

  function detachCurrentTarget() {
    if (!currentTarget) return;
    currentTarget.removeEventListener('scroll', handleScroll as EventListener);
  }

  function bindToBestTarget() {
    const nextTarget = getScrollContainer(activeConfig);
    if (currentTarget === nextTarget) return;

    detachCurrentTarget();
    currentTarget = nextTarget;
    lastScrollY = getScrollPosition(currentTarget);
    currentTarget.addEventListener('scroll', handleScroll as EventListener, { passive: true });
  }

  // Bind immediately and keep rebinding for dynamic/SPA containers.
  bindToBestTarget();
  const rebindInterval = setInterval(bindToBestTarget, REBIND_INTERVAL_MS);

  // Periodically flush accumulated scroll data to background service worker
  const flushInterval = setInterval(() => {
    if (accumulatedPixels > 0) {
      const message: ScrollUpdateMessage = {
        type: 'SCROLL_UPDATE',
        payload: {
          site: activeConfig.site,
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

  // Best-effort cleanup for long-lived tabs.
  window.addEventListener('beforeunload', () => {
    clearInterval(rebindInterval);
    clearInterval(flushInterval);
    detachCurrentTarget();
  });

  console.log('[DoomScroller] Tracking scroll on', activeConfig.site, '(', activeConfig.hostname, ')');
}
