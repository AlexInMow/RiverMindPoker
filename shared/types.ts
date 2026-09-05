export type Suit = "s" | "h" | "d" | "c";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";
export type Card = `${Rank}${Suit}`;
export type AIPlayerId = "ai" | "ai-2" | "ai-3";
export type PlayerId = "human" | AIPlayerId;
export type PlayerKind = "human" | "ai";
export type OpponentCount = 1 | 2 | 3;
export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";
export type Strategy = "balanced" | "tag" | "lag" | "nit" | "calling-station" | "maniac" | "tricky" | "adaptive";
export type Difficulty = "casual" | "strong" | "expert";
export type Language = "ru" | "en";
export type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "all-in";
export type PreflopHandClass = "premium" | "strong" | "medium" | "speculative" | "weak";

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
  /** Defaults to one when loading configs saved before multiplayer support. */
  opponentCount?: OpponentCount;
}

export interface Seat {
  seatIndex: number;
  playerId: PlayerId;
  kind: PlayerKind;
  displayName: string;
  /** Per-seat strategy permits future mixed AI personalities; setup currently assigns the table strategy to every AI. */
  strategy?: Strategy;
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
  /** Effective total street target after capping chips the opponent cannot cover. */
  effectiveAmount?: number;
  /** Semantic aggression decided by the engine, not inferred from the action label. */
  aggressive?: boolean;
  at: number;
}

export interface PlayerPublicState {
  id: PlayerId;
  stack: number;
  streetBet: number;
  totalContribution: number;
  folded: boolean;
  allIn: boolean;
  eliminated: boolean;
  cards: Card[] | null;
}

export interface SidePot {
  amount: number;
  eligible: PlayerId[];
}

export interface SettledPotResult extends SidePot {
  index: number;
  winners: PlayerId[];
  payouts: PlayerPayouts;
}

export type PlayerPayouts = Record<string, number>;

export interface HandResult {
  winners: PlayerId[];
  pot: number;
  summary: string;
  evaluatedHands?: Partial<Record<PlayerId, EvaluatedHandSummary>>;
  pots?: SettledPotResult[];
  /** @deprecated Compatibility fields for old heads-up consumers. */
  humanHand?: string;
  /** @deprecated Compatibility fields for old heads-up consumers. */
  aiHand?: string;
  /** @deprecated Compatibility fields for old heads-up consumers. */
  humanScore?: EvaluatedHandSummary;
  /** @deprecated Compatibility fields for old heads-up consumers. */
  aiScore?: EvaluatedHandSummary;
  showdownDetail?: ShowdownDetail;
  payouts: PlayerPayouts;
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
  wentToShowdownOpportunities: number;
  wonAtShowdown: number;
  wonAtShowdownOpportunities: number;
  aggressionFactor: number;
  averageBetSize: number;
  tendencies: string[];
}

