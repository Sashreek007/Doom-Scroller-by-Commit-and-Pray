import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/shared/supabase';
import UserAvatar from '../components/UserAvatar';

type RoomPhase = 'lobby' | 'game_select';
type GameTypeKey = 'scroll_sprint' | 'target_chase' | 'app_lockdown';

interface BattleProps {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  availableCoins: number;
}

interface BattlePlayer {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  joinedAt: number;
}

interface BattleRoomState {
  hostId: string;
  phase: RoomPhase;
  betCoins: number;
  timerSeconds: number;
  selectedGameType: GameTypeKey | null;
  updatedAt: number;
}

interface BattleGameOption {
  id: GameTypeKey;
  title: string;
  subtitle: string;
  details: string;
}

const ROOM_KEY_LENGTH = 6;
const MAX_PLAYERS = 4;
const DEFAULT_TIMER_SECONDS = 120;
const TIMER_OPTIONS_SECONDS = [60, 120, 180, 300];
const JOIN_KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const GAME_OPTIONS: BattleGameOption[] = [
  {
    id: 'scroll_sprint',
    title: 'Scroll Sprint',
    subtitle: 'Pure speed',
    details: 'Highest distance in the round wins.',
  },
  {
    id: 'target_chase',
    title: 'Target Chase',
    subtitle: 'Precision mode',
    details: 'Closest to the target distance wins.',
  },
  {
    id: 'app_lockdown',
    title: 'App Lockdown',
    subtitle: 'Single-app challenge',
    details: 'Only one selected app counts.',
  },
];

function normalizeRoomKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_KEY_LENGTH);
}

function generateRoomKey(): string {
  let key = '';
  for (let i = 0; i < ROOM_KEY_LENGTH; i += 1) {
    key += JOIN_KEY_CHARS[Math.floor(Math.random() * JOIN_KEY_CHARS.length)];
  }
  return key;
}

function toSafeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function parseRoomState(payload: unknown): BattleRoomState | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  const hostId = typeof data.hostId === 'string' ? data.hostId : null;
  const phase = data.phase === 'lobby' || data.phase === 'game_select' ? data.phase : null;
  const selectedGameType = data.selectedGameType;
  const normalizedSelectedGame: GameTypeKey | null = selectedGameType === 'scroll_sprint'
    || selectedGameType === 'target_chase'
    || selectedGameType === 'app_lockdown'
    ? selectedGameType
    : null;

  if (!hostId || !phase) return null;

  return {
    hostId,
    phase,
    betCoins: Math.max(0, Math.floor(toSafeNumber(data.betCoins, 0))),
    timerSeconds: Math.max(30, Math.floor(toSafeNumber(data.timerSeconds, DEFAULT_TIMER_SECONDS))),
    selectedGameType: normalizedSelectedGame,
    updatedAt: Math.max(0, toSafeNumber(data.updatedAt, Date.now())),
  };
}

function mapPresenceToPlayers(state: unknown): BattlePlayer[] {
  if (!state || typeof state !== 'object') return [];

  const presenceState = state as Record<string, unknown>;
  const seen = new Map<string, BattlePlayer>();

  for (const metas of Object.values(presenceState)) {
    if (!Array.isArray(metas)) continue;

    for (const meta of metas) {
      if (!meta || typeof meta !== 'object') continue;
      const entry = meta as Record<string, unknown>;
      const userId = typeof entry.userId === 'string' ? entry.userId : null;
      if (!userId) continue;

      const player: BattlePlayer = {
        userId,
        username: typeof entry.username === 'string' ? entry.username : 'user',
        displayName: typeof entry.displayName === 'string' ? entry.displayName : 'User',
        avatarUrl: typeof entry.avatarUrl === 'string' ? entry.avatarUrl : null,
        joinedAt: toSafeNumber(entry.joinedAt, Date.now()),
      };

      const existing = seen.get(userId);
      if (!existing || player.joinedAt < existing.joinedAt) {
        seen.set(userId, player);
      }
    }
  }

  return [...seen.values()]
    .sort((a, b) => a.joinedAt - b.joinedAt);
}

