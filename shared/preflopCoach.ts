import type { Card, LegalAction, PlayerAction, PlayerId } from "./types";

export interface PreflopContext {
  position: string;
  playerCount: number;
  playersInHand: number;
  bigBlind: number;
  effectiveStackBb: number;
  aggressor?: PlayerId;
  aggressorPosition?: string;
  actions: PlayerAction[];
  amountToCall: number;
  currentBet: number;
  legalActions: LegalAction[];
  canAct: boolean;
}
export interface PreflopEquityEstimate {
  equity: number;
  opponents: number;
  rangeAssumption: string;
  method: string;
  samples?: number;
}
/** Future async/cached provider. Never use the rating as an equity estimate. */
export interface PreflopEquityProvider {
  estimate(cards: [Card, Card], opponents: number): Promise<PreflopEquityEstimate>;
}
export interface PreflopAnalysis {
  handClass: string;
  cards: Card[];
  rating: number;
  ratingMethod: "local-preflop-v1";
  ratingMeaning: string;
  category: string;
  traits: { id: string; text: string }[];
  reasons: string[];
  position: string;
  positionExplanation: string;
  playerCount: number;
  playersInHand: number;
  actionContext: "unopened" | "limped" | "open-raise" | "open-callers" | "3bet" | "4bet-plus";
  contextLabel: string;
  betLevel: number;
  aggressorPosition?: string;
  effectiveStackBb: number;
  stackCategory: "short" | "medium" | "deep";
  stackExplanation: string;
  recommendedAction: string | null;
  alternatives: string[];
  playFrequency: string;
  explanation: string;
  openSizing?: { min: number; max: number; bigBlind: number };
  equity?: PreflopEquityEstimate;
  learningConcepts: { id: string; text: string }[];
}
