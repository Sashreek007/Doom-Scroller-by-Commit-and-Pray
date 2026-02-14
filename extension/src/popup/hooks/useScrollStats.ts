import { useState, useEffect, useCallback, useRef } from 'react';
import type { GetStatsResponse } from '@/shared/messages';

const CACHE_KEY = 'cached_scroll_stats';
const BATCHES_KEY = 'scrollBatches';
const INFLIGHT_BATCHES_KEY = 'scrollBatchesInFlight';
const STATS_REFRESH_INTERVAL_MS = 1000;

export function useScrollStats() {
  const [stats, setStats] = useState<GetStatsResponse>({
    todayMeters: 0,
    todayBysite: {},
    totalMeters: 0,
  });
  const [loading, setLoading] = useState(true);
  const requestSeqRef = useRef(0);
  const latestAppliedRef = useRef(0);

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
    const requestId = ++requestSeqRef.current;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
      if (response && requestId >= latestAppliedRef.current) {
        latestAppliedRef.current = requestId;
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
    const interval = setInterval(refresh, STATS_REFRESH_INTERVAL_MS);

    const handleStorageChange: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
      changes,
      areaName,
    ) => {
      if (
        areaName === 'local'
        && (changes[BATCHES_KEY] || changes[INFLIGHT_BATCHES_KEY])
      ) {
        refresh();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      clearInterval(interval);
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [refresh]);

  return { stats, loading, refresh };
}
