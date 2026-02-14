// ============ Scroll Tracking ============

export interface ScrollUpdate {
  site: string;
  pixels: number;
  meters: number;
  timestamp: number;
}

export interface ScrollBatch {
  site: string;
  totalPixels: number;
  totalMeters: number;
  sessionStart: number;
  lastUpdate: number;
}

export interface ScrollSession {
  id: string;
  user_id: string;
  site: string;
  pixels_scrolled: number;
  meters_scrolled: number;
  duration_seconds: number;
  session_start: string;
  session_end: string;
  created_at: string;
}

// ============ User & Profile ============

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_public: boolean;
  total_meters_scrolled: number;
  created_at: string;
}

// ============ Friendships ============

export type FriendshipStatus = 'pending' | 'accepted' | 'rejected';

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
}

// ============ Achievements ============

export interface Achievement {
  id: string;
  user_id: string;
  trigger_type: string;
  trigger_value: number;
  title: string;
  description: string;
  icon: string;
  earned_at: string;
}

// ============ Battles (v3) ============

export type BattleStatus = 'pending' | 'active' | 'completed' | 'cancelled';
export type ParticipantStatus = 'invited' | 'accepted' | 'declined' | 'active' | 'quit';

export interface Battle {
  id: string;
  creator_id: string;
  status: BattleStatus;
  winner_id: string | null;
  max_participants: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface BattleParticipant {
  id: string;
  battle_id: string;
  user_id: string;
  status: ParticipantStatus;
  meters_scrolled: number;
}

// ============ Leaderboard ============

export interface LeaderboardEntry {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  total_meters: number;
  rank: number;
}

// ============ Chat ============

export interface ChatMessage {
  id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}
