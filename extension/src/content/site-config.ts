// Per-site configuration for scroll container detection
// Social media sites use different scroll containers

import { getSupportedSiteFromHostname, type SupportedSite } from '../shared/constants';

export interface SiteConfig {
  site: SupportedSite;
  hostname: string;
  // CSS selectors for the scroll container, tried in order.
  // Empty array means use window/document scrolling.
  scrollContainerSelectors: string[];
}

const SITE_CONFIGS: Record<SupportedSite, Omit<SiteConfig, 'hostname'>> = {
  facebook: {
    site: 'facebook',
    scrollContainerSelectors: [], // Uses window scroll
  },
  x: {
    site: 'x',
    // X/Twitter frequently changes container structure; keep fallbacks.
    scrollContainerSelectors: [
      '[data-testid="primaryColumn"]',
      'main[role="main"]',
      '[aria-label="Timeline: Your Home Timeline"]',
    ],
  },
  tiktok: {
    site: 'tiktok',
    scrollContainerSelectors: [], // Uses window scroll on desktop web
  },
  instagram: {
    site: 'instagram',
    scrollContainerSelectors: [], // Uses window scroll
  },
  snapchat: {
    site: 'snapchat',
    scrollContainerSelectors: [], // Web app can vary; default to window
  },
  reddit: {
    site: 'reddit',
    scrollContainerSelectors: [], // Uses window scroll
  },
  youtube: {
    site: 'youtube',
    scrollContainerSelectors: [], // Main feed uses window scroll
  },
  pinterest: {
    site: 'pinterest',
    scrollContainerSelectors: [], // Uses window scroll
  },
};

export function getSiteConfig(): SiteConfig | null {
  const hostname = window.location.hostname.toLowerCase();
  const site = getSupportedSiteFromHostname(hostname);
  if (!site) return null;
  return {
    ...SITE_CONFIGS[site],
    hostname,
  };
}

function getElementScrollScore(element: Element): number {
  const node = element as HTMLElement;
  const overflowDelta = node.scrollHeight - node.clientHeight;
  if (!Number.isFinite(overflowDelta) || overflowDelta <= 2) return 0;

  const style = window.getComputedStyle(node);
  const overflowY = style.overflowY.toLowerCase();
  const allowsScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
  if (!allowsScroll && node.scrollTop <= 0) return 0;

  return overflowDelta;
}

function findBestScrollableWithin(root: Element): Element | null {
  let best: Element | null = null;
  let bestScore = 0;

  const rootScore = getElementScrollScore(root);
  if (rootScore > bestScore) {
    best = root;
    bestScore = rootScore;
  }

  // X/Twitter layouts often nest the true scroller under primary containers.
  const descendants = root.querySelectorAll('div, main, section, article');
  for (const node of descendants) {
    const score = getElementScrollScore(node);
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }

  return best;
}

export function getScrollContainer(config: SiteConfig): Element | Window {
  let bestTarget: Element | null = null;
  let bestScore = 0;

  for (const selector of config.scrollContainerSelectors) {
    const el = document.querySelector(selector);
    if (!el) continue;

    const candidate = findBestScrollableWithin(el);
    if (!candidate) continue;

    const score = getElementScrollScore(candidate);
    if (score > bestScore) {
      bestTarget = candidate;
      bestScore = score;
    }
  }

  if (bestTarget) return bestTarget;

  return window;
}

export function getScrollPosition(target: Element | Window): number {
  if ('scrollY' in target) {
    return target.scrollY
      || document.documentElement.scrollTop
      || document.body.scrollTop
      || 0;
  }
  return (target as HTMLElement).scrollTop;
}
