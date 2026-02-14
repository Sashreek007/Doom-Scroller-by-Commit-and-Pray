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

export type ExtensionMessage =
  | ScrollUpdateMessage
  | BattleScrollMessage
  | BattlePlayerQuitMessage
  | GetStatsMessage;
