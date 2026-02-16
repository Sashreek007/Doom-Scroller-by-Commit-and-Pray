import { useEffect, useState } from 'react';
import { supabase } from '@/shared/supabase';
import type { Profile } from '@/shared/types';
import {
  STRONG_PASSWORD_REQUIREMENTS,
  validateStrongPassword,
} from '@/shared/password-policy';
import { getFriendsPublic, getWorldPublic } from '@/shared/privacy';

interface SettingsProps {
  profile: Profile;
  onSignOut: () => void;
  onProfileUpdated: () => void;
}

export default function Settings({ profile, onSignOut, onProfileUpdated }: SettingsProps) {
  const [worldPublic, setWorldPublic] = useState(getWorldPublic(profile));
  const [friendsPublic, setFriendsPublic] = useState(getFriendsPublic(profile));
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordMessageKind, setPasswordMessageKind] = useState<'success' | 'error'>('error');

  useEffect(() => {
    setWorldPublic(getWorldPublic(profile));
    setFriendsPublic(getFriendsPublic(profile));
    setDisplayName(profile.display_name);
  }, [profile]);

  function toPasswordErrorMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) {
      const message = String((err as { message?: unknown }).message ?? '').trim();
      if (message) return message;
    }
    return 'Failed to update password';
  }

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    const { error } = await supabase
      .from('profiles')
      .update({
        is_public: worldPublic,
        world_public: worldPublic,
        friends_public: friendsPublic,
        display_name: displayName,
      })
      .eq('id', profile.id);

    if (error) {
      setMessage('Failed to save');
    } else {
      setMessage('Saved!');
      onProfileUpdated();
    }
    setSaving(false);
    setTimeout(() => setMessage(''), 2000);
  };

  const hasChanges = (
    worldPublic !== getWorldPublic(profile)
    || friendsPublic !== getFriendsPublic(profile)
    || displayName !== profile.display_name
  );

  const handlePasswordUpdate = async () => {
    setPasswordMessage('');

    if (!newPassword || !confirmNewPassword) {
      setPasswordMessageKind('error');
      setPasswordMessage('Enter and confirm your new password.');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordMessageKind('error');
      setPasswordMessage('New passwords do not match.');
      return;
    }

    const validation = validateStrongPassword(newPassword);
    if (!validation.valid) {
      setPasswordMessageKind('error');
      setPasswordMessage(validation.message);
      return;
    }

    setUpdatingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        setPasswordMessageKind('error');
        setPasswordMessage(toPasswordErrorMessage(error));
        return;
      }

      setPasswordMessageKind('success');
      setPasswordMessage('Password updated.');
      setNewPassword('');
      setConfirmNewPassword('');
      setShowPassword(false);
    } catch (err) {
      setPasswordMessageKind('error');
      setPasswordMessage(toPasswordErrorMessage(err));
    } finally {
      setUpdatingPassword(false);
      setTimeout(() => setPasswordMessage(''), 2500);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-sm font-mono font-bold text-doom-muted uppercase tracking-wider">
        Settings
      </h2>

      {/* Display Name */}
      <div>
        <label className="text-doom-muted text-xs font-mono block mb-1">
          Display Name
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full bg-doom-surface border border-doom-border rounded-lg px-3 py-2
                     text-white text-sm focus:outline-none focus:border-neon-green/50 transition-colors"
        />
      </div>

      {/* Username (read-only) */}
      <div>
        <label className="text-doom-muted text-xs font-mono block mb-1">
          Username
        </label>
        <div className="bg-doom-surface border border-doom-border rounded-lg px-3 py-2 text-doom-muted text-sm">
          @{profile.username}
        </div>
      </div>

      {/* Privacy controls */}
      <div className="card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">World Visibility</p>
            <p className="text-doom-muted text-xs mt-0.5">
              {worldPublic
                ? 'Visible to everyone (profile + world leaderboard)'
                : 'Hidden from world; choose friend visibility below'}
            </p>
          </div>
          <button
            onClick={() => setWorldPublic((prev) => !prev)}
            className={`w-12 h-6 rounded-full transition-all duration-200 relative
              ${worldPublic ? 'bg-neon-green/30' : 'bg-doom-border'}`}
          >
            <div
              className={`w-5 h-5 rounded-full absolute top-0.5 transition-all duration-200
                ${
                  worldPublic
                    ? 'left-6 bg-neon-green shadow-neon-green'
                    : 'left-0.5 bg-doom-muted'
                }`}
            />
          </button>
        </div>

        {!worldPublic && (
          <div className="mt-3 pt-3 border-t border-doom-border">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Friends Visibility</p>
                <p className="text-doom-muted text-xs mt-0.5">
                  {friendsPublic
                    ? 'Friends can view your profile + friends leaderboard'
                    : 'No one can view your profile details'}
                </p>
              </div>
              <button
                onClick={() => setFriendsPublic((prev) => !prev)}
                className={`w-12 h-6 rounded-full transition-all duration-200 relative
                  ${friendsPublic ? 'bg-neon-green/30' : 'bg-doom-border'}`}
              >
                <div
                  className={`w-5 h-5 rounded-full absolute top-0.5 transition-all duration-200
                    ${
                      friendsPublic
                        ? 'left-6 bg-neon-green shadow-neon-green'
                        : 'left-0.5 bg-doom-muted'
                    }`}
                />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Save button */}
      {hasChanges && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary py-2 text-sm font-bold disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      )}

      {message && (
        <p className={`text-xs text-center ${message === 'Saved!' ? 'text-neon-green' : 'text-neon-pink'}`}>
          {message}
        </p>
      )}

      {/* Password */}
      <div className="card">
        <p className="text-sm font-medium mb-2">Change Password</p>
        <div className="space-y-2">
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              minLength={10}
              className="w-full bg-doom-surface border border-doom-border rounded-lg px-3 py-2 pr-12
                         text-white text-sm focus:outline-none focus:border-neon-green/50 transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-doom-muted hover:text-white text-xs transition-colors"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>

          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            placeholder="Confirm new password"
            minLength={10}
            className="w-full bg-doom-surface border border-doom-border rounded-lg px-3 py-2
                       text-white text-sm focus:outline-none focus:border-neon-green/50 transition-colors"
          />

          <p className="text-[11px] text-doom-muted leading-relaxed">
            {STRONG_PASSWORD_REQUIREMENTS}
          </p>

          <button
            onClick={handlePasswordUpdate}
            disabled={updatingPassword}
            className="w-full px-3 py-2 rounded-lg border border-neon-green/45 text-neon-green
                       hover:bg-neon-green/10 transition-colors text-sm font-semibold disabled:opacity-50"
          >
            {updatingPassword ? 'Updating...' : 'Update Password'}
          </button>

          {passwordMessage && (
            <p className={`text-xs text-center ${passwordMessageKind === 'success' ? 'text-neon-green' : 'text-neon-pink'}`}>
              {passwordMessage}
            </p>
          )}
        </div>
      </div>

      {/* Danger zone */}
      <div className="mt-4 pt-4 border-t border-doom-border">
        <button
          onClick={onSignOut}
          className="btn-danger w-full py-2 text-sm"
        >
          Sign Out
        </button>
      </div>

      {/* Version */}
      <p className="text-doom-muted text-[10px] text-center font-mono">
        DoomScroller v1.0.0
      </p>
    </div>
  );
}
