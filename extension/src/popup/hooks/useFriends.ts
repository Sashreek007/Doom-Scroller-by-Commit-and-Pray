import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/shared/supabase';
import type { Profile, Friendship } from '@/shared/types';

interface FriendWithProfile {
  friendship: Friendship;
  profile: Profile;
}

interface SocialProfileRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  total_meters_scrolled: number | string;
  coin_balance?: number | string | null;
  coin_meter_checkpoint?: number | string | null;
  created_at?: string | null;
  is_public?: boolean;
  world_public?: boolean;
  friends_public?: boolean;
  can_view_details?: boolean;
}

interface FriendAcceptanceNotice {
  userId: string;
  displayName: string;
  username: string;
}

const FRIENDS_REFRESH_INTERVAL_MS = 3000;

function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSubsequence(query: string, value: string): boolean {
  if (!query) return false;
  let queryIndex = 0;
  for (let i = 0; i < value.length && queryIndex < query.length; i += 1) {
    if (query[queryIndex] === value[i]) queryIndex += 1;
  }
  return queryIndex === query.length;
}

function fuzzyScore(query: string, value: string): number {
  if (!query || !value) return 0;
  if (value === query) return 1000;
  if (value.startsWith(query)) return 820 - Math.min(300, value.length - query.length);

  const containsAt = value.indexOf(query);
  if (containsAt >= 0) return 700 - Math.min(300, containsAt * 7);

  const tokens = query.split(' ').filter(Boolean);
  const tokenHits = tokens.filter((token) => value.includes(token)).length;
  if (tokenHits > 0) {
    return 500 + tokenHits * 40;
  }

  if (isSubsequence(query.replace(/\s+/g, ''), value.replace(/\s+/g, ''))) {
    return 320;
  }

  return 0;
}

function scoreProfile(query: string, profile: Profile): number {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return 0;

  const username = normalizeForSearch(profile.username);
  const displayName = normalizeForSearch(profile.display_name);

  const usernameScore = fuzzyScore(normalizedQuery, username);
  const displayScore = fuzzyScore(normalizedQuery, displayName) * 0.85;

  return Math.max(usernameScore, displayScore);
}

function isDuplicateFriendshipError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = String((error as { code?: unknown }).code ?? '');
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase();
  return code === '23505'
    || message.includes('duplicate key')
    || message.includes('unique_friendship');
}

function toProfile(row: SocialProfileRow): Profile {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    avatar_url: row.avatar_url ?? null,
    is_public: typeof row.is_public === 'boolean'
      ? row.is_public
      : typeof row.world_public === 'boolean'
        ? row.world_public
        : true,
    world_public: typeof row.world_public === 'boolean' ? row.world_public : undefined,
    friends_public: typeof row.friends_public === 'boolean' ? row.friends_public : undefined,
    can_view_details: typeof row.can_view_details === 'boolean' ? row.can_view_details : undefined,
    total_meters_scrolled: Number(row.total_meters_scrolled ?? 0),
    coin_balance: Number(row.coin_balance ?? 0),
    coin_meter_checkpoint: Number(row.coin_meter_checkpoint ?? 0),
    created_at: row.created_at ?? new Date(0).toISOString(),
  };
}

