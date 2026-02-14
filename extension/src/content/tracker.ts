// DoomScroller Content Script - Scroll Tracker
// Injected on social media sites to track scroll distance in pixels,
// then sends batched updates to the background service worker.

import { getSiteConfig, getScrollContainer, getScrollPosition } from './site-config';
import { METERS_PER_PIXEL, CONTENT_FLUSH_INTERVAL_MS } from '../shared/constants';
import { metersToCoins } from '../shared/coins';
import type {
  AchievementToastPayload,
  GetStatsResponse,
  ScrollUpdateMessage,
} from '../shared/messages';

const REBIND_INTERVAL_MS = 2000;
const COIN_BASELINE_RETRY_MS = 2000;
const COIN_BASELINE_MAX_RETRIES = 3;
const TOAST_ENTER_MS = 170;
const TOAST_EXIT_MS = 200;
const COIN_TOAST_VISIBLE_MS = 1300;
const ACHIEVEMENT_TOAST_VISIBLE_MS = 2600;

const config = getSiteConfig();
if (!config) {
  console.warn('[DoomScroller] No config for', window.location.hostname);
} else {
  const activeConfig = config;
  let accumulatedPixels = 0;
  let currentTarget: Element | Window | null = null;
  let lastScrollY = 0;
  let baselineMeters = 0;
  let localMeters = 0;
  let lastCoins = 0;
  let baselineReady = false;
  let baselineAttempts = 0;
  let baselineRetryTimer: number | null = null;
  let toastHost: HTMLDivElement | null = null;
  let nextToastAvailableAt = 0;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ensureToastHost(): HTMLDivElement {
    if (toastHost && document.documentElement.contains(toastHost)) return toastHost;
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.top = '18px';
    host.style.right = '18px';
    host.style.zIndex = '2147483646';
    host.style.pointerEvents = 'none';
    host.style.display = 'flex';
    host.style.flexDirection = 'column';
    host.style.alignItems = 'flex-end';
    host.style.gap = '8px';
    (document.body ?? document.documentElement).appendChild(host);
    toastHost = host;
    return host;
  }

  function scheduleToast(createToast: () => HTMLDivElement, visibleMs: number) {
    const now = Date.now();
    const startAt = Math.max(now, nextToastAvailableAt);
    const delayMs = Math.max(0, startAt - now);
    const totalMs = prefersReducedMotion
      ? visibleMs + 80
      : TOAST_ENTER_MS + visibleMs + TOAST_EXIT_MS + 30;
    nextToastAvailableAt = startAt + totalMs;

    window.setTimeout(() => {
      const host = ensureToastHost();
      const toast = createToast();
      toast.style.opacity = '0';
      toast.style.transform = prefersReducedMotion ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.94)';
      toast.style.transition = prefersReducedMotion
        ? 'none'
        : `opacity ${TOAST_ENTER_MS}ms ease, transform ${TOAST_ENTER_MS}ms ease`;
      host.appendChild(toast);

      if (prefersReducedMotion) {
        toast.style.opacity = '1';
        window.setTimeout(() => {
          toast.remove();
        }, visibleMs);
        return;
      }

      window.setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0) scale(1)';
      }, 16);

      window.setTimeout(() => {
        toast.style.transition = `opacity ${TOAST_EXIT_MS}ms ease, transform ${TOAST_EXIT_MS}ms ease`;
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-8px) scale(0.98)';
      }, TOAST_ENTER_MS + visibleMs);

      window.setTimeout(() => {
        toast.remove();
      }, TOAST_ENTER_MS + visibleMs + TOAST_EXIT_MS + 24);
    }, delayMs);
  }

  function createCoinToastElement(): HTMLDivElement {
    const toast = document.createElement('div');
    toast.textContent = '🪙 +1 Coin';
    toast.style.padding = '11px 16px';
    toast.style.borderRadius = '999px';
    toast.style.background = 'linear-gradient(135deg, rgba(255,230,80,0.56), rgba(245,158,11,0.52))';
    toast.style.border = '2px solid rgba(253,224,71,0.95)';
    toast.style.color = '#fffde9';
    toast.style.fontFamily = 'JetBrains Mono, Inter, system-ui, sans-serif';
    toast.style.fontSize = '16px';
    toast.style.fontWeight = '800';
    toast.style.letterSpacing = '0.03em';
    toast.style.textShadow = '0 0 10px rgba(255,245,157,0.85)';
    toast.style.boxShadow = '0 0 24px rgba(250,204,21,0.78), 0 0 42px rgba(245,158,11,0.44)';
    toast.style.backdropFilter = 'blur(6px)';
    return toast;
  }

  function achievementStyleForRarity(rarity: AchievementToastPayload['rarity']) {
    if (rarity === 'legendary') {
      return {
        border: '1px solid rgba(244,114,182,0.95)',
        background: 'linear-gradient(135deg, rgba(244,114,182,0.28), rgba(217,70,239,0.32))',
        glow: '0 0 26px rgba(217,70,239,0.55), 0 0 42px rgba(244,114,182,0.38)',
        titleColor: '#fce7f3',
      };
    }
    if (rarity === 'epic') {
      return {
        border: '1px solid rgba(56,189,248,0.9)',
        background: 'linear-gradient(135deg, rgba(34,211,238,0.25), rgba(59,130,246,0.32))',
        glow: '0 0 24px rgba(56,189,248,0.52), 0 0 38px rgba(59,130,246,0.32)',
        titleColor: '#e0f2fe',
      };
    }
    if (rarity === 'rare') {
      return {
        border: '1px solid rgba(74,222,128,0.95)',
        background: 'linear-gradient(135deg, rgba(74,222,128,0.22), rgba(34,197,94,0.3))',
        glow: '0 0 22px rgba(74,222,128,0.45)',
        titleColor: '#dcfce7',
      };
    }
    return {
      border: '1px solid rgba(148,163,184,0.8)',
      background: 'linear-gradient(135deg, rgba(148,163,184,0.2), rgba(100,116,139,0.25))',
      glow: '0 0 14px rgba(148,163,184,0.3)',
      titleColor: '#f8fafc',
    };
  }

  function createAchievementToastElement(payload: AchievementToastPayload): HTMLDivElement {
    const style = achievementStyleForRarity(payload.rarity);

    const toast = document.createElement('div');
    toast.style.width = 'min(320px, calc(100vw - 32px))';
    toast.style.padding = '12px 14px';
    toast.style.borderRadius = '14px';
    toast.style.border = style.border;
    toast.style.background = style.background;
    toast.style.backdropFilter = 'blur(8px)';
    toast.style.boxShadow = style.glow;
    toast.style.color = '#e5e7eb';
    toast.style.fontFamily = 'JetBrains Mono, Inter, system-ui, sans-serif';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '8px';
    header.style.marginBottom = '6px';

    const icon = document.createElement('span');
    icon.textContent = payload.icon || '🏆';
    icon.style.fontSize = '20px';
    icon.style.lineHeight = '1';

    const title = document.createElement('span');
    title.textContent = payload.title || 'New Achievement';
    title.style.fontSize = '13px';
    title.style.fontWeight = '800';
    title.style.letterSpacing = '0.04em';
    title.style.color = style.titleColor;
    title.style.textTransform = 'uppercase';

    const rarity = document.createElement('span');
    rarity.textContent = payload.rarity.toUpperCase();
    rarity.style.marginLeft = 'auto';
    rarity.style.fontSize = '10px';
    rarity.style.opacity = '0.9';

    header.appendChild(icon);
    header.appendChild(title);
    header.appendChild(rarity);

    const description = document.createElement('div');
    description.textContent = payload.description;
    description.style.fontSize = '12px';
    description.style.lineHeight = '1.35';
    description.style.opacity = '0.95';
    description.style.marginBottom = '6px';

    const roastLine = document.createElement('div');
    roastLine.textContent = payload.roastLine;
    roastLine.style.fontSize = '11px';
    roastLine.style.lineHeight = '1.35';
    roastLine.style.opacity = '0.84';
    roastLine.style.fontStyle = 'italic';

    toast.appendChild(header);
    if (payload.description) toast.appendChild(description);
    if (payload.roastLine) toast.appendChild(roastLine);
    return toast;
  }

  function showCoinToastSequence(gainCount: number) {
    if (gainCount <= 0) return;
    for (let index = 0; index < gainCount; index += 1) {
      scheduleToast(createCoinToastElement, COIN_TOAST_VISIBLE_MS);
    }
  }

  function showAchievementToast(payload: AchievementToastPayload) {
    scheduleToast(() => createAchievementToastElement(payload), ACHIEVEMENT_TOAST_VISIBLE_MS);
  }

  function isAchievementToastMessage(value: unknown): value is { type: 'ACHIEVEMENT_TOAST'; payload: AchievementToastPayload } {
    if (!value || typeof value !== 'object') return false;
    const message = value as { type?: unknown; payload?: unknown };
    if (message.type !== 'ACHIEVEMENT_TOAST') return false;
    if (!message.payload || typeof message.payload !== 'object') return false;
    const payload = message.payload as Partial<AchievementToastPayload>;
    return (
      typeof payload.eventKey === 'string'
      && typeof payload.title === 'string'
      && typeof payload.description === 'string'
      && typeof payload.icon === 'string'
      && typeof payload.rarity === 'string'
      && typeof payload.roastLine === 'string'
    );
  }

  function applyMetersAndNotify(deltaMeters: number) {
    if (!Number.isFinite(deltaMeters) || deltaMeters <= 0) return;
    localMeters += deltaMeters;
    if (!baselineReady) return;

    const nextCoins = metersToCoins(baselineMeters + localMeters);
    const gained = nextCoins - lastCoins;
    if (gained > 0) {
      showCoinToastSequence(gained);
      lastCoins = nextCoins;
    }
  }

  async function loadCoinBaseline() {
    baselineAttempts += 1;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' }) as GetStatsResponse | undefined;
      const totalMeters = Number(response?.totalMeters ?? 0);
      if (Number.isFinite(totalMeters)) {
        baselineMeters = totalMeters;
        baselineReady = true;
        lastCoins = metersToCoins(baselineMeters + localMeters);
        return;
      }
    } catch {
      // Retry below if needed.
    }

    if (baselineAttempts < COIN_BASELINE_MAX_RETRIES) {
      baselineRetryTimer = window.setTimeout(() => {
        void loadCoinBaseline();
      }, COIN_BASELINE_RETRY_MS);
      return;
    }

    // Fallback: still enable local coin notifications if baseline fetch keeps failing.
    baselineMeters = 0;
    baselineReady = true;
    lastCoins = metersToCoins(localMeters);
  }

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

  const runtimeMessageListener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message) => {
    if (!isAchievementToastMessage(message)) return;
    showAchievementToast(message.payload);
  };

  chrome.runtime.onMessage.addListener(runtimeMessageListener);

  // Bind immediately and keep rebinding for dynamic/SPA containers.
  bindToBestTarget();
  const rebindInterval = setInterval(bindToBestTarget, REBIND_INTERVAL_MS);
  void loadCoinBaseline();

  // Periodically flush accumulated scroll data to background service worker
  const flushInterval = setInterval(() => {
    if (accumulatedPixels > 0) {
      const meters = accumulatedPixels * METERS_PER_PIXEL;
      const message: ScrollUpdateMessage = {
        type: 'SCROLL_UPDATE',
        payload: {
          site: activeConfig.site,
          pixels: accumulatedPixels,
          meters,
          timestamp: Date.now(),
        },
      };

      chrome.runtime.sendMessage(message).catch(() => {
        // Background SW might be inactive, data will be sent on next flush
      });

      applyMetersAndNotify(meters);
      accumulatedPixels = 0;
    }
  }, CONTENT_FLUSH_INTERVAL_MS);

  // Best-effort cleanup for long-lived tabs.
  window.addEventListener('beforeunload', () => {
    clearInterval(rebindInterval);
    clearInterval(flushInterval);
    chrome.runtime.onMessage.removeListener(runtimeMessageListener);
    if (baselineRetryTimer !== null) {
      window.clearTimeout(baselineRetryTimer);
    }
    if (toastHost) {
      toastHost.remove();
      toastHost = null;
    }
    detachCurrentTarget();
  });

  console.log('[DoomScroller] Tracking scroll on', activeConfig.site, '(', activeConfig.hostname, ')');
}