function formatTimer(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function getGameLabel(gameType: GameTypeKey | null): string {
  if (!gameType) return 'Not selected';
  const option = GAME_OPTIONS.find((item) => item.id === gameType);
  return option?.title ?? gameType;
}

function clampBet(rawValue: number, availableCoins: number): number {
  const max = Math.max(0, Math.floor(availableCoins));
  const safeValue = Number.isFinite(rawValue) ? Math.floor(rawValue) : 0;
  return Math.min(max, Math.max(0, safeValue));
}

export default function Battle({
  userId,
  username,
  displayName,
  avatarUrl,
  availableCoins,
}: BattleProps) {
  const [joinKeyInput, setJoinKeyInput] = useState('');
  const [roomKey, setRoomKey] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [players, setPlayers] = useState<BattlePlayer[]>([]);
  const [roomState, setRoomState] = useState<BattleRoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [statusText, setStatusText] = useState('Disconnected');
  const [joining, setJoining] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const isHostRef = useRef(false);
  const roomStateRef = useRef<BattleRoomState | null>(null);

  const myPlayer = useMemo<BattlePlayer>(() => ({
    userId,
    username,
    displayName,
    avatarUrl,
    joinedAt: Date.now(),
  }), [avatarUrl, displayName, userId, username]);

  const hostStillPresent = useMemo(() => {
    if (!roomState?.hostId) return true;
    return players.some((player) => player.userId === roomState.hostId);
  }, [players, roomState?.hostId]);
  const canStart = isHost
    && roomState?.phase === 'lobby'
    && players.length >= 2
    && players.length <= MAX_PLAYERS
    && hostStillPresent;
  const roomIsFull = players.length >= MAX_PLAYERS;

  const updatePlayersFromPresence = useCallback((channel: RealtimeChannel) => {
    const nextPlayers = mapPresenceToPlayers(channel.presenceState());
    setPlayers(nextPlayers);
  }, []);

  const broadcastRoomState = useCallback(async (nextState: BattleRoomState) => {
    const channel = channelRef.current;
    if (!channel) return;
    await channel.send({
      type: 'broadcast',
      event: 'room_state',
      payload: nextState,
    });
  }, []);

  const setHostRoomState = useCallback((patch: Partial<BattleRoomState>) => {
    if (!isHostRef.current) return;

    setRoomState((prev) => {
      if (!prev) return prev;
      const nextState: BattleRoomState = {
        ...prev,
        ...patch,
        updatedAt: Date.now(),
      };
      roomStateRef.current = nextState;
      void broadcastRoomState(nextState);
      return nextState;
    });
  }, [broadcastRoomState]);

  const leaveRoom = useCallback(async () => {
    setJoining(false);
    setStatusText('Disconnected');
    setCopied(false);
    setInfo(null);
    setError(null);
    setPlayers([]);
    setRoomState(null);
    roomStateRef.current = null;
    isHostRef.current = false;
    setIsHost(false);
    setRoomKey(null);

    const channel = channelRef.current;
    channelRef.current = null;
    if (channel) {
      try {
        await supabase.removeChannel(channel);
      } catch {
        // Ignore channel cleanup errors.
      }
    }
  }, []);

  const connectToRoom = useCallback(async (
    key: string,
    asHost: boolean,
    initialState: BattleRoomState | null,
  ) => {
    await leaveRoom();

    setJoining(true);
    setStatusText('Connecting...');
    setError(null);
    setInfo(null);
    setRoomKey(key);
    setIsHost(asHost);
    isHostRef.current = asHost;
    setRoomState(initialState);
    roomStateRef.current = initialState;

    const channel = supabase.channel(`battle-room:${key.toLowerCase()}`, {
      config: {
        broadcast: { self: true },
        presence: { key: userId },
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        updatePlayersFromPresence(channel);
      })
      .on('broadcast', { event: 'room_state' }, ({ payload }) => {
        const incoming = parseRoomState(payload);
        if (!incoming) return;

        const current = roomStateRef.current;
        if (!current || incoming.updatedAt >= current.updatedAt) {
          roomStateRef.current = incoming;
          setRoomState(incoming);
        }
      })
      .on('broadcast', { event: 'state_request' }, () => {
        if (!isHostRef.current || !roomStateRef.current) return;
        void broadcastRoomState(roomStateRef.current);
      });

    channel.subscribe(async (status) => {
      setStatusText(status.replace('_', ' '));

      if (status === 'SUBSCRIBED') {
        const trackResponse = await channel.track({
          userId: myPlayer.userId,
          username: myPlayer.username,
          displayName: myPlayer.displayName,
          avatarUrl: myPlayer.avatarUrl,
          joinedAt: Date.now(),
        });

        setJoining(false);

        if (trackResponse !== 'ok') {
          setError('Could not join room presence. Try again.');
          return;
        }

        if (asHost && roomStateRef.current) {
          void broadcastRoomState(roomStateRef.current);
        } else {
          await channel.send({
            type: 'broadcast',
            event: 'state_request',
            payload: { requestedAt: Date.now(), requesterId: userId },
          });
          setInfo('Joined room. Waiting for host to start.');
        }
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setJoining(false);
        setError('Room connection lost. Rejoin the battle room.');
      }
    });

    channelRef.current = channel;
  }, [broadcastRoomState, leaveRoom, myPlayer.avatarUrl, myPlayer.displayName, myPlayer.userId, myPlayer.username, updatePlayersFromPresence, userId]);

  useEffect(() => {
    return () => {
      void leaveRoom();
    };
  }, [leaveRoom]);

  useEffect(() => {
    if (!roomKey) return;
    if (players.length <= MAX_PLAYERS) return;

    if (isHost) {
      setError('Room limit is 4 players. Ask extra players to leave.');
      return;
    }

    const myIndex = players.findIndex((player) => player.userId === userId);
    if (myIndex >= MAX_PLAYERS || myIndex === -1) {
      void leaveRoom().finally(() => {
        setError('Room is full (4 players max).');
      });
    }
  }, [isHost, leaveRoom, players, roomKey, userId]);

  const handleCreateRoom = async () => {
    const key = generateRoomKey();
    const initialState: BattleRoomState = {
      hostId: userId,
      phase: 'lobby',
      betCoins: clampBet(Math.min(10, availableCoins), availableCoins),
      timerSeconds: DEFAULT_TIMER_SECONDS,
      selectedGameType: null,
      updatedAt: Date.now(),
    };
    await connectToRoom(key, true, initialState);
  };

  const handleJoinRoom = async () => {
    const normalized = normalizeRoomKey(joinKeyInput);
    if (normalized.length !== ROOM_KEY_LENGTH) {
      setError(`Enter a ${ROOM_KEY_LENGTH}-character room key.`);
      return;
    }
    await connectToRoom(normalized, false, null);
  };

  const handleCopyRoomKey = async () => {
    if (!roomKey) return;
    try {
      await navigator.clipboard.writeText(roomKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setError('Could not copy key. Copy manually.');
    }
  };

  const handleStart = () => {
    if (!canStart) return;
    setHostRoomState({
      phase: 'game_select',
      selectedGameType: null,
    });
    setInfo('Pick a game mode. Gameplay logic comes next.');
  };

  const handleBetChange = (value: number) => {
    setHostRoomState({ betCoins: clampBet(value, availableCoins) });
  };

  const handleTimerChange = (value: number) => {
    setHostRoomState({ timerSeconds: value });
  };

  const handleGameSelect = (gameType: GameTypeKey) => {
    setHostRoomState({ selectedGameType: gameType });
  };

  const showSetup = !roomKey;

  return (
    <div className="flex flex-col gap-4">
      {showSetup ? (
        <>
          <div className="card">
            <p className="text-neon-green text-xs font-mono uppercase tracking-wider mb-2">Create battle room</p>
            <p className="text-doom-muted text-xs mb-3">
              Host creates a room key, friends join, then host starts and picks the game type.
            </p>
            <button
              onClick={() => {
                void handleCreateRoom();
              }}
              className="btn-primary w-full text-sm"
              disabled={joining}
            >
              {joining ? 'Creating...' : 'Create Room'}
            </button>
          </div>

          <div className="card">
            <p className="text-doom-muted text-xs font-mono uppercase tracking-wider mb-2">Join with key</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={joinKeyInput}
                onChange={(event) => setJoinKeyInput(normalizeRoomKey(event.target.value))}
                placeholder="Room key"
                maxLength={ROOM_KEY_LENGTH}
                className="flex-1 bg-doom-surface border border-doom-border rounded-md px-3 py-2 text-sm tracking-[0.24em] uppercase focus:outline-none focus:border-neon-green/50"
              />
              <button
                onClick={() => {
                  void handleJoinRoom();
                }}
                className="btn-primary text-xs px-3 disabled:opacity-50"
                disabled={joining}
              >
                Join
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="card">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-neon-green text-xs font-mono uppercase tracking-wider">
                  Room {roomKey}
                </p>
                <p className="text-doom-muted text-xs">
                  {isHost ? 'You are host' : 'You joined as player'} • {players.length}/{MAX_PLAYERS} players • {statusText}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    void handleCopyRoomKey();
                  }}
                  className="px-2 py-1 text-[11px] rounded-md border border-doom-border text-doom-muted hover:text-white hover:border-neon-green/40"
                >
                  {copied ? 'Copied' : 'Copy key'}
                </button>
                <button
                  onClick={() => {
                    void leaveRoom();
                  }}
                  className="btn-danger text-[11px] px-2 py-1"
                >
                  Leave
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <p className="text-doom-muted text-xs font-mono uppercase tracking-wider">
                Lobby players
              </p>
              <p className="text-doom-muted text-[11px]">
                {roomIsFull ? 'Room full' : `${MAX_PLAYERS - players.length} open slot${MAX_PLAYERS - players.length === 1 ? '' : 's'}`}
              </p>
            </div>
            <div className="space-y-2">
              {players.map((player) => {
                const isRoomHost = roomState?.hostId === player.userId;
                const isMe = player.userId === userId;

                return (
                  <div key={player.userId} className="flex items-center justify-between rounded-lg border border-doom-border bg-doom-bg/40 px-2.5 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <UserAvatar
                        avatarUrl={player.avatarUrl}
                        displayName={player.displayName}
                        sizeClass="w-8 h-8"
                        iconClassName="text-base"
                      />
                      <div className="min-w-0">
                        <p className="text-sm truncate">{player.displayName}</p>
                        <p className="text-doom-muted text-xs font-mono truncate">@{player.username}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {isRoomHost && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-neon-green/40 text-neon-green font-mono">
                          HOST
                        </span>
                      )}
                      {isMe && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-doom-border text-doom-muted font-mono">
                          YOU
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {players.length === 0 && (
                <p className="text-doom-muted text-xs">Waiting for players to join...</p>
              )}
            </div>
          </div>

          {!hostStillPresent && (
            <div className="card border-neon-pink/35 bg-neon-pink/10 text-neon-pink text-xs">
              Host left the room. Recreate a room to continue.
            </div>
          )}

          {roomState?.phase === 'lobby' && (
            <div className="card">
              <p className="text-doom-muted text-xs font-mono uppercase tracking-wider mb-2">Round setup</p>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <label className="block">
                  <span className="text-[11px] text-doom-muted">Bet coins</span>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, Math.floor(availableCoins))}
                    value={roomState.betCoins}
                    disabled={!isHost}
                    onChange={(event) => handleBetChange(Number(event.target.value))}
                    className="mt-1 w-full bg-doom-surface border border-doom-border rounded-md px-2 py-1.5 text-sm disabled:opacity-60"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-doom-muted">Round timer</span>
                  <select
                    value={roomState.timerSeconds}
                    disabled={!isHost}
                    onChange={(event) => handleTimerChange(Number(event.target.value))}
                    className="mt-1 w-full bg-doom-surface border border-doom-border rounded-md px-2 py-1.5 text-sm disabled:opacity-60"
                  >
                    {TIMER_OPTIONS_SECONDS.map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {formatTimer(seconds)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {isHost ? (
                <button
                  onClick={handleStart}
                  disabled={!canStart}
                  className="btn-primary w-full text-sm disabled:opacity-50"
                >
                  {canStart ? 'Start Battle' : 'Need at least 2 players'}
                </button>
              ) : (
                <p className="text-doom-muted text-xs">Waiting for host to start the battle.</p>
              )}
            </div>
          )}

          {roomState?.phase === 'game_select' && (
            <div className="card">
              <p className="text-neon-green text-xs font-mono uppercase tracking-wider mb-1">
                Game select
              </p>
              <p className="text-doom-muted text-xs mb-3">
                Pot: <span className="text-white">{roomState.betCoins * players.length} coins</span> • Timer: <span className="text-white">{formatTimer(roomState.timerSeconds)}</span>
              </p>

              {isHost ? (
                <div className="grid grid-cols-1 gap-2">
                  {GAME_OPTIONS.map((option) => {
                    const selected = roomState.selectedGameType === option.id;
                    return (
                      <button
                        key={option.id}
                        onClick={() => handleGameSelect(option.id)}
                        className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                          selected
                            ? 'border-neon-green/60 bg-neon-green/10'
                            : 'border-doom-border bg-doom-surface hover:border-neon-green/30'
                        }`}
                      >
                        <p className="text-sm text-white">{option.title}</p>
                        <p className="text-[11px] text-doom-muted">{option.subtitle} • {option.details}</p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-doom-muted text-xs">
                  Waiting for host to choose the game type...
                </p>
              )}

              {roomState.selectedGameType && (
                <div className="mt-3 rounded-lg border border-neon-green/35 bg-neon-green/10 px-3 py-2">
                  <p className="text-neon-green text-xs font-mono uppercase tracking-wider">
                    Selected: {getGameLabel(roomState.selectedGameType)}
                  </p>
                  <p className="text-[11px] text-doom-muted mt-1">
                    Battle mechanics for this mode will be wired next.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {info && (
        <div className="card border-neon-cyan/35 bg-neon-cyan/10 text-neon-cyan text-xs">
          {info}
        </div>
      )}

      {error && (
        <div className="card border-neon-pink/35 bg-neon-pink/10 text-neon-pink text-xs">
          {error}
        </div>
      )}
    </div>
  );
}