export interface CompactHandAction {
  player: PlayerId;
  street: Street;
  action: ActionType;
  amount?: number;
  effectiveAmount?: number;
  aggressive?: boolean;
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

export interface BoardMetrics {
  cards: number;
  highCard: number | null;
  uniqueRanks: number;
  paired: boolean;
  trips: boolean;
  maxSuitCount: number;
  monotone: boolean;
  twoTone: boolean;
  broadwayCards: number;
  connectedness: number;
  wetness: number;
}

export interface AIContextMetrics {
  isInPositionPostflop: boolean;
  facingAggression: boolean;
  preflopBetLevel: number;
  currentBet: number;
  aiStreetBet: number;
  playerStreetBet: number;
  effectiveStackBB: number;
  amountToCallBB: number;
  potBB: number;
  aiCommittedBB: number;
  humanCommittedBB: number;
  committedFractionOfEffectiveStack: number;
  minimumRaiseTo: number | null;
  minimumRaiseToBB: number | null;
  minimumRaiseIncrementBB: number | null;
  remainingStackAfterCall: number;
  remainingStackAfterMinimumRaise: number | null;
  lastAction?: CompactHandAction;
}

export interface LocalBotCandidateAction {
  action: ActionType;
  probability: number;
  amount: number;
}

export interface LocalBotDecisionTrace {
  handClass?: PreflopHandClass;
  handLabel?: string;
  rawPreflopStrength?: number;
  preflopBetLevel: number;
  effectiveStackBB: number;
  amountToCallBB: number;
  potOdds: number;
  committedBB: number;
  committedFraction: number;
  raiseTargetBB: number | null;
  raiseIncrementBB: number | null;
  resultingPotBB: number | null;
  remainingStackAfterCall: number;
  remainingStackAfterRaise: number | null;
  strategy: Strategy;
  adaptiveConfidence: number;
  baseAggression: number;
  adjustedAggression: number;
  continueThreshold: number;
  raiseThreshold: number;
  jamThreshold: number;
  randomRoll: number;
  candidateActions: LocalBotCandidateAction[];
  chosenAction: ActionType;
  stackOffAllowed: boolean;
  reasonSummary: string;
}

export interface AdaptiveMetricConfidence {
  preflop: number;
  facingBet: number;
  facingThreeBet: number;
  facingCBet: number;
  flopCBet: number;
  turnBarrel: number;
  river: number;
  checkRaise: number;
  wentToShowdown: number;
  wonAtShowdown: number;
  repeatedPatterns: number;
}

export interface AdaptiveFrequencyAdjustments {
  defend: number;
  call: number;
  raise: number;
  fold: number;
  bluff: number;
  value: number;
}

export interface AdaptivePolicy {
  opponentType: "unknown" | "aggressive" | "nit" | "calling-station" | "balanced";
  confidence: number;
  metricConfidence: AdaptiveMetricConfidence;
  frequencyAdjustments: AdaptiveFrequencyAdjustments;
  reasons: string[];
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
  smallBlindPlayer: PlayerId;
  bigBlindPlayer: PlayerId;
  seats: Seat[];
  positions: Partial<Record<PlayerId, string>>;
  street: Street;
  board: Card[];
  pot: number;
  currentBet: number;
  actor: PlayerId | null;
  matchOver: boolean;
  players: Record<string, PlayerPublicState>;
  sidePots: SidePot[];
  legalActions: LegalAction[];
  actions: PlayerAction[];
  handLog: string[];
  completedHands: HandHistory[];
  result?: HandResult;
  stats: SessionStats;
  aiStatus: "connected" | "offline";
  aiThinking: boolean;
  aiThinkingPlayer?: PlayerId;
  tableTalk?: string;
  debug?: DebugInfo;
}

export interface HandHistory {
  handNumber: number;
  lines: string[];
  result: HandResult;
}

export interface AIVisibleGameState {
  game: "No-Limit Texas Hold'em";
  playerId: AIPlayerId;
  playerCount: number;
  activePlayers: number;
  playersLeftInHand: number;
  seats: Seat[];
  positions: Partial<Record<PlayerId, string>>;
  publicPlayers: Array<Omit<PlayerPublicState, "cards"> & { cards: null }>;
  handNumber: number;
  street: Street;
  aiHoleCards: Card[];
  board: Card[];
  pot: number;
  amountToCall: number;
  potOdds: number;
  effectiveStack: number;
  opponentEffectiveStacks: Record<string, number>;
  spr: number;
  boardMetrics: BoardMetrics;
  contextMetrics: AIContextMetrics;
  aiStack: number;
  playerStack: number;
  blinds: { small: number; big: number };
  position: string;
  button: PlayerId;
  smallBlindPlayer: PlayerId;
  bigBlindPlayer: PlayerId;
  sidePots: SidePot[];
  currentHandActions: PlayerAction[];
  recentHands: AdaptiveHandSummary[];
  repeatedPlayerPatterns: RepeatedPlayerPattern[];
  counterStrategy: AdaptivePolicy;
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
  localDecisionTrace?: LocalBotDecisionTrace;
}

export interface DebugInfo {
  internalState: unknown;
  seats?: Seat[];
  button?: PlayerId;
  smallBlindPlayer?: PlayerId;
  bigBlindPlayer?: PlayerId;
  actor?: PlayerId | null;
  currentBet?: number;
  minRaise?: number;
  playerDiagnostics?: Record<string, {
    stack: number; streetBet: number; contribution: number; folded: boolean;
    allIn: boolean; eliminated: boolean; raiseRight: boolean;
  }>;
  aiVisibleState?: AIVisibleGameState;
  aiVisibleStates?: Partial<Record<AIPlayerId, AIVisibleGameState>>;
  sidePots?: SidePot[];
  totalChipInvariant?: { expected: number; stacks: number; pot: number; actual: number; valid: boolean };
  lastAITrace?: AITrace;
}
