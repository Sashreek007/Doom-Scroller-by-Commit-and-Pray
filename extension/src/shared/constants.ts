// CSS standard: 96 CSS pixels = 1 inch, 1 inch = 0.0254 meters
// Therefore: 1 meter = 96 / 0.0254 = 3779.5275591 CSS pixels
export const CSS_PIXELS_PER_METER = 3779.5275591;
export const METERS_PER_PIXEL = 1 / CSS_PIXELS_PER_METER; // ~0.0002646

// How often content script sends data to background (ms)
export const CONTENT_FLUSH_INTERVAL_MS = 500;

// How often background syncs to Supabase (minutes, for chrome.alarms)
export const SYNC_INTERVAL_MINUTES = 0.5; // 30 seconds

// Battle mode: higher frequency flush (ms)
export const BATTLE_FLUSH_INTERVAL_MS = 500;

// Battle idle timeout: if no scroll for this long, player quits (ms)
export const BATTLE_IDLE_TIMEOUT_MS = 15000;

// Supported social media sites (canonical keys used across runtime + UI)
export const SUPPORTED_SITES = [
  'facebook',
  'x',
  'tiktok',
  'instagram',
  'snapchat',
  'reddit',
  'youtube',
  'pinterest',
] as const;

export type SupportedSite = (typeof SUPPORTED_SITES)[number];
const SUPPORTED_SITE_SET = new Set<string>(SUPPORTED_SITES);

const SITE_DOMAINS: Record<SupportedSite, readonly string[]> = {
  facebook: ['facebook.com', 'fb.com'],
  x: ['x.com', 'twitter.com'],
  tiktok: ['tiktok.com'],
  instagram: ['instagram.com'],
  snapchat: ['snapchat.com'],
  reddit: ['reddit.com'],
  youtube: ['youtube.com'],
  pinterest: ['pinterest.com'],
};

// Legacy values that may already be stored in scroll_sessions.site
const LEGACY_SITE_ALIASES: Record<string, SupportedSite> = {
  'facebook.com': 'facebook',
  'www.facebook.com': 'facebook',
  'm.facebook.com': 'facebook',
  'fb.com': 'facebook',
  'x.com': 'x',
  'www.x.com': 'x',
  'twitter.com': 'x',
  'www.twitter.com': 'x',
  'tiktok.com': 'tiktok',
  'www.tiktok.com': 'tiktok',
  'instagram.com': 'instagram',
  'www.instagram.com': 'instagram',
  'reddit.com': 'reddit',
  'www.reddit.com': 'reddit',
  'youtube.com': 'youtube',
  'www.youtube.com': 'youtube',
  'm.youtube.com': 'youtube',
  'snapchat.com': 'snapchat',
  'www.snapchat.com': 'snapchat',
  'web.snapchat.com': 'snapchat',
  'pinterest.com': 'pinterest',
  'www.pinterest.com': 'pinterest',
};

function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0];
}

function matchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function isSupportedSite(site: string): site is SupportedSite {
  return SUPPORTED_SITE_SET.has(site.toLowerCase());
}

export function toCanonicalSite(value: string): SupportedSite | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();

  if (isSupportedSite(normalized)) {
    return normalized as SupportedSite;
  }

  const hostname = normalizeHost(normalized);
  const exactAlias = LEGACY_SITE_ALIASES[hostname];
  if (exactAlias) return exactAlias;

  for (const [site, domains] of Object.entries(SITE_DOMAINS) as [SupportedSite, readonly string[]][]) {
    if (domains.some((domain) => matchesDomain(hostname, domain))) {
      return site;
    }
  }

  return null;
}

export function getSupportedSiteFromHostname(hostname: string): SupportedSite | null {
  return toCanonicalSite(hostname);
}

// Site display names and icons
export const SITE_INFO: Record<SupportedSite, { name: string; short: string; color: string }> = {
  facebook: { name: 'Facebook', short: 'FB', color: '#1877F2' },
  x: { name: 'X', short: 'X', color: '#1DA1F2' },
  tiktok: { name: 'TikTok', short: 'TT', color: '#00F2EA' },
  instagram: { name: 'Instagram', short: 'IG', color: '#E4405F' },
  snapchat: { name: 'Snapchat', short: 'SC', color: '#FFFC00' },
  reddit: { name: 'Reddit', short: 'RED', color: '#FF4500' },
  youtube: { name: 'YouTube', short: 'YT', color: '#FF0000' },
  pinterest: { name: 'Pinterest', short: 'PIN', color: '#E60023' },
};

// Fun comparisons for scroll distances (in meters)
export const SCROLL_COMPARISONS = [
  { threshold: 0, unit: 'football fields', divisor: 91.44 },
  { threshold: 100, unit: 'Eiffel Towers', divisor: 330 },
  { threshold: 500, unit: 'lengths of your unread textbook', divisor: 0.25 },
  { threshold: 1000, unit: 'km', divisor: 1000 },
  { threshold: 5000, unit: 'Mount Everests', divisor: 8849 },
  { threshold: 10000, unit: 'marathons', divisor: 42195 },
];
