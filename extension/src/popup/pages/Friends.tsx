import { useState } from 'react';
import { useFriends } from '../hooks/useFriends';
import type { Profile } from '@/shared/types';

interface FriendsProps {
  userId: string;
  onViewProfile: (userId: string) => void;
}

export default function Friends({ userId, onViewProfile }: FriendsProps) {
  const {
    friends,
    pendingReceived,
    loading,
    sendRequest,
    acceptRequest,
    rejectRequest,
    searchUsers,
  } = useFriends(userId);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async () => {
    if (searchQuery.length < 2) return;
    setSearching(true);
    setError('');
    try {
      const results = await searchUsers(searchQuery);
      setSearchResults(results);
    } catch {
      setError('Search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleSendRequest = async (targetId: string) => {
    setError('');
    try {
      await sendRequest(targetId);
      // Remove from search results
      setSearchResults((prev) => prev.filter((p) => p.id !== targetId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send request';
      if (msg.includes('duplicate') || msg.includes('unique')) {
        setError('Already sent a request to this user');
      } else {
        setError(msg);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-doom-muted font-mono text-sm animate-pulse">Loading friends...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search */}
      <div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search by username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1 bg-doom-surface border border-doom-border rounded-lg px-3 py-2
                       text-white placeholder-doom-muted text-sm
                       focus:outline-none focus:border-neon-green/50 transition-colors"
          />
          <button
            onClick={handleSearch}
            disabled={searching || searchQuery.length < 2}
            className="btn-primary text-xs px-3 disabled:opacity-50"
          >
            {searching ? '...' : '🔍'}
          </button>
        </div>
        {error && <p className="text-neon-pink text-xs mt-1">{error}</p>}
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div>
          <p className="text-doom-muted text-xs font-mono uppercase tracking-wider mb-2">
            Results
          </p>
          <div className="space-y-2">
            {searchResults.map((user) => {
              const alreadyFriend = friends.some((f) => f.profile.id === user.id);
              return (
                <div key={user.id} className="card flex items-center justify-between">
                  <button
                    onClick={() => onViewProfile(user.id)}
                    className="flex items-center gap-2 hover:text-neon-cyan transition-colors"
                  >
                    <span className="text-lg">💀</span>
                    <div className="text-left">
                      <p className="text-sm font-medium">{user.display_name}</p>
                      <p className="text-doom-muted text-xs font-mono">@{user.username}</p>
                    </div>
                  </button>
                  {alreadyFriend ? (
                    <span className="text-neon-green text-xs">✓ Friends</span>
                  ) : (
                    <button
                      onClick={() => handleSendRequest(user.id)}
                      className="btn-primary text-xs px-2 py-1"
                    >
                      Add
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending requests received */}
      {pendingReceived.length > 0 && (
        <div>
          <p className="text-doom-muted text-xs font-mono uppercase tracking-wider mb-2">
            Friend Requests ({pendingReceived.length})
          </p>
          <div className="space-y-2">
            {pendingReceived.map(({ friendship, profile }) => (
              <div key={friendship.id} className="card flex items-center justify-between">
                <button
                  onClick={() => onViewProfile(profile.id)}
                  className="flex items-center gap-2 hover:text-neon-cyan transition-colors"
                >
                  <span className="text-lg">💀</span>
                  <div className="text-left">
                    <p className="text-sm font-medium">{profile.display_name}</p>
                    <p className="text-doom-muted text-xs font-mono">@{profile.username}</p>
                  </div>
                </button>
                <div className="flex gap-1">
                  <button
                    onClick={() => acceptRequest(friendship.id)}
                    className="btn-primary text-xs px-2 py-1"
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => rejectRequest(friendship.id)}
                    className="btn-danger text-xs px-2 py-1"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Friend list */}
      <div>
        <p className="text-doom-muted text-xs font-mono uppercase tracking-wider mb-2">
          Friends ({friends.length})
        </p>
        {friends.length > 0 ? (
          <div className="space-y-2">
            {friends.map(({ profile }) => (
              <button
                key={profile.id}
                onClick={() => onViewProfile(profile.id)}
                className="card flex items-center gap-3 w-full text-left hover:border-neon-green/30 transition-colors"
              >
                <span className="text-lg">💀</span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{profile.display_name}</p>
                  <p className="text-doom-muted text-xs font-mono">@{profile.username}</p>
                </div>
                <span className="text-doom-muted text-xs font-mono">
                  {profile.total_meters_scrolled < 1000
                    ? `${Math.round(profile.total_meters_scrolled)}m`
                    : `${(profile.total_meters_scrolled / 1000).toFixed(1)}km`}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="card text-center py-4">
            <p className="text-doom-muted text-xs">
              No friends yet. Search for someone above.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
