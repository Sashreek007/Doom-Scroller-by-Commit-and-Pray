// Supabase client for the background service worker context

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

// Chrome extension storage adapter — same as popup uses
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

export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: chromeStorageAdapter,
        persistSession: true,
        autoRefreshToken: hasLockManager,
        lock: withAuthLock,
        detectSessionInUrl: false,
      },
    });
  }
  return supabaseInstance;
}
