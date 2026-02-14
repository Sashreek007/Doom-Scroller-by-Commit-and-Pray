import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/shared/supabase';

const REQUESTS_POLL_INTERVAL_MS = 3000;

export function usePendingFriendRequestsCount(userId: string | null) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) {
      setCount(0);
      return;
    }

    const { count: pendingCount, error } = await supabase
      .from('friendships')
      .select('id', { count: 'exact', head: true })
      .eq('addressee_id', userId)
      .eq('status', 'pending');

    if (error) {
      return;
    }

    setCount(typeof pendingCount === 'number' ? pendingCount : 0);
  }, [userId]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, REQUESTS_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [refresh]);

  return { count, refresh };
}
