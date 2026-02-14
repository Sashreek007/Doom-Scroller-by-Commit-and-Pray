import { useEffect, useState } from 'react';
import { useFriends } from '../hooks/useFriends';
import type { Profile } from '@/shared/types';

interface FriendsProps {
  userId: string;
  onViewProfile: (userId: string) => void;
  onPendingRequestsChanged?: (count: number) => void;
}

export default function Friends({ userId, onViewProfile, onPendingRequestsChanged }: FriendsProps) {
  const {
    friends,
    pendingReceived,
    pendingSent,
    acceptanceNotices,
    loading,
    sendRequest,
    acceptRequest,
    rejectRequest,
    removeFriend,
    searchUsers,
    dismissAcceptanceNotice,
  } = useFriends(userId);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'friends' | 'requests'>('friends');
  const [removingFriendshipId, setRemovingFriendshipId] = useState<string | null>(null);

  useEffect(() => {
    onPendingRequestsChanged?.(pendingReceived.length);
  }, [onPendingRequestsChanged, pendingReceived.length]);

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

  const handleAcceptRequest = async (friendshipId: string) => {
    setError('');
    try {
      await acceptRequest(friendshipId);
    } catch {
      setError('Failed to accept request');
    }
  };

  const handleRejectRequest = async (friendshipId: string) => {
    setError('');
    try {
      await rejectRequest(friendshipId);
    } catch {
      setError('Failed to reject request');
    }
  };

  const handleRemoveFriend = async (friendshipId: string) => {
    setError('');
    setRemovingFriendshipId(friendshipId);
    try {
      await removeFriend(friendshipId);
    } catch {
      setError('Failed to remove friend');
    } finally {
      setRemovingFriendshipId(null);
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

      {acceptanceNotices.length > 0 && (
        <div className="space-y-2">
          {acceptanceNotices.map((notice) => (
            <div
              key={notice.userId}
              className="rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 px-3 py-2 flex items-center justify-between gap-2"
            >
              <button
                onClick={() => onViewProfile(notice.userId)}
                className="flex-1 text-left"
              >
                <p className="text-neon-cyan text-[11px] font-mono uppercase tracking-wider">
                  Friend request accepted
                </p>
                <p className="text-white text-xs">
                  {notice.displayName} (@{notice.username}) accepted your request.
                </p>
              </button>
              <button
                onClick={() => dismissAcceptanceNotice(notice.userId)}
                className="text-doom-muted hover:text-white text-xs px-2 py-1 rounded border border-doom-border hover:border-neon-cyan/40 transition-colors"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setActiveTab('friends')}
          className={`rounded-lg border px-3 py-2 text-xs font-mono transition-colors ${
            activeTab === 'friends'
              ? 'border-neon-green/60 bg-neon-green/10 text-neon-green'
              : 'border-doom-border bg-doom-surface text-doom-muted hover:text-white'
          }`}
        >
          Friends ({friends.length})
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={`rounded-lg border px-3 py-2 text-xs font-mono transition-colors ${
            activeTab === 'requests'
              ? 'border-red-400/60 bg-red-500/10 text-red-300'
              : 'border-doom-border bg-doom-surface text-doom-muted hover:text-white'
          }`}
        >
          Requests ({pendingReceived.length})
        </button>
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
              const alreadyRequested = pendingSent.some((f) => f.profile.id === user.id);
              const requestedYou = pendingReceived.some((f) => f.profile.id === user.id);
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
                  ) : requestedYou ? (
                    <button
                      onClick={() => setActiveTab('requests')}
                      className="text-red-300 text-xs border border-red-400/40 rounded px-2 py-1 hover:bg-red-500/10 transition-colors"
                    >
                      Respond
                    </button>
                  ) : alreadyRequested ? (
                    <span className="text-doom-muted text-xs">Requested</span>
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

      {activeTab === 'friends' ? (
        <div>
          <p className="text-doom-muted text-xs font-mono uppercase tracking-wider mb-2">
            Friends ({friends.length})
          </p>
          {friends.length > 0 ? (
            <div className="space-y-2">
              {friends.map(({ friendship, profile }) => (
                <div
                  key={friendship.id}
                  className="card flex items-center justify-between gap-2 w-full hover:border-neon-green/30 transition-colors"
                >
                  <button
                    onClick={() => onViewProfile(profile.id)}
                    className="flex items-center gap-3 flex-1 text-left min-w-0"
                  >
                    <span className="text-lg">💀</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{profile.display_name}</p>
                      <p className="text-doom-muted text-xs font-mono truncate">@{profile.username}</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-doom-muted text-xs font-mono whitespace-nowrap">
                      {profile.total_meters_scrolled < 1000
                        ? `${Math.round(profile.total_meters_scrolled)}m`
                        : `${(profile.total_meters_scrolled / 1000).toFixed(1)}km`}
                    </span>
                    <button
                      onClick={() => handleRemoveFriend(friendship.id)}
                      disabled={removingFriendshipId === friendship.id}
                      className="btn-danger text-[11px] px-2 py-1 disabled:opacity-60"
                    >
                      {removingFriendshipId === friendship.id ? '...' : 'Remove'}
                    </button>
                  </div>
                </div>
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
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-doom-muted text-xs font-mono uppercase tracking-wider mb-2">
              Incoming ({pendingReceived.length})
            </p>
            {pendingReceived.length > 0 ? (
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
                        onClick={() => handleAcceptRequest(friendship.id)}
                        className="btn-primary text-xs px-2 py-1"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleRejectRequest(friendship.id)}
                        className="btn-danger text-xs px-2 py-1"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="card text-center py-4">
                <p className="text-doom-muted text-xs">No incoming requests.</p>
              </div>
            )}
          </div>

          <div>
            <p className="text-doom-muted text-xs font-mono uppercase tracking-wider mb-2">
              Sent ({pendingSent.length})
            </p>
            {pendingSent.length > 0 ? (
              <div className="space-y-2">
                {pendingSent.map(({ friendship, profile }) => (
                  <button
                    key={friendship.id}
                    onClick={() => onViewProfile(profile.id)}
                    className="card flex items-center justify-between w-full text-left hover:border-neon-cyan/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">💀</span>
                      <div className="text-left">
                        <p className="text-sm font-medium">{profile.display_name}</p>
                        <p className="text-doom-muted text-xs font-mono">@{profile.username}</p>
                      </div>
                    </div>
                    <span className="text-doom-muted text-xs font-mono">Pending</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="card text-center py-4">
                <p className="text-doom-muted text-xs">No pending sent requests.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
