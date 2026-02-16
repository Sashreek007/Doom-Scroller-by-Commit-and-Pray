import { useState, useEffect, useRef, useCallback, type ChangeEvent } from 'react';
import { supabase } from '@/shared/supabase';
import type { Profile as ProfileType, Achievement, AchievementRarity } from '@/shared/types';
import { prepareAvatarUploadDataUrl } from '@/shared/avatar';
import { writeProfileToCache } from '@/shared/profile-cache';
import { metersToCoins } from '@/shared/coins';
import { getVisibilityLabel } from '@/shared/privacy';
import type { AchievementSyncedMessage } from '@/shared/messages';
import GoldCoinIcon from '../components/GoldCoinIcon';
import AchievementBadgeArt from '../components/AchievementBadgeArt';

const CACHE_KEY_PROFILE = 'cached_profile_';
const CACHE_KEY_ACHIEVEMENTS = 'cached_achievements_';

function getAchievementRarity(rarity: Achievement['rarity']): AchievementRarity {
  if (rarity === 'rare' || rarity === 'epic' || rarity === 'legendary') return rarity;
  return 'common';
}

function getRarityClasses(rarity: AchievementRarity): string {
  if (rarity === 'legendary') {
    return 'border-amber-400/60 bg-doom-surface';
  }
  if (rarity === 'epic') {
    return 'border-cyan-400/55 bg-doom-surface';
  }
  if (rarity === 'rare') {
    return 'border-neon-green/45 bg-doom-surface';
  }
  return 'border-doom-border bg-doom-surface';
}

function getRoastLine(meta: Achievement['meta']): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const value = (meta as Record<string, unknown>).roast_line;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function formatAchievementDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function PrivateAccountIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="16" r="1.2" />
    </svg>
  );
}

function getPrivacyChip(profile: ProfileType): { text: string; className: string } | null {
  const visibility = getVisibilityLabel(profile);
  if (visibility === 'public') return null;
  if (visibility === 'friends') {
    return {
      text: 'FRIENDS ONLY',
      className: 'text-yellow-300 border-yellow-300/40',
    };
  }
  return {
    text: 'PRIVATE',
    className: 'text-neon-pink border-neon-pink/30',
  };
}

function isAchievementSyncedMessage(value: unknown): value is AchievementSyncedMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as { type?: unknown; payload?: unknown };
  if (message.type !== 'ACHIEVEMENT_SYNCED') return false;
  if (!message.payload || typeof message.payload !== 'object') return false;
  const payload = message.payload as { userId?: unknown; eventKey?: unknown };
  return typeof payload.userId === 'string' && typeof payload.eventKey === 'string';
}

interface ProfileProps {
  userId: string;
  isOwnProfile: boolean;
  onBack?: () => void;
  cachedProfile?: ProfileType | null;
  onProfileUpdated?: () => void | Promise<void>;
  liveTotalMeters?: number;
}

interface SocialProfileRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  total_meters_scrolled: number | string;
  created_at?: string;
  is_public?: boolean;
  world_public?: boolean;
  friends_public?: boolean;
  can_view_details?: boolean;
  coin_balance?: number | string | null;
  coin_meter_checkpoint?: number | string | null;
}

