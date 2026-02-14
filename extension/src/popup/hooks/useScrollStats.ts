import { useState, useEffect, useCallback } from 'react';
import type { GetStatsResponse } from '@/shared/messages';

export function useScrollStats() {
  const [stats, setStats] = useState<GetStatsResponse>({
    todayMeters: 0,
    todayBysite: {},
    totalMeters: 0,
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
      if (response) {
        setStats(response as GetStatsResponse);
      }
    } catch {
      // Extension context might not be ready
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Refresh every 10 seconds when popup is open
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { stats, loading, refresh };
}
