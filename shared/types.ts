export type Suit = "s" | "h" | "d" | "c";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";
export type Card = `${Rank}${Suit}`;
export type PlayerId = "human" | "ai";
export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";
export type Strategy = "balanced" | "tag" | "lag" | "nit" | "calling-station" | "maniac" | "tricky" | "adaptive";
export type Difficulty = "casual" | "strong" | "expert";
export type Language = "ru" | "en";
export type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "all-in";

export interface GameConfig {
  language: Language;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  strategy: Strategy;
  difficulty: Difficulty;
  tableTalk: boolean;
  coachMode: boolean;
  debugMode: boolean;
}

export interface LegalAction {
  type: ActionType;
  amount?: number;
  min?: number;
  max?: number;
  label: string;
}

export interface PlayerAction {
  player: PlayerId;
  street: Street;
  action: ActionType | "small-blind" | "big-blind" | "wins" | "split";
  amount?: number;
  at: number;
}

export interface PlayerPublicState {
  id: PlayerId;
  stack: number;
  streetBet: number;
  totalContribution: number;
  folded: boolean;
  allIn: boolean;
  cards: Card[] | null;
}

export interface HandResult {
  winners: PlayerId[];
  pot: number;
  summary: string;
  humanHand?: string;
  aiHand?: string;
  humanScore?: EvaluatedHandSummary;
  aiScore?: EvaluatedHandSummary;
  showdownDetail?: ShowdownDetail;
  payouts: Record<PlayerId, number>;
}

export type ShowdownReason = "higher-card" | "higher-pair" | "higher-two-pair" | "higher-trips" | "higher-straight" | "higher-flush" | "higher-full-house" | "higher-quads" | "higher-straight-flush" | "kicker";

export interface ShowdownDetail {
  reason: ShowdownReason;
  category: number;
  decisiveIndex: number;
  decisiveRank: number;
  winningRank: number;
  losingRank: number;
}

export interface EvaluatedHandSummary {
  category: number;
  name: string;
  rankValues: number[];
  bestFive: Card[];
}

export interface PlayerProfile {
  hands: number;
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
  aggressionFactor: number;
  averageBetSize: number;
  tendencies: string[];
}

export interface CompactHandAction {
  player: PlayerId;
  street: Street;
  action: ActionType;
  amount?: number;
}

export interface AdaptiveHandSummary {
  handNumber: number;
  button: PlayerId;
  pot: number;
  winner: PlayerId | "split";
  reachedShowdown: boolean;
  actions: CompactHandAction[];
  playerLineTags: string[];
}

export interface RepeatedPlayerPattern {
  pattern: string;
  occurrences: number;
  handNumbers: number[];
}

export interface SessionStats extends PlayerProfile {
  handsWon: number;
  showdowns: number;
  showdownsWon: number;
  biggestPot: number;
  netChips: number;
  bbPer100: number;
  chipHistory: Array<{ hand: number; chips: number }>;
}

export interface PublicGameState {
  sessionId: string;
  handId: string;
  config: GameConfig;
  handNumber: number;
  button: PlayerId;
  street: Street;
  board: Card[];
  pot: number;
  currentBet: number;
  actor: PlayerId | null;
  matchOver: boolean;
  players: Record<PlayerId, PlayerPublicState>;
  legalActions: LegalAction[];
  actions: PlayerAction[];
  handLog: string[];
  completedHands: HandHistory[];
  result?: HandResult;
  stats: SessionStats;
  aiStatus: "connected" | "offline";
  aiThinking: boolean;
  tableTalk?: string;
  debug?: DebugInfo;
}

export interface HandHistory {
  handNumber: number;
  lines: string[];
  result: HandResult;
}

export interface AIVisibleGameState {
  game: "Heads-Up No-Limit Texas Hold'em";
  handNumber: number;
  street: Street;
  aiHoleCards: Card[];
  board: Card[];
  pot: number;
  aiStack: number;
  playerStack: number;
  blinds: { small: number; big: number };
  position: "button/small blind" | "big blind";
  button: PlayerId;
  currentHandActions: PlayerAction[];
  recentHands: AdaptiveHandSummary[];
  repeatedPlayerPatterns: RepeatedPlayerPattern[];
  legalActions: LegalAction[];
  playerProfile: PlayerProfile;
}

export interface AIDecision {
  action: ActionType;
  amount: number;
  reasoning_summary: string;
  table_talk: string;
}

export interface AITrace {
  provider: "openai" | "dummy";
  visibleState: AIVisibleGameState;
  request?: unknown;
  rawResponse?: unknown;
  validation: string;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

export interface DebugInfo {
  internalState: unknown;
  aiVisibleState?: AIVisibleGameState;
  lastAITrace?: AITrace;
}
