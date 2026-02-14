import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/shared/supabase';
import type { Profile, Friendship } from '@/shared/types';

interface FriendWithProfile {
  friendship: Friendship;
  profile: Profile;
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
    const otherUserIds = friendships.map((f) =>
      f.requester_id === userId ? f.addressee_id : f.requester_id,
    );

    // Fetch profiles for those users
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .in('id', otherUserIds);

    const profileMap = new Map<string, Profile>();
    if (profiles) {
      for (const p of profiles) {
        profileMap.set(p.id, p as Profile);
      }
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
    if (query.length < 2) return [];
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .ilike('username', `%${query}%`)
      .neq('id', userId)
      .limit(10);
    return (data as Profile[]) ?? [];
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
