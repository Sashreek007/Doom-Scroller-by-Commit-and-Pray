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

export function getScrollContainer(config: SiteConfig): Element | Window {
  for (const selector of config.scrollContainerSelectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return window;
}

export function getScrollPosition(target: Element | Window): number {
  if ('scrollY' in target) return target.scrollY;
  return (target as HTMLElement).scrollTop;
}
