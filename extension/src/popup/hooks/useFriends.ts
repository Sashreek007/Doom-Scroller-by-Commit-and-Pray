import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/shared/supabase';
import type { Profile, Friendship } from '@/shared/types';

interface FriendWithProfile {
  friendship: Friendship;
  profile: Profile;
}

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

export function useFriends(userId: string) {
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [pendingReceived, setPendingReceived] = useState<FriendWithProfile[]>([]);
  const [pendingSent, setPendingSent] = useState<FriendWithProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Fetch all friendships involving this user
    const { data: friendships } = await supabase
      .from('friendships')
      .select('*')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

    if (!friendships) {
      setLoading(false);
      return;
    }

    // Collect all other user IDs
    const otherUserIds = Array.from(
      new Set(friendships.map((f) => (f.requester_id === userId ? f.addressee_id : f.requester_id))),
    );

    // Fetch profiles for those users
    let profiles: Profile[] = [];
    if (otherUserIds.length > 0) {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .in('id', otherUserIds);
      profiles = (data as Profile[]) ?? [];
    }

    const profileMap = new Map<string, Profile>();
    for (const p of profiles) {
      profileMap.set(p.id, p as Profile);
    }

    const accepted: FriendWithProfile[] = [];
    const received: FriendWithProfile[] = [];
    const sent: FriendWithProfile[] = [];

    for (const f of friendships as Friendship[]) {
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
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sendRequest = async (targetUserId: string) => {
    const { error } = await supabase.from('friendships').insert({
      requester_id: userId,
      addressee_id: targetUserId,
    });
    if (error) throw error;
    await refresh();
  };

  const acceptRequest = async (friendshipId: string) => {
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId);
    if (error) throw error;
    await refresh();
  };

  const rejectRequest = async (friendshipId: string) => {
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'rejected' })
      .eq('id', friendshipId);
    if (error) throw error;
    await refresh();
  };

  const removeFriend = async (friendshipId: string) => {
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);
    if (error) throw error;
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

    let queryBuilder = supabase
      .from('profiles')
      .select('*')
      .neq('id', userId)
      .limit(40);

    if (clauses.length > 0) {
      queryBuilder = queryBuilder.or(clauses.join(','));
    }

    const { data } = await queryBuilder;

    return ((data as Profile[]) ?? [])
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
    loading,
    refresh,
    sendRequest,
    acceptRequest,
    rejectRequest,
    removeFriend,
    searchUsers,
  };
}
