import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/shared/supabase';
import type { LeaderboardEntry } from '@/shared/types';

interface LeaderboardProps {
  userId: string;
  onViewProfile: (userId: string) => void;
}

type Tab = 'world' | 'friends';
const LEADERBOARD_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const LEADERBOARD_CACHE_TTL_MS = 2 * 60 * 1000;

interface ProfileRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  total_meters_scrolled: number | string;
  is_public?: boolean;
}

interface LeaderboardData {
  entries: LeaderboardEntry[];
  myRank: LeaderboardEntry | null;
}

interface LeaderboardCachePayload extends LeaderboardData {
  updatedAt: number;
}

export default function Leaderboard({ userId, onViewProfile }: LeaderboardProps) {
  const [tab, setTab] = useState<Tab>('world');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<LeaderboardEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cacheKey = `cached_leaderboard_${tab}_${userId}`;

  const loadWorldLeaderboard = useCallback(async (): Promise<LeaderboardData> => {
    // Primary source: materialized view with precomputed global rank across DB users.
    const { data: viewTop, error: viewTopError } = await withTimeout(async () => (
      await supabase
        .from('leaderboard_world')
        .select('*')
        .order('rank', { ascending: true })
        .limit(50)
    ));

    if (!viewTopError && viewTop) {
      const typedTop = (viewTop ?? []) as LeaderboardEntry[];

      const meInTop = typedTop.find((entry) => entry.user_id === userId);
      if (meInTop) {
        return {
          entries: typedTop,
          myRank: meInTop,
        };
      }

      const { data: myRankRow, error: myRankError } = await withTimeout(async () => (
        await supabase
          .from('leaderboard_world')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle()
      ));

      if (!myRankError) {
        return {
          entries: typedTop,
          myRank: (myRankRow as LeaderboardEntry | null) ?? null,
        };
      }
    }

    // Fallback: rank public profiles live if view is unavailable or stale.
    const { data: topProfiles, error: topProfilesError } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, total_meters_scrolled')
      .eq('is_public', true)
      .order('total_meters_scrolled', { ascending: false })
      .limit(50);

    if (topProfilesError) throw topProfilesError;

    const ranked = rankProfiles((topProfiles ?? []) as ProfileRow[]);

    const meInTop = ranked.find((entry) => entry.user_id === userId);
    if (meInTop) {
      return {
        entries: ranked,
        myRank: meInTop,
      };
    }

    const { data: meProfile, error: meProfileError } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, total_meters_scrolled, is_public')
      .eq('id', userId)
      .single();

    if (meProfileError || !meProfile || !meProfile.is_public) {
      return {
        entries: ranked,
        myRank: null,
      };
    }

    const myMeters = Number(meProfile.total_meters_scrolled ?? 0);
    const { count, error: rankCountError } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_public', true)
      .gt('total_meters_scrolled', myMeters);

    if (rankCountError) throw rankCountError;

    return {
      entries: ranked,
      myRank: {
        user_id: meProfile.id,
        username: meProfile.username,
        display_name: meProfile.display_name,
        avatar_url: meProfile.avatar_url,
        total_meters: myMeters,
        rank: (count ?? 0) + 1,
      },
    };
  }, [userId]);

  const loadFriendsLeaderboard = useCallback(async (): Promise<LeaderboardData> => {
    const { data: friendships, error: friendshipsError } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .eq('status', 'accepted');

    if (friendshipsError) throw friendshipsError;

    const ids = new Set<string>([userId]);
    for (const friendship of friendships ?? []) {
      ids.add(friendship.requester_id === userId ? friendship.addressee_id : friendship.requester_id);
    }

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, total_meters_scrolled')
      .in('id', [...ids])
      .order('total_meters_scrolled', { ascending: false });

    if (profilesError) throw profilesError;

    const ranked = rankProfiles((profiles ?? []) as ProfileRow[]);
    return {
      entries: ranked,
      myRank: ranked.find((entry) => entry.user_id === userId) ?? null,
    };
  }, [userId]);

  useEffect(() => {
    let mounted = true;
    let hasLoadedFromCache = false;

    async function loadFromCache() {
      const result = await chrome.storage.local.get(cacheKey);
      const cached = result[cacheKey] as LeaderboardCachePayload | undefined;
      if (!cached) return;
      if ((Date.now() - cached.updatedAt) > LEADERBOARD_CACHE_TTL_MS) return;
      if (!mounted) return;
      hasLoadedFromCache = true;
      setEntries(cached.entries);
      setMyRank(cached.myRank);
      setLoading(false);
    }

    async function saveToCache(data: LeaderboardData) {
      const payload: LeaderboardCachePayload = {
        ...data,
        updatedAt: Date.now(),
      };
      await chrome.storage.local.set({ [cacheKey]: payload });
    }

    async function loadFromNetwork() {
      setError(null);

      try {
        const data = tab === 'world'
          ? await loadWorldLeaderboard()
          : await loadFriendsLeaderboard();
        if (!mounted) return;

        setEntries(data.entries);
        setMyRank(data.myRank);
        setLoading(false);
        void saveToCache(data);
      } catch (e) {
        if (!mounted) return;
        if (!hasLoadedFromCache) {
          setEntries([]);
          setMyRank(null);
        }
        setError(e instanceof Error ? e.message : 'Failed to load leaderboard');
        setLoading(false);
      }
    }

    async function init() {
      setLoading(true);
      await loadFromCache();
      if (!mounted) return;
      await loadFromNetwork();
    }

    void init();
    const interval = setInterval(() => {
      void loadFromNetwork();
    }, LEADERBOARD_REFRESH_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [cacheKey, loadFriendsLeaderboard, loadWorldLeaderboard, tab]);

  useEffect(() => {
    if (!error) return;
    const timeout = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timeout);
  }, [error]);

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
            <span className="inline-flex items-center gap-2">
              {t === 'world' ? <WorldIcon className="w-4 h-4" /> : <FriendsIcon className="w-4 h-4" />}
              <span>{t === 'world' ? 'World' : 'Friends'}</span>
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="card border-neon-pink/30 text-neon-pink text-xs">
          Failed to load leaderboard: {error}
        </div>
      )}

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
              <span className="w-8 flex justify-center">
                <RankBadge rank={entry.rank} />
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

async function withTimeout<T>(run: () => Promise<T>, timeoutMs = 4000): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
  });

  try {
    return await Promise.race([run(), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function formatMeters(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

function rankProfiles(profiles: ProfileRow[]): LeaderboardEntry[] {
  let prevMeters: number | null = null;
  let prevRank = 0;

  return profiles.map((profile, idx) => {
    const meters = Number(profile.total_meters_scrolled ?? 0);
    let rank = prevRank;
    if (prevMeters === null || meters < prevMeters) {
      rank = idx + 1;
      prevRank = rank;
      prevMeters = meters;
    }

    return {
      user_id: profile.id,
      username: profile.username,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      total_meters: meters,
      rank,
    };
  });
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="w-6 h-6 rounded-full bg-yellow-400 text-black text-xs font-bold font-mono flex items-center justify-center">
        1
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="w-6 h-6 rounded-full bg-slate-300 text-black text-xs font-bold font-mono flex items-center justify-center">
        2
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="w-6 h-6 rounded-full bg-amber-600 text-black text-xs font-bold font-mono flex items-center justify-center">
        3
      </span>
    );
  }
  return <span className="font-mono text-sm text-doom-muted">#{rank}</span>;
}

function WorldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
    </svg>
  );
}

function FriendsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
