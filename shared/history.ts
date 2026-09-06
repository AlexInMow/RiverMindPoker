import type { Card, GameConfig, HandResult, PlayerAction, PlayerId, Seat, Strategy } from "./types";

export interface LocalPlayerProfile {
  id: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type HistoryScope = "all" | "session" | "last100" | "last500";
export type HistoryResultFilter = "all" | "profitable" | "losing" | "neutral";
export type HistoryShowdownFilter = "all" | "showdown" | "no-showdown";

export interface HistoryFilters {
  scope?: HistoryScope;
  sessionId?: string;
  tableSize?: 2 | 3 | 4;
  strategy?: Strategy;
  showdown?: HistoryShowdownFilter;
  result?: HistoryResultFilter;
  marked?: boolean;
  limit?: number;
  offset?: number;
}

export interface StoredSessionSummary {
  id: string;
  startedAt: string;
  endedAt: string | null;
  opponentCount: number;
  strategy: Strategy;
  difficulty: GameConfig["difficulty"];
  startingStack: number;
  finalStack: number | null;
  netChips: number | null;
  handsPlayed: number;
  bbPer100: number;
}

export interface StoredHandSummary {
  id: string;
  sessionId: string;
  handNumber: number;
  completedAt: string;
  humanNet: number;
  totalPot: number;
  opponentCount: number;
  strategy: Strategy;
  reachedShowdown: boolean;
  foldedStreet: string | null;
  tags: string[];
  isMarkedForReview: boolean;
  reviewNote: string;
}

export interface StoredHandPlayer {
  playerId: PlayerId;
  playerKind: "human" | "ai";
  seatIndex: number;
  position: string;
  startingStack: number;
  endingStack: number;
  contribution: number;
  payout: number;
  folded: boolean;
  allIn: boolean;
  eliminated: boolean;
  holeCards: Card[] | null;
  revealedAtShowdown: boolean;
}

export interface StoredHandDetail extends StoredHandSummary {
  engineHandId: string;
  startedAt: string;
  button: PlayerId;
  smallBlindPlayer: PlayerId;
  bigBlindPlayer: PlayerId;
  smallBlind: number;
  bigBlind: number;
  board: Card[];
  positions: Partial<Record<PlayerId, string>>;
  seats: Seat[];
  actions: PlayerAction[];
  players: StoredHandPlayer[];
  pots: NonNullable<HandResult["pots"]>;
  result: HandResult;
  humanContribution: number;
  humanPayout: number;
}

export interface LifetimeStats {
  sessions: number;
  hands: number;
  netChips: number;
  bbPer100: number;
  profitableHands: number;
  handsWithPayout: number;
  potsWon: number;
  showdowns: number;
  showdownsWithPayout: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  foldFrequency: number;
  foldOpportunities: number;
  foldToThreeBet: number;
  foldToThreeBetOpportunities: number;
  foldToCBet: number;
  foldToCBetOpportunities: number;
  flopCBet: number;
  flopCBetOpportunities: number;
  turnBarrel: number;
  turnBarrelOpportunities: number;
  riverAggression: number;
  riverOpportunities: number;
  checkRaise: number;
  checkRaiseOpportunities: number;
  wentToShowdown: number;
  wonAtShowdown: number;
  biggestPot: number;
  averagePot: number;
  biggestWinningHand: StoredHandSummary | null;
  biggestLosingHand: StoredHandSummary | null;
  profitHistory: Array<{ hand: number; completedAt: string; cumulativeNet: number }>;
}

export interface HistoryExport {
  format: "rivermind-history";
  version: 1;
  exportedAt: string;
  profile: LocalPlayerProfile;
  filters: HistoryFilters;
  lifetimeStats: LifetimeStats;
  sessions: StoredSessionSummary[];
  hands: StoredHandDetail[];
}
