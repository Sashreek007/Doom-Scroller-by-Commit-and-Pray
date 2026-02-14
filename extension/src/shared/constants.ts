// CSS standard: 96 CSS pixels = 1 inch, 1 inch = 0.0254 meters
// Therefore: 1 meter = 96 / 0.0254 = 3779.5275591 CSS pixels
export const CSS_PIXELS_PER_METER = 3779.5275591;
export const METERS_PER_PIXEL = 1 / CSS_PIXELS_PER_METER; // ~0.0002646

// How often content script sends data to background (ms)
export const CONTENT_FLUSH_INTERVAL_MS = 5000;

// How often background syncs to Supabase (minutes, for chrome.alarms)
export const SYNC_INTERVAL_MINUTES = 0.5; // 30 seconds

// Battle mode: higher frequency flush (ms)
export const BATTLE_FLUSH_INTERVAL_MS = 500;

// Battle idle timeout: if no scroll for this long, player quits (ms)
export const BATTLE_IDLE_TIMEOUT_MS = 15000;

// Supported social media sites
export const SUPPORTED_SITES = [
  'www.instagram.com',
  'x.com',
  'twitter.com',
  'www.tiktok.com',
  'www.reddit.com',
  'www.youtube.com',
  'www.facebook.com',
] as const;

export type SupportedSite = (typeof SUPPORTED_SITES)[number];

// Site display names and icons
export const SITE_INFO: Record<string, { name: string; short: string; color: string }> = {
  'www.instagram.com': { name: 'Instagram', short: 'IG', color: '#E4405F' },
  'x.com': { name: 'X', short: 'X', color: '#1DA1F2' },
  'twitter.com': { name: 'X', short: 'X', color: '#1DA1F2' },
  'www.tiktok.com': { name: 'TikTok', short: 'TT', color: '#00F2EA' },
  'www.reddit.com': { name: 'Reddit', short: 'RED', color: '#FF4500' },
  'www.youtube.com': { name: 'YouTube', short: 'YT', color: '#FF0000' },
  'www.facebook.com': { name: 'Facebook', short: 'FB', color: '#1877F2' },
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
