import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PostgrestError, RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/shared/supabase';
import UserAvatar from '../components/UserAvatar';

type BattleRoomStatus = 'lobby' | 'game_select' | 'active' | 'closed';
type BattleMemberStatus = 'joined' | 'left' | 'kicked';
type BattleMemberRole = 'host' | 'player';
type GameTypeKey = 'scroll_sprint' | 'target_chase' | 'app_lockdown';

interface BattleProps {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  availableCoins: number;
}

interface BattleRoomRow {
  id: string;
  room_key: string;
  host_id: string;
  status: BattleRoomStatus;
  bet_coins: number;
  timer_seconds: number;
  selected_game_type: GameTypeKey | null;
  max_players: number;
  created_at: string;
  updated_at: string;
}

interface BattleRoomMemberRow {
  id: string;
  room_id: string;
  user_id: string;
  role: BattleMemberRole;
  status: BattleMemberStatus;
  joined_at: string;
  left_at: string | null;
}

interface BattlePlayer {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  joinedAt: string;
  role: BattleMemberRole;
}

interface BattleGameOption {
  id: GameTypeKey;
  title: string;
  subtitle: string;
  details: string;
}

const DEFAULT_MAX_PLAYERS = 4;
const DEFAULT_TIMER_SECONDS = 120;
const TIMER_OPTIONS_SECONDS = [60, 120, 180, 300];
const ROOM_KEY_LENGTH = 6;
const JOIN_KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DB_REFRESH_DEBOUNCE_MS = 120;
const ROOM_POLL_INTERVAL_MS = 1200;

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

function formatTimer(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function clampBet(rawValue: number, availableCoins: number): number {
  const max = Math.max(0, Math.floor(availableCoins));
  const safeValue = Number.isFinite(rawValue) ? Math.floor(rawValue) : 0;
  return Math.min(max, Math.max(0, safeValue));
}

function getGameLabel(gameType: GameTypeKey | null): string {
  if (!gameType) return 'Not selected';
  const option = GAME_OPTIONS.find((item) => item.id === gameType);
  return option?.title ?? gameType;
}

function parseDbError(error: PostgrestError | null): string {
  if (!error) return 'Unexpected database error';
  if (error.code === '42P01') return 'Battle tables are not deployed yet. Run latest migration.';
  if (error.code === '23505') return 'Duplicate value conflict. Try again.';
  return error.message || 'Unexpected database error';
}

function rankPlayersByJoinTime(players: BattlePlayer[]): BattlePlayer[] {
  return [...players].sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());
}