export function useFriends(userId: string) {
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [pendingReceived, setPendingReceived] = useState<FriendWithProfile[]>([]);
  const [pendingSent, setPendingSent] = useState<FriendWithProfile[]>([]);
  const [acceptanceNotices, setAcceptanceNotices] = useState<FriendAcceptanceNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);
  const prevPendingSentUserIdsRef = useRef<Set<string>>(new Set());
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }

    refreshInFlightRef.current = true;

    try {
      do {
        refreshQueuedRef.current = false;

        const { data: friendships, error: friendshipsError } = await supabase
          .from('friendships')
          .select('*')
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

        if (friendshipsError) {
          setLoading(false);
          continue;
        }

        const safeFriendships = (friendships as Friendship[] | null) ?? [];
        const otherUserIds = Array.from(
          new Set(
            safeFriendships.map((f) => (f.requester_id === userId ? f.addressee_id : f.requester_id)),
          ),
        );

        let profiles: Profile[] = [];
        if (otherUserIds.length > 0) {
          const { data, error: profilesError } = await supabase
            .rpc('get_social_profiles', {
              profile_ids: otherUserIds,
            });

          if (!profilesError) {
            profiles = ((data as SocialProfileRow[] | null) ?? []).map(toProfile);
          } else {
            const { data: legacyProfiles, error: legacyError } = await supabase
              .from('profiles')
              .select('*')
              .in('id', otherUserIds);

            if (legacyError) {
              setLoading(false);
              continue;
            }

            profiles = (legacyProfiles as Profile[]) ?? [];
          }
        }

        const profileMap = new Map<string, Profile>();
        for (const p of profiles) {
          profileMap.set(p.id, p as Profile);
        }

        const accepted: FriendWithProfile[] = [];
        const received: FriendWithProfile[] = [];
        const sent: FriendWithProfile[] = [];

        for (const f of safeFriendships) {
          const otherId = f.requester_id === userId ? f.addressee_id : f.requester_id;
          const profile = profileMap.get(otherId);
          if (!profile) continue;

          const item = { friendship: f, profile };

          if (f.status === 'accepted') {
            accepted.push(item);
          } else if (f.status === 'pending') {
            if (f.addressee_id === userId) {
              received.push(item);
            } else {
              sent.push(item);
            }
          }
        }

        setFriends(accepted);
        setPendingReceived(received);
        setPendingSent(sent);

        const nextPendingSentUserIds = new Set(sent.map((item) => item.profile.id));
        if (initializedRef.current) {
          const justAccepted = accepted
            .filter((item) => prevPendingSentUserIdsRef.current.has(item.profile.id))
            .map((item) => ({
              userId: item.profile.id,
              displayName: item.profile.display_name,
              username: item.profile.username,
            }));

          if (justAccepted.length > 0) {
            setAcceptanceNotices((prev) => {
              const seenIds = new Set(prev.map((notice) => notice.userId));
              const additions = justAccepted.filter((notice) => !seenIds.has(notice.userId));
              if (additions.length === 0) return prev;
              return [...prev, ...additions];
            });
          }
        }

        initializedRef.current = true;
        prevPendingSentUserIdsRef.current = nextPendingSentUserIds;
        setLoading(false);
      } while (refreshQueuedRef.current);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, FRIENDS_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const channel = supabase
      .channel(`friendships-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friendships', filter: `requester_id=eq.${userId}` },
        () => {
          void refresh();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friendships', filter: `addressee_id=eq.${userId}` },
        () => {
          void refresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  const dismissAcceptanceNotice = useCallback((userIdToDismiss: string) => {
    setAcceptanceNotices((prev) => prev.filter((notice) => notice.userId !== userIdToDismiss));
  }, []);

  const dismissAllAcceptanceNotices = useCallback(() => {
    setAcceptanceNotices([]);
  }, []);

  const sendRequest = async (targetUserId: string) => {
    // Optimistic pending-sent update for immediate UI response.
    const existingFriend = friends.find((item) => item.profile.id === targetUserId);
    if (existingFriend) return;

    const { data: existingRows, error: existingError } = await supabase
      .from('friendships')
      .select('*')
      .or(
        `and(requester_id.eq.${userId},addressee_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},addressee_id.eq.${userId})`,
      );

    if (existingError) throw existingError;

    const rows = (existingRows as Friendship[] | null) ?? [];
    if (rows.some((row) => row.status === 'accepted')) return;
    if (rows.some((row) => row.status === 'pending')) return;

    const rejectedIds = rows
      .filter((row) => row.status === 'rejected')
      .map((row) => row.id);

    if (rejectedIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('friendships')
        .delete()
        .in('id', rejectedIds);
      if (deleteError) throw deleteError;
    }

    const { error } = await supabase.from('friendships').insert({
      requester_id: userId,
      addressee_id: targetUserId,
      status: 'pending',
    });

    if (error) {
      if (isDuplicateFriendshipError(error)) {
        await refresh();
        return;
      }
      throw error;
    }

    await refresh();
  };

  const acceptRequest = async (friendshipId: string) => {
    const pending = pendingReceived.find((item) => item.friendship.id === friendshipId);
    if (pending) {
      setPendingReceived((prev) => prev.filter((item) => item.friendship.id !== friendshipId));
      setFriends((prev) => {
        if (prev.some((item) => item.profile.id === pending.profile.id)) return prev;
        return [...prev, { ...pending, friendship: { ...pending.friendship, status: 'accepted' } }];
      });
    }

    const { error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId);
    if (error) {
      await refresh();
      throw error;
    }
    await refresh();
  };

  const rejectRequest = async (friendshipId: string) => {
    setPendingReceived((prev) => prev.filter((item) => item.friendship.id !== friendshipId));

    const { error } = await supabase
      .from('friendships')
      .update({ status: 'rejected' })
      .eq('id', friendshipId);
    if (error) {
      await refresh();
      throw error;
    }
    await refresh();
  };

  const removeFriend = async (friendshipId: string) => {
    setFriends((prev) => prev.filter((item) => item.friendship.id !== friendshipId));

    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);
    if (error) {
      await refresh();
      throw error;
    }
    await refresh();
  };

  const searchUsers = async (query: string): Promise<Profile[]> => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const normalizedTokens = normalizeForSearch(trimmed).split(' ').filter(Boolean);
    if (normalizedTokens.length === 0) return [];
    const clauses = Array.from(
      new Set(
        normalizedTokens.flatMap((token) => [
          `username.ilike.%${token}%`,
          `display_name.ilike.%${token}%`,
        ]),
      ),
    );

    const queryBuilder = supabase
      .rpc('search_profiles_for_friend_requests', {
        search_query: trimmed,
        result_limit: 40,
      });

    const { data, error } = await queryBuilder;
    if (error) {
      let fallbackQuery = supabase
        .from('profiles')
        .select('*')
        .neq('id', userId)
        .limit(40);

      if (clauses.length > 0) {
        fallbackQuery = fallbackQuery.or(clauses.join(','));
      }

      const { data: fallbackData, error: fallbackError } = await fallbackQuery;
      if (fallbackError) throw fallbackError;

      return ((fallbackData as Profile[]) ?? [])
        .map((profile) => ({ profile, score: scoreProfile(trimmed, profile) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.profile.username.localeCompare(b.profile.username))
        .slice(0, 10)
        .map((item) => item.profile);
    }

    // Keep tokenized matching in the client for deterministic ranking behavior.
    return (((data as SocialProfileRow[] | null) ?? []).map(toProfile))
      .map((profile) => ({ profile, score: scoreProfile(trimmed, profile) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.profile.username.localeCompare(b.profile.username))
      .slice(0, 10)
      .map((item) => item.profile);
  };

  return {
    friends,
    pendingReceived,
    pendingSent,
    acceptanceNotices,
    loading,
    refresh,
    sendRequest,
    acceptRequest,
    rejectRequest,
    removeFriend,
    searchUsers,
    dismissAcceptanceNotice,
    dismissAllAcceptanceNotices,
  };
}
