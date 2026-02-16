import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PostgrestError, RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/shared/supabase';
import UserAvatar from '../components/UserAvatar';

type BattleRoomStatus = 'lobby' | 'game_select' | 'active' | 'closed';
type BattleMemberStatus = 'joined' | 'left' | 'kicked';
type BattleMemberRole = 'host' | 'player';
type GameTypeKey = 'scroll_sprint' | 'target_chase';

interface BattleProps {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  availableCoins: number;
  onWalletSync?: () => void | Promise<void>;
}

interface BattleRoomRow {
  id: string;
  room_key: string;
  host_id: string;
  status: BattleRoomStatus;
  bet_coins: number;
  timer_seconds: number;
  selected_game_type: GameTypeKey | null;
  round_target_meters: number | null;
  round_started_at: string | null;
  round_ends_at: string | null;
  round_result: unknown | null;
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
  round_start_meters: number;
  round_score_meters: number;
}

interface BattlePlayer {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  joinedAt: string;
  role: BattleMemberRole;
  totalMeters: number;
  roundStartMeters: number;
  roundScoreMeters: number;
}

interface BattleRoundResult {
  settledAt: string;
  pot: number;
  betCoins: number;
  winnerIds: string[];
  payouts: Record<string, number>;
  scores: Record<string, number>;
  targetMeters?: number | null;
  offBy?: Record<string, number> | null;
}

interface BattleGameOption {
  id: GameTypeKey;
  title: string;
  subtitle: string;
  details: string;
}

const DEFAULT_MAX_PLAYERS = 4;
const DEFAULT_TIMER_SECONDS = 120;
const TIMER_OPTIONS_SECONDS = [10, 20, 60, 120, 180, 300];
const ROOM_KEY_LENGTH = 6;
const JOIN_KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DB_REFRESH_DEBOUNCE_MS = 120;
const ROOM_POLL_INTERVAL_MS = 1200;
const PRESTART_SECONDS = 8;
const RESULT_SEEN_STORAGE_PREFIX = 'battle_result_seen_';
const SHOW_POPUP_ROUND_VISUALS = false;

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
];

const GAME_RULES: Record<GameTypeKey, string[]> = {
  scroll_sprint: [
    'Scroll as much as possible before timer ends.',
    'Highest distance wins the pot.',
    'Tie splits coins evenly.',
  ],
  target_chase: [
    'Try to finish closest to the target distance.',
    'Overshoot and undershoot both count.',
    'Closest distance wins.',
  ],
};

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

function formatCountdownFromMs(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function parseRoundResult(value: unknown): BattleRoundResult | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;

  const settledAt = typeof row.settledAt === 'string' ? row.settledAt : null;
  const pot = Number(row.pot);
  const betCoins = Number(row.betCoins);
  const winnerIdsRaw = Array.isArray(row.winnerIds) ? row.winnerIds : [];
  const payoutsRaw = row.payouts && typeof row.payouts === 'object' ? row.payouts as Record<string, unknown> : {};
  const scoresRaw = row.scores && typeof row.scores === 'object' ? row.scores as Record<string, unknown> : {};
  const offByRaw = row.offBy && typeof row.offBy === 'object' ? row.offBy as Record<string, unknown> : {};
  const targetMetersRaw = Number(row.targetMeters);

  if (!settledAt || !Number.isFinite(pot) || !Number.isFinite(betCoins)) return null;

  const winnerIds = winnerIdsRaw
    .filter((entry): entry is string => typeof entry === 'string');

  const payouts: Record<string, number> = {};
  for (const [key, raw] of Object.entries(payoutsRaw)) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) payouts[key] = parsed;
  }

  const scores: Record<string, number> = {};
  for (const [key, raw] of Object.entries(scoresRaw)) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) scores[key] = parsed;
  }

  const offBy: Record<string, number> = {};
  for (const [key, raw] of Object.entries(offByRaw)) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) offBy[key] = parsed;
  }

  return {
    settledAt,
    pot: Math.max(0, Math.floor(pot)),
    betCoins: Math.max(0, Math.floor(betCoins)),
    winnerIds,
    payouts,
    scores,
    targetMeters: Number.isFinite(targetMetersRaw) ? targetMetersRaw : null,
    offBy: Object.keys(offBy).length > 0 ? offBy : null,
  };
}