export default function Battle({
  userId,
  username,
  displayName,
  avatarUrl,
  availableCoins,
}: BattleProps) {
  const [roomKeyInput, setRoomKeyInput] = useState('');
  const [room, setRoom] = useState<BattleRoomRow | null>(null);
  const [players, setPlayers] = useState<BattlePlayer[]>([]);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [joining, setJoining] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshTimeoutRef = useRef<number | null>(null);
  const roomSubRef = useRef<RealtimeChannel | null>(null);
  const refreshInFlightRef = useRef(false);
  const queuedRefreshRef = useRef(false);

  const isHost = Boolean(room && room.host_id === userId);
  const maxPlayers = room?.max_players ?? DEFAULT_MAX_PLAYERS;
  const rankedPlayers = useMemo(() => rankPlayersByJoinTime(players), [players]);
  const roomIsFull = rankedPlayers.length >= maxPlayers;
  const canStart = isHost && room?.status === 'lobby' && rankedPlayers.length >= 2;

  const clearRoomState = useCallback(() => {
    setRoom(null);
    setPlayers([]);
  }, []);

  const loadRoomSnapshot = useCallback(async (roomId: string): Promise<void> => {
    const { data: roomRow, error: roomError } = await supabase
      .from('battle_rooms')
      .select('*')
      .eq('id', roomId)
      .maybeSingle();

    if (roomError) throw new Error(parseDbError(roomError));
    if (!roomRow) {
      clearRoomState();
      return;
    }

    const typedRoom = roomRow as BattleRoomRow;
    if (typedRoom.status === 'closed') {
      clearRoomState();
      setInfo('Battle room is closed.');
      return;
    }

    const { data: myMembership, error: myMembershipError } = await supabase
      .from('battle_room_members')
      .select('status')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .maybeSingle();

    if (myMembershipError) throw new Error(parseDbError(myMembershipError));
    const myStatus = (myMembership?.status as BattleMemberStatus | undefined) ?? null;

    if (myStatus === 'kicked') {
      clearRoomState();
      setError('You were kicked from this room by the host.');
      return;
    }

    if (myStatus !== 'joined') {
      clearRoomState();
      return;
    }

    const { data: memberRows, error: memberError } = await supabase
      .from('battle_room_members')
      .select('*')
      .eq('room_id', roomId)
      .eq('status', 'joined')
      .order('joined_at', { ascending: true });

    if (memberError) throw new Error(parseDbError(memberError));
    const typedMembers = (memberRows as BattleRoomMemberRow[] | null) ?? [];

    const profileIds = typedMembers.map((member) => member.user_id);
    let profileMap = new Map<string, { username: string; display_name: string; avatar_url: string | null }>();

    if (profileIds.length > 0) {
      const { data: profileRows, error: profileError } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .in('id', profileIds);

      if (profileError) throw new Error(parseDbError(profileError));

      for (const row of profileRows ?? []) {
        profileMap.set(row.id as string, {
          username: (row.username as string) ?? 'user',
          display_name: (row.display_name as string) ?? 'User',
          avatar_url: (row.avatar_url as string | null) ?? null,
        });
      }
    }

    const nextPlayers = typedMembers.map((member) => {
      const profile = profileMap.get(member.user_id);
      const isSelf = member.user_id === userId;
      return {
        userId: member.user_id,
        username: profile?.username ?? (isSelf ? username : 'user'),
        displayName: profile?.display_name ?? (isSelf ? displayName : 'User'),
        avatarUrl: profile?.avatar_url ?? (isSelf ? avatarUrl : null),
        joinedAt: member.joined_at,
        role: member.role,
      } satisfies BattlePlayer;
    });

    setRoom(typedRoom);
    setPlayers(nextPlayers);
  }, [avatarUrl, clearRoomState, displayName, userId, username]);

  const refreshRoom = useCallback(async (roomId: string) => {
    if (refreshInFlightRef.current) {
      queuedRefreshRef.current = true;
      return;
    }

    refreshInFlightRef.current = true;
    try {
      do {
        queuedRefreshRef.current = false;
        await loadRoomSnapshot(roomId);
      } while (queuedRefreshRef.current);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [loadRoomSnapshot]);

  const scheduleRefresh = useCallback((roomId: string) => {
    if (refreshTimeoutRef.current != null) {
      window.clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshTimeoutRef.current = null;
      void refreshRoom(roomId);
    }, DB_REFRESH_DEBOUNCE_MS);
  }, [refreshRoom]);

  const subscribeToRoom = useCallback((roomId: string) => {
    if (roomSubRef.current) {
      void supabase.removeChannel(roomSubRef.current);
      roomSubRef.current = null;
    }

    const channel = supabase
      .channel(`battle-room-db:${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'battle_rooms', filter: `id=eq.${roomId}` },
        () => {
          scheduleRefresh(roomId);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'battle_room_members', filter: `room_id=eq.${roomId}` },
        () => {
          scheduleRefresh(roomId);
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          scheduleRefresh(roomId);
        }
      });

    roomSubRef.current = channel;
  }, [scheduleRefresh]);

  const bootstrapRoom = useCallback(async () => {
    setLoadingRoom(true);
    setError(null);
    setInfo(null);

    try {
      const { data: joinedMembership, error: membershipError } = await supabase
        .from('battle_room_members')
        .select('room_id, joined_at')
        .eq('user_id', userId)
        .eq('status', 'joined')
        .order('joined_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (membershipError) throw new Error(parseDbError(membershipError));

      if (!joinedMembership?.room_id) {
        clearRoomState();
        return;
      }

      const roomId = joinedMembership.room_id as string;
      await loadRoomSnapshot(roomId);
      subscribeToRoom(roomId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load battle room';
      setError(message);
      clearRoomState();
    } finally {
      setLoadingRoom(false);
    }
  }, [clearRoomState, loadRoomSnapshot, subscribeToRoom, userId]);

  useEffect(() => {
    void bootstrapRoom();

    return () => {
      if (refreshTimeoutRef.current != null) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      if (roomSubRef.current) {
        void supabase.removeChannel(roomSubRef.current);
        roomSubRef.current = null;
      }
    };
  }, [bootstrapRoom]);

  useEffect(() => {
    if (!room?.id) return;
    subscribeToRoom(room.id);
  }, [room?.id, subscribeToRoom]);

  useEffect(() => {
    if (!room?.id) return;
    const roomId = room.id;
    const interval = window.setInterval(() => {
      void refreshRoom(roomId);
    }, ROOM_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [refreshRoom, room?.id]);

  const createRoom = useCallback(async () => {
    setJoining(true);
    setError(null);
    setInfo(null);

    try {
      let createdRoom: BattleRoomRow | null = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const generatedKey = generateRoomKey();
        const { data, error: createError } = await supabase
          .from('battle_rooms')
          .insert({
            room_key: generatedKey,
            host_id: userId,
            created_by: userId,
            status: 'lobby',
            bet_coins: clampBet(Math.min(10, availableCoins), availableCoins),
            timer_seconds: DEFAULT_TIMER_SECONDS,
            selected_game_type: null,
            max_players: DEFAULT_MAX_PLAYERS,
          })
          .select('*')
          .single();

        if (!createError) {
          createdRoom = data as BattleRoomRow;
          break;
        }

        if (createError.code !== '23505') {
          throw new Error(parseDbError(createError));
        }
      }

      if (!createdRoom) {
        throw new Error('Could not generate a unique room key.');
      }

      const { error: joinError } = await supabase
        .from('battle_room_members')
        .upsert({
          room_id: createdRoom.id,
          user_id: userId,
          role: 'host',
          status: 'joined',
          left_at: null,
        }, { onConflict: 'room_id,user_id' });

      if (joinError) throw new Error(parseDbError(joinError));

      setRoomKeyInput(createdRoom.room_key);
      setRoom(createdRoom);
      await loadRoomSnapshot(createdRoom.id);
      subscribeToRoom(createdRoom.id);
      setInfo('Room created. Share key with friends.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create room';
      setError(message);
    } finally {
      setJoining(false);
    }
  }, [availableCoins, loadRoomSnapshot, subscribeToRoom, userId]);

  const joinRoom = useCallback(async () => {
    const key = normalizeRoomKey(roomKeyInput);
    if (key.length !== ROOM_KEY_LENGTH) {
      setError(`Enter a ${ROOM_KEY_LENGTH}-character room key.`);
      return;
    }

    setJoining(true);
    setError(null);
    setInfo(null);

    try {
      const { data: roomRow, error: roomError } = await supabase
        .from('battle_rooms')
        .select('*')
        .eq('room_key', key)
        .maybeSingle();

      if (roomError) throw new Error(parseDbError(roomError));
      if (!roomRow) throw new Error('Room not found.');

      const typedRoom = roomRow as BattleRoomRow;
      if (typedRoom.status === 'closed') throw new Error('Room is closed.');

      const { data: myMembership, error: membershipError } = await supabase
        .from('battle_room_members')
        .select('*')
        .eq('room_id', typedRoom.id)
        .eq('user_id', userId)
        .maybeSingle();

      if (membershipError) throw new Error(parseDbError(membershipError));

      if ((myMembership?.status as BattleMemberStatus | undefined) === 'kicked') {
        throw new Error('You were kicked from this room and cannot rejoin.');
      }

      const { data: joinedRows, error: joinedError } = await supabase
        .from('battle_room_members')
        .select('user_id')
        .eq('room_id', typedRoom.id)
        .eq('status', 'joined');

      if (joinedError) throw new Error(parseDbError(joinedError));

      const joinedCount = joinedRows?.length ?? 0;
      const alreadyJoined = (myMembership?.status as BattleMemberStatus | undefined) === 'joined';

      if (!alreadyJoined && joinedCount >= typedRoom.max_players) {
        throw new Error(`Room is full (${typedRoom.max_players} players max).`);
      }

      const role: BattleMemberRole = typedRoom.host_id === userId ? 'host' : 'player';
      const { error: upsertError } = await supabase
        .from('battle_room_members')
        .upsert({
          room_id: typedRoom.id,
          user_id: userId,
          role,
          status: 'joined',
          left_at: null,
        }, { onConflict: 'room_id,user_id' });

      if (upsertError) throw new Error(parseDbError(upsertError));

      await loadRoomSnapshot(typedRoom.id);
      subscribeToRoom(typedRoom.id);
      setInfo('Joined room. Waiting for host.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to join room';
      setError(message);
    } finally {
      setJoining(false);
    }
  }, [loadRoomSnapshot, roomKeyInput, subscribeToRoom, userId]);

  const leaveRoom = useCallback(async () => {
    if (!room) return;
    setWorking(true);
    setError(null);

    try {
      const leavingHost = room.host_id === userId;

      if (leavingHost) {
        const { data: nextHostRows, error: nextHostError } = await supabase
          .from('battle_room_members')
          .select('user_id')
          .eq('room_id', room.id)
          .eq('status', 'joined')
          .neq('user_id', userId)
          .order('joined_at', { ascending: true })
          .limit(1);

        if (nextHostError) throw new Error(parseDbError(nextHostError));

        const nextHost = nextHostRows?.[0]?.user_id as string | undefined;
        if (nextHost) {
          const { error: resetRolesError } = await supabase
            .from('battle_room_members')
            .update({ role: 'player' })
            .eq('room_id', room.id);
          if (resetRolesError) throw new Error(parseDbError(resetRolesError));

          const { error: assignHostRoleError } = await supabase
            .from('battle_room_members')
            .update({ role: 'host' })
            .eq('room_id', room.id)
            .eq('user_id', nextHost);
          if (assignHostRoleError) throw new Error(parseDbError(assignHostRoleError));

          const { error: hostUpdateError } = await supabase
            .from('battle_rooms')
            .update({ host_id: nextHost })
            .eq('id', room.id);
          if (hostUpdateError) throw new Error(parseDbError(hostUpdateError));
        } else {
          const { error: closeRoomError } = await supabase
            .from('battle_rooms')
            .update({ status: 'closed' })
            .eq('id', room.id);
          if (closeRoomError) throw new Error(parseDbError(closeRoomError));
        }
      }

      const { error: leaveMembershipError } = await supabase
        .from('battle_room_members')
        .update({ status: 'left', left_at: new Date().toISOString(), role: 'player' })
        .eq('room_id', room.id)
        .eq('user_id', userId);
      if (leaveMembershipError) throw new Error(parseDbError(leaveMembershipError));

      clearRoomState();
      setInfo('You left the room.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to leave room';
      setError(message);
    } finally {
      setWorking(false);
    }
  }, [clearRoomState, room, userId]);

  const kickPlayer = useCallback(async (targetUserId: string) => {
    if (!room || !isHost || targetUserId === userId) return;

    setWorking(true);
    setError(null);
    try {
      const { error: kickError } = await supabase
        .from('battle_room_members')
        .update({ status: 'kicked', left_at: new Date().toISOString(), role: 'player' })
        .eq('room_id', room.id)
        .eq('user_id', targetUserId);

      if (kickError) throw new Error(parseDbError(kickError));
      setInfo('Player removed from room.');
      await refreshRoom(room.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to kick player';
      setError(message);
    } finally {
      setWorking(false);
    }
  }, [isHost, refreshRoom, room, userId]);

  const updateRoomSetup = useCallback(async (patch: Partial<BattleRoomRow>) => {
    if (!room || !isHost) return;
    setWorking(true);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from('battle_rooms')
        .update({
          bet_coins: patch.bet_coins ?? room.bet_coins,
          timer_seconds: patch.timer_seconds ?? room.timer_seconds,
          selected_game_type: patch.selected_game_type ?? room.selected_game_type,
          status: patch.status ?? room.status,
        })
        .eq('id', room.id);

      if (updateError) throw new Error(parseDbError(updateError));
      await refreshRoom(room.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update room';
      setError(message);
    } finally {
      setWorking(false);
    }
  }, [isHost, refreshRoom, room]);

  const handleCopyRoomKey = async () => {
    if (!room?.room_key) return;
    try {
      await navigator.clipboard.writeText(room.room_key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setError('Could not copy key. Copy manually.');
    }
  };

  if (loadingRoom) {
    return (
      <div className="card text-center py-8">
        <p className="text-doom-muted text-sm font-mono animate-pulse">Loading battle room...</p>
      </div>
    );
  }

  const showSetup = !room;

  return (
    <div className="flex flex-col gap-4">
      {showSetup ? (
        <>
          <div className="card">
            <p className="text-neon-green text-xs font-mono uppercase tracking-wider mb-2">Create battle room</p>
            <p className="text-doom-muted text-xs mb-3">
              Host creates a key, players join, host starts, then picks game mode.
            </p>
            <button
              onClick={() => {
                void createRoom();
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
                value={roomKeyInput}
                onChange={(event) => setRoomKeyInput(normalizeRoomKey(event.target.value))}
                placeholder="Room key"
                maxLength={ROOM_KEY_LENGTH}
                className="flex-1 bg-doom-surface border border-doom-border rounded-md px-3 py-2 text-sm tracking-[0.24em] uppercase focus:outline-none focus:border-neon-green/50"
              />
              <button
                onClick={() => {
                  void joinRoom();
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
                  Room {room.room_key}
                </p>
                <p className="text-doom-muted text-xs">
                  {isHost ? 'You are host' : 'You are player'} • {rankedPlayers.length}/{maxPlayers} players
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyRoomKey}
                  className="px-2 py-1 text-[11px] rounded-md border border-doom-border text-doom-muted hover:text-white hover:border-neon-green/40"
                >
                  {copied ? 'Copied' : 'Copy key'}
                </button>
                <button
                  onClick={() => {
                    void leaveRoom();
                  }}
                  className="btn-danger text-[11px] px-2 py-1 disabled:opacity-60"
                  disabled={working}
                >
                  Leave
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <p className="text-doom-muted text-xs font-mono uppercase tracking-wider">Lobby players</p>
              <p className="text-doom-muted text-[11px]">
                {roomIsFull ? 'Room full' : `${maxPlayers - rankedPlayers.length} slots open`}
              </p>
            </div>
            <div className="space-y-2">
              {rankedPlayers.map((player) => {
                const isMe = player.userId === userId;
                const playerIsHost = player.userId === room.host_id;
                return (
                  <div
                    key={player.userId}
                    className="flex items-center justify-between rounded-lg border border-doom-border bg-doom-bg/40 px-2.5 py-2"
                  >
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
                      {playerIsHost && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-neon-green/40 text-neon-green font-mono">
                          HOST
                        </span>
                      )}
                      {isMe && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-doom-border text-doom-muted font-mono">
                          YOU
                        </span>
                      )}
                      {isHost && !isMe && (
                        <button
                          onClick={() => {
                            void kickPlayer(player.userId);
                          }}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-neon-pink/40 text-neon-pink hover:bg-neon-pink/15 transition-colors"
                          disabled={working}
                        >
                          Kick
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {room.status === 'lobby' && (
            <div className="card">
              <p className="text-doom-muted text-xs font-mono uppercase tracking-wider mb-2">Round setup</p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <label className="block">
                  <span className="text-[11px] text-doom-muted">Bet coins</span>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, Math.floor(availableCoins))}
                    value={room.bet_coins}
                    disabled={!isHost || working}
                    onChange={(event) => {
                      const bet = clampBet(Number(event.target.value), availableCoins);
                      void updateRoomSetup({ bet_coins: bet });
                    }}
                    className="mt-1 w-full bg-doom-surface border border-doom-border rounded-md px-2 py-1.5 text-sm disabled:opacity-60"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-doom-muted">Round timer</span>
                  <select
                    value={room.timer_seconds}
                    disabled={!isHost || working}
                    onChange={(event) => {
                      void updateRoomSetup({ timer_seconds: Number(event.target.value) });
                    }}
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
                  onClick={() => {
                    void updateRoomSetup({ status: 'game_select', selected_game_type: null });
                  }}
                  disabled={!canStart || working}
                  className="btn-primary w-full text-sm disabled:opacity-50"
                >
                  {canStart ? 'Start Battle' : 'Need at least 2 players'}
                </button>
              ) : (
                <p className="text-doom-muted text-xs">Waiting for host to start.</p>
              )}
            </div>
          )}

          {room.status === 'game_select' && (
            <div className="card">
              <p className="text-neon-green text-xs font-mono uppercase tracking-wider mb-1">Game select</p>
              <p className="text-doom-muted text-xs mb-3">
                Pot: <span className="text-white">{room.bet_coins * rankedPlayers.length} coins</span> • Timer:{' '}
                <span className="text-white">{formatTimer(room.timer_seconds)}</span>
              </p>

              {isHost ? (
                <div className="grid grid-cols-1 gap-2">
                  {GAME_OPTIONS.map((option) => {
                    const selected = room.selected_game_type === option.id;
                    return (
                      <button
                        key={option.id}
                        onClick={() => {
                          void updateRoomSetup({ selected_game_type: option.id });
                        }}
                        className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                          selected
                            ? 'border-neon-green/60 bg-neon-green/10'
                            : 'border-doom-border bg-doom-surface hover:border-neon-green/30'
                        }`}
                        disabled={working}
                      >
                        <p className="text-sm text-white">{option.title}</p>
                        <p className="text-[11px] text-doom-muted">{option.subtitle} • {option.details}</p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-doom-muted text-xs">Waiting for host to choose game type...</p>
              )}

              {room.selected_game_type && (
                <div className="mt-3 rounded-lg border border-neon-green/35 bg-neon-green/10 px-3 py-2">
                  <p className="text-neon-green text-xs font-mono uppercase tracking-wider">
                    Selected: {getGameLabel(room.selected_game_type)}
                  </p>
                  <p className="text-[11px] text-doom-muted mt-1">
                    Gameplay for this mode will be wired next.
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
