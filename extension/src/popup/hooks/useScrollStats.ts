import { useState, useEffect, useCallback } from 'react';
import type { GetStatsResponse } from '@/shared/messages';

const CACHE_KEY = 'cached_scroll_stats';

export function useScrollStats() {
  const [stats, setStats] = useState<GetStatsResponse>({
    todayMeters: 0,
    todayBysite: {},
    totalMeters: 0,
  });
  const [loading, setLoading] = useState(true);

  // Load cached stats immediately on mount
  useEffect(() => {
    chrome.storage.local.get(CACHE_KEY).then((result) => {
      if (result[CACHE_KEY]) {
        setStats(result[CACHE_KEY]);
        setLoading(false);
      }
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
      if (response) {
        setStats(response as GetStatsResponse);
        chrome.storage.local.set({ [CACHE_KEY]: response });
      }
    } catch {
      // Extension context might not be ready
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { stats, loading, refresh };
}