function formatMeters(value: number): string {
  if (!Number.isFinite(value)) return '0m';
  if (value < 1000) return `${value.toFixed(1)}m`;
  return `${(value / 1000).toFixed(2)}km`;
}

function getResultSeenStorageKey(userId: string, roomId: string): string {
  return `${RESULT_SEEN_STORAGE_PREFIX}${userId}_${roomId}`;
}

function parseDbError(error: PostgrestError | null): string {
  if (!error) return 'Unexpected database error';
  if (error.code === '42P01') return 'Battle tables are not deployed yet. Run latest migration.';
  if (error.code === '23505') return 'Duplicate value conflict. Try again.';
  if (error.code === '42501') return 'Permission denied by database policy.';
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
  onWalletSync,
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
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [resultOverlay, setResultOverlay] = useState<BattleRoundResult | null>(null);

  const refreshTimeoutRef = useRef<number | null>(null);
  const roomSubRef = useRef<RealtimeChannel | null>(null);
  const refreshInFlightRef = useRef(false);
  const queuedRefreshRef = useRef(false);
  const autoFinalizeRef = useRef<string | null>(null);
  const shownResultKeyRef = useRef<string | null>(null);

  const isHost = Boolean(room && room.host_id === userId);
  const maxPlayers = room?.max_players ?? DEFAULT_MAX_PLAYERS;
  const rankedPlayers = useMemo(() => rankPlayersByJoinTime(players), [players]);
  const roomIsFull = rankedPlayers.length >= maxPlayers;
  const canStart = isHost && room?.status === 'lobby' && rankedPlayers.length >= 2;
  const selectedRules = room?.selected_game_type ? GAME_RULES[room.selected_game_type] : [];
  const latestRoundResult = parseRoundResult(room?.round_result ?? null);
  const playerNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const player of rankedPlayers) {
      map[player.userId] = player.displayName;
    }
    return map;
  }, [rankedPlayers]);
  const roundStartsAtMs = room?.round_started_at ? new Date(room.round_started_at).getTime() : null;
  const roundEndsAtMs = room?.round_ends_at ? new Date(room.round_ends_at).getTime() : null;
  const isPrestartPhase = room?.status === 'active' && roundStartsAtMs != null && nowTs < roundStartsAtMs;
  const isRoundLive = room?.status === 'active'
    && roundStartsAtMs != null
    && roundEndsAtMs != null
    && nowTs >= roundStartsAtMs
    && nowTs < roundEndsAtMs;
  const isRoundComplete = room?.status === 'active' && roundEndsAtMs != null && nowTs >= roundEndsAtMs;
  const prestartRemainingMs = isPrestartPhase && roundStartsAtMs != null ? roundStartsAtMs - nowTs : 0;
  const roundRemainingMs = isRoundLive && roundEndsAtMs != null ? roundEndsAtMs - nowTs : 0;
  const liveStandings = useMemo(() => {
    if (!room?.selected_game_type) return [] as Array<{ userId: string; score: number; offBy: number | null }>;
    const targetMeters = Number(room.round_target_meters ?? 0);
    const byDistance = room.selected_game_type === 'target_chase';

    const rows = [...rankedPlayers]
      .map((player) => {
        const score = Math.max(0, Number(player.totalMeters) - Number(player.roundStartMeters));
        return {
          userId: player.userId,
          score,
          offBy: byDistance ? Math.abs(score - targetMeters) : null,
        };
      });

    if (byDistance) {
      return rows.sort((left, right) => {
        const leftOffBy = left.offBy ?? Number.POSITIVE_INFINITY;
        const rightOffBy = right.offBy ?? Number.POSITIVE_INFINITY;
        if (leftOffBy !== rightOffBy) return leftOffBy - rightOffBy;
        return right.score - left.score;
      });
    }

    return rows.sort((left, right) => right.score - left.score);
  }, [rankedPlayers, room?.round_target_meters, room?.selected_game_type]);

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
    let profileMap = new Map<
      string,
      { username: string; display_name: string; avatar_url: string | null; total_meters_scrolled: number }
    >();

    if (profileIds.length > 0) {
      const { data: profileRows, error: profileError } = await supabase
        .rpc('get_social_profiles', {
          profile_ids: profileIds,
        });

      if (profileError) throw new Error(parseDbError(profileError));

      for (const row of profileRows ?? []) {
        profileMap.set(row.id as string, {
          username: (row.username as string) ?? 'user',
          display_name: (row.display_name as string) ?? 'User',
          avatar_url: (row.avatar_url as string | null) ?? null,
          total_meters_scrolled: Number(row.total_meters_scrolled ?? 0),
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
        totalMeters: Number(profile?.total_meters_scrolled ?? 0),
        roundStartMeters: Number(member.round_start_meters ?? 0),
        roundScoreMeters: Number(member.round_score_meters ?? 0),
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

  useEffect(() => {
    if (room?.status !== 'active') return;
    const interval = window.setInterval(() => {
      setNowTs(Date.now());
    }, 250);
    return () => {
      window.clearInterval(interval);
    };
  }, [room?.status]);

  useEffect(() => {
    if (!latestRoundResult || !room?.id) return;
    const resultKey = `${room.id}:${latestRoundResult.settledAt}`;
    if (shownResultKeyRef.current === resultKey) return;
    const seenStorageKey = getResultSeenStorageKey(userId, room.id);
    let cancelled = false;
    let timeout: number | null = null;

    void (async () => {
      try {
        const cached = await chrome.storage.local.get(seenStorageKey);
        if (cancelled) return;
        const seenResultKey = typeof cached[seenStorageKey] === 'string'
          ? cached[seenStorageKey] as string
          : null;
        if (seenResultKey === resultKey) return;
      } catch {
        // Ignore storage read errors and continue with in-memory gating.
      }

      if (cancelled) return;
      shownResultKeyRef.current = resultKey;
      void onWalletSync?.();
      if (SHOW_POPUP_ROUND_VISUALS) {
        setResultOverlay(latestRoundResult);
        timeout = window.setTimeout(() => {
          setResultOverlay(null);
        }, 5200);
      } else {
        setResultOverlay(null);
      }

      try {
        await chrome.storage.local.set({ [seenStorageKey]: resultKey });
      } catch {
        // Ignore storage write failures; UI still works.
      }
    })();

    return () => {
      cancelled = true;
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [latestRoundResult, onWalletSync, room?.id, userId]);

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
      const nextBetCoins = patch.bet_coins ?? room.bet_coins;
      const nextTimerSeconds = patch.timer_seconds ?? room.timer_seconds;
      const nextSelectedGameType = Object.prototype.hasOwnProperty.call(patch, 'selected_game_type')
        ? patch.selected_game_type
        : room.selected_game_type;
      const nextStatus = patch.status ?? room.status;
      const nextRoundStartedAt = Object.prototype.hasOwnProperty.call(patch, 'round_started_at')
        ? patch.round_started_at
        : room.round_started_at;
      const nextRoundEndsAt = Object.prototype.hasOwnProperty.call(patch, 'round_ends_at')
        ? patch.round_ends_at
        : room.round_ends_at;
      const nextRoundTargetMeters = Object.prototype.hasOwnProperty.call(patch, 'round_target_meters')
        ? patch.round_target_meters
        : room.round_target_meters;

      const { error: updateError } = await supabase
        .from('battle_rooms')
        .update({
          bet_coins: nextBetCoins,
          timer_seconds: nextTimerSeconds,
          selected_game_type: nextSelectedGameType,
          status: nextStatus,
          round_started_at: nextRoundStartedAt,
          round_ends_at: nextRoundEndsAt,
          round_target_meters: nextRoundTargetMeters,
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

  const handleStartRound = useCallback(async () => {
    if (!room || !isHost) return;
    if (!room.selected_game_type) {
      setError('Host must select a game type first.');
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('start_battle_round', {
        p_room_id: room.id,
        p_prestart_seconds: PRESTART_SECONDS,
      });
      if (rpcError) throw new Error(parseDbError(rpcError));
      await refreshRoom(room.id);
      setInfo(`Round starts in ${PRESTART_SECONDS}s. Read rules before go time.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start round';
      setError(message);
    } finally {
      setWorking(false);
    }
  }, [isHost, refreshRoom, room]);

  const handleBackToGameSelect = useCallback(async () => {
    if (!room || !isHost) return;
    await updateRoomSetup({
      status: 'game_select',
      round_started_at: null,
      round_ends_at: null,
      round_target_meters: null,
    });
  }, [isHost, room, updateRoomSetup]);

  const finalizeRound = useCallback(async () => {
    if (!room || !isHost) return;
    setWorking(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('finalize_battle_round', {
        p_room_id: room.id,
      });
      if (rpcError) throw new Error(parseDbError(rpcError));
      await refreshRoom(room.id);
      setInfo('Round settled. Coins moved.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to finalize round';
      setError(message);
      autoFinalizeRef.current = null;
    } finally {
      setWorking(false);
    }
  }, [isHost, refreshRoom, room]);

  useEffect(() => {
    if (!room || !isHost || !isRoundComplete) return;
    const finalizeKey = `${room.id}:${room.round_ends_at ?? ''}`;
    if (autoFinalizeRef.current === finalizeKey) return;
    autoFinalizeRef.current = finalizeKey;
    void finalizeRound();
  }, [finalizeRound, isHost, isRoundComplete, room]);

  if (loadingRoom) {
    return (
      <div className="card text-center py-8">
        <p className="text-doom-muted text-sm font-mono animate-pulse">Loading battle room...</p>
      </div>
    );
  }

  const showSetup = !room;
  const overlayIsWinner = resultOverlay ? resultOverlay.winnerIds.includes(userId) : false;
  const overlayNetCoins = Math.floor(Number(resultOverlay?.payouts[userId] ?? 0));
  const overlayHeadline = overlayIsWinner ? 'YOU WIN' : 'BETTER LUCK NEXT TIME';
  const overlaySubline = overlayIsWinner
    ? `+${Math.max(0, overlayNetCoins)} coins`
    : `${overlayNetCoins} coins`;
  const confettiColors = ['#39ff14', '#facc15', '#00f0ff', '#ff2d78', '#ffffff'];

  return (
    <div className="relative flex flex-col gap-4">
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
                    void updateRoomSetup({
                      status: 'game_select',
                      selected_game_type: null,
                      round_started_at: null,
                      round_ends_at: null,
                      round_target_meters: null,
                    });
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
                  <p className="text-neon-green text-xs font-mono uppercase tracking-wider mb-1">
                    Rules: {getGameLabel(room.selected_game_type)}
                  </p>
                  <ul className="space-y-1">
                    {selectedRules.map((rule) => (
                      <li key={rule} className="text-[11px] text-doom-muted">
                        • {rule}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {latestRoundResult && (
                <div className="mt-3 rounded-lg border border-doom-border bg-doom-bg/50 px-3 py-2">
                  <p className="text-doom-muted text-[11px] font-mono uppercase tracking-wider mb-1">
                    Last round
                  </p>
                  <p className="text-xs text-white">
                    Winners:{' '}
                    <span className="text-neon-green">
                      {latestRoundResult.winnerIds.map((id) => playerNameById[id] ?? 'Player').join(', ')}
                    </span>
                  </p>
                  <p className="text-[11px] text-doom-muted">
                    Pot {latestRoundResult.pot} • Your result{' '}
                    <span className={Number(latestRoundResult.payouts[userId] ?? 0) >= 0 ? 'text-neon-green' : 'text-neon-pink'}>
                      {Number(latestRoundResult.payouts[userId] ?? 0) >= 0 ? '+' : ''}{Math.floor(Number(latestRoundResult.payouts[userId] ?? 0))} coins
                    </span>
                  </p>
                  {Number.isFinite(Number(latestRoundResult.targetMeters ?? NaN)) && (
                    <p className="text-[11px] text-doom-muted mt-0.5">
                      Target:{' '}
                      <span className="text-neon-cyan">
                        {formatMeters(Number(latestRoundResult.targetMeters ?? 0))}
                      </span>
                      {latestRoundResult.offBy && Number.isFinite(Number(latestRoundResult.offBy[userId] ?? NaN)) && (
                        <>
                          {' '}• You were{' '}
                          <span className="text-white">
                            {formatMeters(Number(latestRoundResult.offBy[userId] ?? 0))}
                          </span>
                          {' '}off
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}

              {isHost && room.selected_game_type && (
                <button
                  onClick={() => {
                    void handleStartRound();
                  }}
                  disabled={working}
                  className="btn-primary w-full text-sm mt-3 disabled:opacity-60"
                >
                  Start Round
                </button>
              )}
            </div>
          )}

          {room.status === 'active' && (
            <div className="card">
              <p className="text-neon-green text-xs font-mono uppercase tracking-wider mb-2">
                {room.selected_game_type ? `${getGameLabel(room.selected_game_type)} • Round Live` : 'Round Live'}
              </p>

              {room.selected_game_type && (
                <div className="rounded-lg border border-doom-border bg-doom-bg/50 px-3 py-2 mb-3">
                  <p className="text-doom-muted text-[11px] font-mono uppercase tracking-wider mb-1">Rules</p>
                  <ul className="space-y-1">
                    {selectedRules.map((rule) => (
                      <li key={rule} className="text-[11px] text-doom-muted">
                        • {rule}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!SHOW_POPUP_ROUND_VISUALS && (isPrestartPhase || isRoundLive) && (
                <div className="rounded-lg border border-doom-border bg-doom-bg/50 px-3 py-2 text-center mb-3">
                  <p className="text-[11px] text-doom-muted">
                    Round countdown is shown on the main page overlay.
                  </p>
                </div>
              )}

              {SHOW_POPUP_ROUND_VISUALS && isPrestartPhase && (
                <div className="rounded-lg border border-neon-cyan/45 bg-neon-cyan/10 px-3 py-3 text-center">
                  <p className="text-neon-cyan text-[11px] font-mono uppercase tracking-wider">Starting in</p>
                  <p className="text-3xl font-mono font-bold text-neon-cyan mt-1">
                    {formatCountdownFromMs(prestartRemainingMs)}
                  </p>
                  <p className="text-[11px] text-doom-muted mt-1">Read rules now. Round starts automatically.</p>
                </div>
              )}

              {SHOW_POPUP_ROUND_VISUALS && isRoundLive && (
                <div className="rounded-lg border border-neon-green/45 bg-neon-green/10 px-3 py-3 text-center">
                  <p className="text-neon-green text-[11px] font-mono uppercase tracking-wider">Time left</p>
                  <p className="text-4xl font-mono font-bold neon-text-green mt-1">
                    {formatCountdownFromMs(roundRemainingMs)}
                  </p>
                </div>
              )}

              {room.selected_game_type === 'target_chase' && Number.isFinite(Number(room.round_target_meters ?? NaN)) && (
                <div className="rounded-lg border border-neon-cyan/45 bg-neon-cyan/10 px-3 py-2 mt-3 text-center">
                  <p className="text-neon-cyan text-[11px] font-mono uppercase tracking-wider">Target distance</p>
                  <p className="text-2xl font-mono font-bold text-neon-cyan mt-1">
                    {formatMeters(Number(room.round_target_meters ?? 0))}
                  </p>
                  <p className="text-[11px] text-doom-muted mt-1">Closest player wins this round.</p>
                </div>
              )}

              {(room.selected_game_type === 'scroll_sprint' || room.selected_game_type === 'target_chase') && liveStandings.length > 0 && (
                <div className="rounded-lg border border-doom-border bg-doom-bg/40 p-2 mt-3">
                  <p className="text-doom-muted text-[11px] font-mono uppercase tracking-wider mb-1">
                    Live standings
                  </p>
                  <div className="space-y-1">
                    {liveStandings.map((entry, index) => {
                      const player = rankedPlayers.find((item) => item.userId === entry.userId);
                      if (!player) return null;
                      const isMe = player.userId === userId;
                      return (
                        <div
                          key={player.userId}
                          className="flex items-center justify-between rounded border border-doom-border px-2 py-1 text-xs"
                        >
                          <span className={`${isMe ? 'text-neon-green' : 'text-white'}`}>
                            #{index + 1} {player.displayName}{isMe ? ' (You)' : ''}
                          </span>
                          {room.selected_game_type === 'target_chase' ? (
                            <span className="font-mono tabular-nums text-doom-muted text-right">
                              {formatMeters(entry.score)}
                              {' '}• off{' '}
                              {formatMeters(Number(entry.offBy ?? 0))}
                            </span>
                          ) : (
                            <span className="font-mono tabular-nums text-doom-muted">
                              {formatMeters(entry.score)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {isRoundComplete && (
                <div className="rounded-lg border border-neon-pink/40 bg-neon-pink/10 px-3 py-3">
                  <p className="text-neon-pink text-sm font-mono">Round complete.</p>
                  {isHost ? (
                    <div className="flex flex-col gap-2 mt-2">
                      <button
                        onClick={() => {
                          void finalizeRound();
                        }}
                        className="btn-primary w-full text-sm disabled:opacity-60"
                        disabled={working}
                      >
                        Finalize Round
                      </button>
                      <button
                        onClick={() => {
                          void handleBackToGameSelect();
                        }}
                        className="px-3 py-2 text-xs rounded-md border border-doom-border text-doom-muted hover:text-white hover:border-neon-green/35"
                        disabled={working}
                      >
                        Back To Game Select
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-doom-muted mt-1">Waiting for host to set the next round.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {SHOW_POPUP_ROUND_VISUALS && resultOverlay && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[1px] flex items-center justify-center px-6">
          <style>{`
            @keyframes doomBattleConfettiFall {
              0% { transform: translateY(-20vh) rotate(0deg); opacity: 1; }
              100% { transform: translateY(120vh) rotate(360deg); opacity: 0.2; }
            }
          `}</style>

          {overlayIsWinner && (
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {Array.from({ length: 30 }).map((_, index) => {
                const left = (index * 17) % 100;
                const delay = (index % 7) * 0.18;
                const duration = 1.8 + (index % 6) * 0.24;
                const width = 6 + (index % 4) * 2;
                const height = 10 + (index % 5) * 2;
                const color = confettiColors[index % confettiColors.length];
                return (
                  <span
                    key={`confetti-${index}`}
                    className="absolute rounded-sm"
                    style={{
                      left: `${left}%`,
                      top: '-12%',
                      width: `${width}px`,
                      height: `${height}px`,
                      backgroundColor: color,
                      animation: `doomBattleConfettiFall ${duration}s linear ${delay}s infinite`,
                    }}
                  />
                );
              })}
            </div>
          )}

          <div className={`relative z-10 w-full max-w-sm rounded-2xl border px-5 py-6 text-center shadow-2xl ${
            overlayIsWinner
              ? 'border-neon-green/70 bg-neon-green/12'
              : 'border-neon-pink/70 bg-neon-pink/12'
          }`}>
            <p className={`text-4xl font-mono font-bold ${overlayIsWinner ? 'neon-text-green' : 'neon-text-pink'}`}>
              {overlayHeadline}
            </p>
            <p className={`mt-2 text-xl font-mono tabular-nums ${overlayIsWinner ? 'text-neon-green' : 'text-neon-pink'}`}>
              {overlaySubline}
            </p>
            <p className="mt-2 text-[11px] text-doom-muted">
              Pot {resultOverlay.pot} coins • Bet {resultOverlay.betCoins} coins
            </p>
            <button
              className="mt-4 px-3 py-1.5 rounded-md border border-doom-border text-xs text-doom-muted hover:text-white hover:border-neon-green/40"
              onClick={() => setResultOverlay(null)}
            >
              Close
            </button>
          </div>
        </div>
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
