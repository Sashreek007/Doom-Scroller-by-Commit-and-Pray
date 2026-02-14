import { useState } from 'react';
import { supabase } from '@/shared/supabase';
import type { Profile } from '@/shared/types';

interface SettingsProps {
  profile: Profile;
  onSignOut: () => void;
  onProfileUpdated: () => void;
}

export default function Settings({ profile, onSignOut, onProfileUpdated }: SettingsProps) {
  const [isPublic, setIsPublic] = useState(profile.is_public);
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    const { error } = await supabase
      .from('profiles')
      .update({
        is_public: isPublic,
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

  const hasChanges = isPublic !== profile.is_public || displayName !== profile.display_name;

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

      {/* Privacy toggle */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Public Profile</p>
            <p className="text-doom-muted text-xs mt-0.5">
              {isPublic
                ? 'Anyone can see your profile and stats'
                : 'Only friends can see your profile'}
            </p>
          </div>
          <button
            onClick={() => setIsPublic(!isPublic)}
            className={`w-12 h-6 rounded-full transition-all duration-200 relative
              ${isPublic ? 'bg-neon-green/30' : 'bg-doom-border'}`}
          >
            <div
              className={`w-5 h-5 rounded-full absolute top-0.5 transition-all duration-200
                ${
                  isPublic
                    ? 'left-6 bg-neon-green shadow-neon-green'
                    : 'left-0.5 bg-doom-muted'
                }`}
            />
          </button>
        </div>
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
