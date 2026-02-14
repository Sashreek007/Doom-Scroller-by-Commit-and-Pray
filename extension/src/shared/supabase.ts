import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    '[DoomScroller] Missing Supabase config. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env',
  );
}

// Chrome extension storage adapter for Supabase auth
// localStorage doesn't work in extension popups/service workers
const chromeStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    const result = await chrome.storage.local.get(key);
    const value = result[key];
    if (value == null) return null;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    await chrome.storage.local.set({ [key]: value });
  },
  removeItem: async (key: string): Promise<void> => {
    await chrome.storage.local.remove(key);
  },
};

async function withAuthLock<T>(
  name: string,
  _acquireTimeout: number,
  fn: () => Promise<T>,
): Promise<T> {
  const lockName = `doomscroller:${name}`;
  const locks = globalThis.navigator?.locks;

  if (!locks?.request) {
    return fn();
  }

  try {
    return await locks.request(lockName, { mode: 'exclusive' }, async () => fn());
  } catch {
    return fn();
  }
}

const hasLockManager = Boolean(globalThis.navigator?.locks?.request);

export const supabase = createClient(SUPABASE_URL ?? '', SUPABASE_ANON_KEY ?? '', {
  auth: {
    storage: chromeStorageAdapter,
    persistSession: true,
    // Only enable automatic refresh when proper cross-context locking is available.
    autoRefreshToken: hasLockManager,
    // Prevent refresh-token races across popup/background contexts.
    lock: withAuthLock,
    // Detect session from URL is not needed in extension context
    detectSessionInUrl: false,
  },
});
