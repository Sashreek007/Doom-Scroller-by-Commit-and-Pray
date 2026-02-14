// Message types for chrome.runtime communication between content scripts and background SW

export interface ScrollUpdateMessage {
  type: 'SCROLL_UPDATE';
  payload: {
    site: string;
    pixels: number;
    meters: number;
    timestamp: number;
  };
}

export interface BattleScrollMessage {
  type: 'BATTLE_SCROLL_UPDATE';
  payload: {
    site: string;
    pixels: number;
    meters: number;
    timestamp: number;
  };
}

export interface BattlePlayerQuitMessage {
  type: 'BATTLE_PLAYER_QUIT';
}

export interface GetStatsMessage {
  type: 'GET_STATS';
}

export interface GetStatsResponse {
  todayMeters: number;
  todayBysite: Record<string, number>;
  totalMeters: number;
}

export interface GetBattleTimerMessage {
  type: 'GET_BATTLE_TIMER';
}

export interface GetBattleTimerResponse {
  active: boolean;
  roomId?: string;
  roomKey?: string;
  gameType?: string | null;
  roundStartedAt?: string;
  roundEndsAt?: string;
  timerSeconds?: number;
}

export interface AchievementToastPayload {
  eventKey: string;
  title: string;
  description: string;
  icon: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  roastLine: string;
  appScope?: string | null;
}

export interface AchievementToastMessage {
  type: 'ACHIEVEMENT_TOAST';
  payload: AchievementToastPayload;
}

export interface AchievementSyncedMessage {
  type: 'ACHIEVEMENT_SYNCED';
  payload: {
    userId: string;
    eventKey: string;
    achievementId?: string;
  };
}

export interface ChatbotResponse {
  reply: string;
  context?: {
    rank?: number | null;
    percentile?: number | null;
    topSite?: string | null;
    recentMeters?: number;
  };
}

export type ExtensionMessage =
  | ScrollUpdateMessage
  | BattleScrollMessage
  | BattlePlayerQuitMessage
  | GetStatsMessage
  | GetBattleTimerMessage;
