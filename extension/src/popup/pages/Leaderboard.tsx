import { useState, useEffect } from 'react';
import { supabase } from '@/shared/supabase';
import type { LeaderboardEntry } from '@/shared/types';

interface LeaderboardProps {
  userId: string;
  onViewProfile: (userId: string) => void;
}

type Tab = 'world' | 'friends';

const RANK_ICONS: Record<number, string> = {
  1: '🔥',
  2: '💀',
  3: '👑',
};

export default function Leaderboard({ userId, onViewProfile }: LeaderboardProps) {
  const [tab, setTab] = useState<Tab>('world');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<LeaderboardEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      if (tab === 'world') {
        // Fetch from materialized view
        const { data } = await supabase
          .from('leaderboard_world')
          .select('*')
          .order('rank', { ascending: true })
          .limit(50);

        const typed = (data ?? []) as LeaderboardEntry[];
        setEntries(typed);

        // Find own rank
        const me = typed.find((e) => e.user_id === userId);
        if (me) {
          setMyRank(me);
        } else {
          // Might not be in top 50, fetch separately
          const { data: myData } = await supabase
            .from('leaderboard_world')
            .select('*')
            .eq('user_id', userId)
            .single();
          setMyRank(myData as LeaderboardEntry | null);
        }
      } else {
        // Friends leaderboard: get friend IDs then fetch profiles
        const { data: friendships } = await supabase
          .from('friendships')
          .select('requester_id, addressee_id')
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
          .eq('status', 'accepted');

        const friendIds = (friendships ?? []).map((f) =>
          f.requester_id === userId ? f.addressee_id : f.requester_id,
        );
        friendIds.push(userId); // Include self

        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url, total_meters_scrolled')
          .in('id', friendIds)
          .order('total_meters_scrolled', { ascending: false });

        const ranked: LeaderboardEntry[] = (profiles ?? []).map((p, i) => ({
          user_id: p.id,
          username: p.username,
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          total_meters: Number(p.total_meters_scrolled),
          rank: i + 1,
        }));

        setEntries(ranked);
        setMyRank(ranked.find((e) => e.user_id === userId) ?? null);
      }

      setLoading(false);
    }
    load();
  }, [tab, userId]);

  return (
    <div className="flex flex-col gap-4">
      {/* Tabs */}
      <div className="flex gap-2">
        {(['world', 'friends'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-mono font-medium transition-all
              ${
                tab === t
                  ? 'bg-neon-green/10 text-neon-green border border-neon-green/30'
                  : 'bg-doom-surface text-doom-muted border border-doom-border hover:text-white'
              }`}
          >
            {t === 'world' ? '🌍 World' : '👥 Friends'}
          </button>
        ))}
      </div>

      {/* My rank card */}
      {myRank && (
        <div className="card neon-border">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold font-mono neon-text-green">
              #{myRank.rank}
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium">You</p>
              <p className="text-doom-muted text-xs font-mono">@{myRank.username}</p>
            </div>
            <span className="text-sm font-mono font-bold neon-text-green">
              {formatMeters(myRank.total_meters)}
            </span>
          </div>
        </div>
      )}

      {/* Leaderboard list */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <p className="text-doom-muted font-mono text-sm animate-pulse">Loading...</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="card text-center py-4">
          <p className="text-doom-muted text-xs">
            {tab === 'world'
              ? 'No scrollers yet. Be the first!'
              : 'Add some friends to see their ranking here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map((entry) => (
            <button
              key={entry.user_id}
              onClick={() => onViewProfile(entry.user_id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all
                ${
                  entry.user_id === userId
                    ? 'bg-neon-green/5 border border-neon-green/20'
                    : 'hover:bg-doom-surface'
                }`}
            >
              <span className="w-8 text-center font-mono text-sm font-bold">
                {RANK_ICONS[entry.rank] ?? `#${entry.rank}`}
              </span>
              <div className="flex-1 text-left">
                <p className="text-sm">
                  {entry.display_name}
                  {entry.user_id === userId && (
                    <span className="text-neon-green text-xs ml-1">(you)</span>
                  )}
                </p>
                <p className="text-doom-muted text-xs font-mono">@{entry.username}</p>
              </div>
              <span className="text-xs font-mono text-doom-muted">
                {formatMeters(entry.total_meters)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatMeters(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}