function toProfile(row: SocialProfileRow): ProfileType {
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

export default function Profile({
  userId,
  isOwnProfile,
  onBack,
  cachedProfile,
  onProfileUpdated,
  liveTotalMeters,
}: ProfileProps) {
  const [profile, setProfile] = useState<ProfileType | null>((isOwnProfile ? cachedProfile : null) ?? null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(isOwnProfile ? !cachedProfile : true);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState('');
  const [avatarMessageType, setAvatarMessageType] = useState<'success' | 'error'>('success');
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [selectedAchievement, setSelectedAchievement] = useState<Achievement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const avatarMessageTimerRef = useRef<number | null>(null);

  const refreshAchievements = useCallback(async () => {
    const { data } = await supabase
      .from('achievements')
      .select('*')
      .eq('user_id', userId)
      .order('earned_at', { ascending: false });

    if (!data) return;

    setAchievements(data as Achievement[]);
    await chrome.storage.local.set({ [CACHE_KEY_ACHIEVEMENTS + userId]: data });
  }, [userId]);

  const syncProfileCaches = useCallback(async (nextProfile: ProfileType) => {
    try {
      await writeProfileToCache(nextProfile, {
        includeProfileCache: true,
        includeAuthCache: isOwnProfile,
        preferredUserId: isOwnProfile ? nextProfile.id : undefined,
      });
    } catch {
      // Ignore cache sync failures; DB remains source of truth.
    }
  }, [isOwnProfile]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      // 1. Load from local cache first (instant)
      if (isOwnProfile && !cachedProfile) {
        const cached = await chrome.storage.local.get([
          CACHE_KEY_PROFILE + userId,
          CACHE_KEY_ACHIEVEMENTS + userId,
        ]);
        const cp = cached[CACHE_KEY_PROFILE + userId];
        const ca = cached[CACHE_KEY_ACHIEVEMENTS + userId];
        if (mounted && cp) { setProfile(cp); setLoading(false); }
        if (mounted && ca) setAchievements(ca);
      }
      if (mounted && isOwnProfile && cachedProfile) setLoading(false);

      // 2. Refresh from network in background
      let profileFromNetwork: ProfileType | null = null;
      let canViewDetails = true;

      if (isOwnProfile) {
        if (!cachedProfile) {
          const profileRes = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
          if (profileRes.data) {
            profileFromNetwork = profileRes.data as ProfileType;
          }
        } else {
          profileFromNetwork = cachedProfile;
        }
      } else {
        const socialRes = await supabase.rpc('get_social_profiles', { profile_ids: [userId] });
        if (!socialRes.error) {
          const socialRow = ((socialRes.data as SocialProfileRow[] | null) ?? [])[0] ?? null;
          if (!socialRow || socialRow.can_view_details === false) {
            canViewDetails = false;
          } else {
            profileFromNetwork = toProfile(socialRow);
          }
        } else {
          const fallbackRes = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
          if (!fallbackRes.data) {
            canViewDetails = false;
          } else {
            profileFromNetwork = fallbackRes.data as ProfileType;
          }
        }
      }

      if (!canViewDetails) {
        if (!mounted) return;
        setProfile(null);
        setAchievements([]);
        setLoading(false);
        if (!isOwnProfile) {
          await chrome.storage.local.remove([
            CACHE_KEY_PROFILE + userId,
            CACHE_KEY_ACHIEVEMENTS + userId,
          ]);
        }
        return;
      }

      const achievementsRes = await supabase
        .from('achievements')
        .select('*')
        .eq('user_id', userId)
        .order('earned_at', { ascending: false });

      if (!mounted) return;

      if (profileFromNetwork) {
        setProfile(profileFromNetwork);
        if (isOwnProfile) {
          void syncProfileCaches(profileFromNetwork);
        }
      }
      if (achievementsRes.data) {
        setAchievements(achievementsRes.data as Achievement[]);
        if (isOwnProfile) {
          chrome.storage.local.set({ [CACHE_KEY_ACHIEVEMENTS + userId]: achievementsRes.data });
        }
      }
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, [userId, cachedProfile, isOwnProfile, syncProfileCaches]);

  useEffect(() => {
    setAvatarBroken(false);
  }, [profile?.avatar_url]);

  useEffect(() => {
    if (!isOwnProfile) return;

    const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message) => {
      if (!isAchievementSyncedMessage(message)) return;
      if (message.payload.userId !== userId) return;
      void refreshAchievements();
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [isOwnProfile, refreshAchievements, userId]);

  useEffect(() => () => {
    if (avatarMessageTimerRef.current !== null) {
      window.clearTimeout(avatarMessageTimerRef.current);
    }
  }, []);

  const handleAvatarFileSelected = useCallback(async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file || !profile || !isOwnProfile) return;

    setAvatarBusy(true);
    setAvatarMessage('');
    setAvatarMessageType('success');
    const previous = profile;

    try {
      const compressedDataUrl = await prepareAvatarUploadDataUrl(file);
      const optimistic = { ...previous, avatar_url: compressedDataUrl };
      setProfile(optimistic);
      setAvatarBroken(false);

      const { data, error } = await supabase
        .from('profiles')
        .update({ avatar_url: compressedDataUrl })
        .eq('id', userId)
        .select('*')
        .single();

      if (error) {
        setProfile(previous);
        throw error;
      }

      const updated = (data as ProfileType) ?? optimistic;
      setProfile(updated);
      await syncProfileCaches(updated);
      void onProfileUpdated?.();
      setAvatarMessage('Profile picture updated');
      setAvatarMessageType('success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload profile picture';
      setAvatarMessage(message);
      setAvatarMessageType('error');
    } finally {
      setAvatarBusy(false);
      if (avatarMessageTimerRef.current !== null) {
        window.clearTimeout(avatarMessageTimerRef.current);
      }
      avatarMessageTimerRef.current = window.setTimeout(() => setAvatarMessage(''), 2200);
    }
  }, [isOwnProfile, onProfileUpdated, profile, syncProfileCaches, userId]);

  const handleRemoveAvatar = useCallback(async () => {
    if (!profile || !isOwnProfile || !profile.avatar_url) return;

    setAvatarBusy(true);
    setAvatarMessage('');
    setAvatarMessageType('success');
    const previous = profile;
    const optimistic = { ...previous, avatar_url: null };
    setProfile(optimistic);

    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', userId)
        .select('*')
        .single();

      if (error) {
        setProfile(previous);
        throw error;
      }

      const updated = (data as ProfileType) ?? optimistic;
      setProfile(updated);
      await syncProfileCaches(updated);
      void onProfileUpdated?.();
      setAvatarMessage('Profile picture removed');
      setAvatarMessageType('success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove profile picture';
      setAvatarMessage(message);
      setAvatarMessageType('error');
    } finally {
      setAvatarBusy(false);
      if (avatarMessageTimerRef.current !== null) {
        window.clearTimeout(avatarMessageTimerRef.current);
      }
      avatarMessageTimerRef.current = window.setTimeout(() => setAvatarMessage(''), 2200);
    }
  }, [isOwnProfile, onProfileUpdated, profile, syncProfileCaches, userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-doom-muted font-mono text-sm animate-pulse">Loading profile...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="text-center py-8">
        <div className="mx-auto mb-3 w-12 h-12 rounded-full border border-doom-border bg-doom-surface/70 flex items-center justify-center">
          <PrivateAccountIcon className="w-6 h-6 text-doom-muted" />
        </div>
        <p className="text-doom-muted text-sm">Account private or unavailable.</p>
        {onBack && (
          <button onClick={onBack} className="btn-primary text-xs mt-4">
            Go Back
          </button>
        )}
      </div>
    );
  }

  const memberSince = new Date(profile.created_at).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
  const totalMetersForDisplay = (
    isOwnProfile && typeof liveTotalMeters === 'number'
      ? Math.max(Number(profile.total_meters_scrolled ?? 0), liveTotalMeters)
      : Number(profile.total_meters_scrolled ?? 0)
  );
  const coins = Number.isFinite(Number(profile.coin_balance))
    ? Math.max(0, Math.floor(Number(profile.coin_balance)))
    : metersToCoins(totalMetersForDisplay);
  const privacyChip = getPrivacyChip(profile);

  return (
    <div className="flex flex-col gap-4">
      {onBack && (
        <button
          onClick={onBack}
          className="text-doom-muted text-xs font-mono hover:text-white self-start"
        >
          ← Back
        </button>
      )}

      <div className="text-center py-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-yellow-500/10 border border-yellow-400/40 mb-2 shadow-[0_0_10px_rgba(250,204,21,0.18)]">
          <GoldCoinIcon className="w-4 h-4" />
          <span className="text-yellow-100 text-sm font-semibold font-mono tabular-nums">
            {coins}
          </span>
        </div>
        {isOwnProfile ? (
          <div className="w-16 h-16 rounded-full bg-doom-surface border-2 border-neon-green/30 mx-auto mb-3 overflow-hidden flex items-center justify-center">
            {profile.avatar_url && !avatarBroken ? (
              <img
                src={profile.avatar_url}
                alt={`${profile.display_name} profile picture`}
                className="w-full h-full object-cover"
                onError={() => setAvatarBroken(true)}
              />
            ) : (
              <span className="text-2xl">💀</span>
            )}
          </div>
        ) : (
          <div className="w-16 h-16 rounded-full bg-doom-surface border-2 border-neon-green/30 mx-auto mb-3 overflow-hidden flex items-center justify-center">
            {profile.avatar_url && !avatarBroken ? (
              <img
                src={profile.avatar_url}
                alt={`${profile.display_name} profile picture`}
                className="w-full h-full object-cover"
                onError={() => setAvatarBroken(true)}
              />
            ) : (
              <span className="text-2xl">💀</span>
            )}
          </div>
        )}
        {isOwnProfile && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarFileSelected}
              className="hidden"
            />
            <div className="flex items-center justify-center gap-2 mb-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarBusy}
                className="px-2.5 py-1 rounded-md border border-neon-green/30 text-[11px] text-neon-green font-mono hover:bg-neon-green/10 disabled:opacity-50"
              >
                Change
              </button>
              <button
                onClick={handleRemoveAvatar}
                disabled={avatarBusy || !profile.avatar_url}
                className="px-2.5 py-1 rounded-md border border-neon-pink/30 text-[11px] text-neon-pink font-mono hover:bg-neon-pink/10 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
            {avatarMessage && (
              <p className={`text-[10px] font-mono mb-1 ${avatarMessageType === 'error' ? 'text-neon-pink' : 'text-neon-green'}`}>
                {avatarMessage}
              </p>
            )}
          </>
        )}
        <h2 className="text-lg font-bold font-mono text-white">
          {profile.display_name}
        </h2>
        <p className="text-doom-muted text-xs font-mono">@{profile.username}</p>
        {privacyChip && (
          <span className={`inline-block text-[10px] border rounded px-1.5 py-0.5 mt-1 ${privacyChip.className}`}>
            {privacyChip.text}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="card text-center">
          <p className="text-doom-muted text-[10px] font-mono uppercase">Total Scrolled</p>
          <p className="text-lg font-bold font-mono neon-text-green">
            {totalMetersForDisplay < 1000
              ? `${Math.round(totalMetersForDisplay)}m`
              : `${(totalMetersForDisplay / 1000).toFixed(2)}km`}
          </p>
        </div>
        <div className="card text-center">
          <p className="text-doom-muted text-[10px] font-mono uppercase">Member Since</p>
          <p className="text-lg font-bold font-mono text-white">{memberSince}</p>
        </div>
      </div>

      <div>
        <p className="text-doom-muted text-xs font-mono uppercase tracking-wider mb-2">
          Achievements ({achievements.length})
        </p>
        {achievements.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {achievements.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelectedAchievement(a)}
                className={`card flex flex-col items-center gap-1.5 p-2 text-left transition-transform hover:-translate-y-0.5 ${getRarityClasses(getAchievementRarity(a.rarity))}`}
                title={`${a.title}: ${a.description}${getRoastLine(a.meta) ? ` — ${getRoastLine(a.meta)}` : ''}`}
              >
                <AchievementBadgeArt
                  achievement={a}
                  rarity={getAchievementRarity(a.rarity)}
                  size="sm"
                />
                <span className="text-[10px] text-doom-muted font-mono text-center leading-tight min-h-[2.1rem] w-full">
                  {a.title}
                </span>
                <span className="text-[8px] uppercase tracking-wider text-doom-muted/80 font-mono">
                  {getAchievementRarity(a.rarity)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="card text-center py-4">
            <p className="text-doom-muted text-xs">
              {isOwnProfile
                ? 'No achievements yet. Keep scrolling (or don\'t).'
                : 'No achievements to show.'}
            </p>
          </div>
        )}
      </div>

      {selectedAchievement && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[1px] flex items-center justify-center px-4"
          onClick={() => setSelectedAchievement(null)}
        >
          <div
            className={`w-full max-w-[320px] rounded-xl border p-4 bg-[#080b11] shadow-[0_18px_50px_rgba(0,0,0,0.55)] ${getRarityClasses(getAchievementRarity(selectedAchievement.rarity))}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <AchievementBadgeArt
                  achievement={selectedAchievement}
                  rarity={getAchievementRarity(selectedAchievement.rarity)}
                  size="lg"
                />
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-mono text-doom-muted">
                    Achievement
                  </p>
                  <p className="text-[10px] uppercase tracking-wider font-mono text-white/80">
                    {getAchievementRarity(selectedAchievement.rarity)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAchievement(null)}
                className="text-doom-muted hover:text-white text-xl leading-none"
                aria-label="Close achievement details"
              >
                ×
              </button>
            </div>

            <h3 className="text-sm font-semibold font-mono text-white mb-2 leading-snug">
              {selectedAchievement.title}
            </h3>
            <p className="text-xs text-doom-muted leading-relaxed mb-3">
              {selectedAchievement.description}
            </p>

            {getRoastLine(selectedAchievement.meta) && (
              <p className="text-[11px] text-neon-green/90 italic mb-3">
                "{getRoastLine(selectedAchievement.meta)}"
              </p>
            )}

            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-doom-muted">
              <div className="bg-doom-surface border border-doom-border rounded-md px-2 py-1.5">
                Unlocked
                <div className="text-white mt-0.5">{formatAchievementDate(selectedAchievement.earned_at)}</div>
              </div>
              <div className="bg-doom-surface border border-doom-border rounded-md px-2 py-1.5">
                Trigger
                <div className="text-white mt-0.5 break-all leading-snug">
                  {selectedAchievement.trigger_type}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
