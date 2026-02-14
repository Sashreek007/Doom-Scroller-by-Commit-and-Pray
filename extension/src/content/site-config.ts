// Per-site configuration for scroll container detection
// Social media sites use different scroll containers

export interface SiteConfig {
  hostname: string;
  // CSS selector for the scroll container. null = use window (document scrolling)
  scrollContainerSelector: string | null;
}

export const SITE_CONFIGS: Record<string, SiteConfig> = {
  'www.instagram.com': {
    hostname: 'www.instagram.com',
    scrollContainerSelector: null, // Uses window scroll
  },
  'x.com': {
    hostname: 'x.com',
    scrollContainerSelector: '[data-testid="primaryColumn"]',
  },
  'twitter.com': {
    hostname: 'twitter.com',
    scrollContainerSelector: '[data-testid="primaryColumn"]',
  },
  'www.tiktok.com': {
    hostname: 'www.tiktok.com',
    scrollContainerSelector: null, // Full-page swipe, uses window
  },
  'www.reddit.com': {
    hostname: 'www.reddit.com',
    scrollContainerSelector: null, // Uses window scroll
  },
  'www.youtube.com': {
    hostname: 'www.youtube.com',
    scrollContainerSelector: null, // Main feed uses window scroll
  },
  'www.facebook.com': {
    hostname: 'www.facebook.com',
    scrollContainerSelector: null, // Uses window scroll
  },
};

export function getSiteConfig(): SiteConfig | null {
  return SITE_CONFIGS[window.location.hostname] ?? null;
}

export function getScrollContainer(config: SiteConfig): Element | Window {
  if (config.scrollContainerSelector) {
    const el = document.querySelector(config.scrollContainerSelector);
    if (el) return el;
  }
  return window;
}

export function getScrollPosition(config: SiteConfig): number {
  if (config.scrollContainerSelector) {
    const el = document.querySelector(config.scrollContainerSelector);
    if (el) return el.scrollTop;
  }
  return window.scrollY;
}
