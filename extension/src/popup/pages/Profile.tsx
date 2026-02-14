import { useState, useEffect, useRef, useCallback, type ChangeEvent } from 'react';
import { supabase } from '@/shared/supabase';
import type { Profile as ProfileType, Achievement } from '@/shared/types';
import { prepareAvatarUploadDataUrl } from '@/shared/avatar';
import { writeProfileToCache } from '@/shared/profile-cache';

const CACHE_KEY_PROFILE = 'cached_profile_';
const CACHE_KEY_ACHIEVEMENTS = 'cached_achievements_';

interface ProfileProps {
  userId: string;
  isOwnProfile: boolean;
  onBack?: () => void;
  cachedProfile?: ProfileType | null;
  onProfileUpdated?: () => void | Promise<void>;
}

export default function Profile({
  userId,
  isOwnProfile,
  onBack,
  cachedProfile,
  onProfileUpdated,
}: ProfileProps) {
  const [profile, setProfile] = useState<ProfileType | null>(cachedProfile ?? null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(!cachedProfile);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState('');
  const [avatarMessageType, setAvatarMessageType] = useState<'success' | 'error'>('success');
  const [avatarBroken, setAvatarBroken] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const avatarMessageTimerRef = useRef<number | null>(null);

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
      if (!cachedProfile) {
        const cached = await chrome.storage.local.get([
          CACHE_KEY_PROFILE + userId,
          CACHE_KEY_ACHIEVEMENTS + userId,
        ]);
        const cp = cached[CACHE_KEY_PROFILE + userId];
        const ca = cached[CACHE_KEY_ACHIEVEMENTS + userId];
        if (mounted && cp) { setProfile(cp); setLoading(false); }
        if (mounted && ca) setAchievements(ca);
      }
      if (mounted && cachedProfile) setLoading(false);

      // 2. Refresh from network in background
      const [profileRes, achievementsRes] = await Promise.all([
        cachedProfile ? Promise.resolve(null) :
          supabase.from('profiles').select('*').eq('id', userId).single(),
        supabase.from('achievements').select('*').eq('user_id', userId)
          .order('earned_at', { ascending: false }),
      ]);

      if (!mounted) return;

      if (profileRes?.data) {
        setProfile(profileRes.data as ProfileType);
        void syncProfileCaches(profileRes.data as ProfileType);
      }
      if (achievementsRes.data) {
        setAchievements(achievementsRes.data as Achievement[]);
        chrome.storage.local.set({ [CACHE_KEY_ACHIEVEMENTS + userId]: achievementsRes.data });
      }
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, [userId, cachedProfile, syncProfileCaches]);

  useEffect(() => {
    setAvatarBroken(false);
  }, [profile?.avatar_url]);

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
        <p className="text-3xl mb-2">🔒</p>
        <p className="text-doom-muted text-sm">Profile not found or private.</p>
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
        {!profile.is_public && (
          <span className="inline-block text-[10px] text-neon-pink border border-neon-pink/30 rounded px-1.5 py-0.5 mt-1">
            PRIVATE
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="card text-center">
          <p className="text-doom-muted text-[10px] font-mono uppercase">Total Scrolled</p>
          <p className="text-lg font-bold font-mono neon-text-green">
            {profile.total_meters_scrolled < 1000
              ? `${Math.round(profile.total_meters_scrolled)}m`
              : `${(profile.total_meters_scrolled / 1000).toFixed(2)}km`}
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
          <div className="grid grid-cols-4 gap-2">
            {achievements.map((a) => (
              <div
                key={a.id}
                className="card flex flex-col items-center gap-1 p-2"
                title={`${a.title}: ${a.description}`}
              >
                <span className="text-xl">{a.icon}</span>
                <span className="text-[9px] text-doom-muted font-mono text-center leading-tight truncate w-full">
                  {a.title}
                </span>
              </div>
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
    </div>
  );
}
