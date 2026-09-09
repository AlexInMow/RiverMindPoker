import type { BoardMetrics, Card, PlayerId, Street } from "./types";
import type { PreflopAnalysis } from "./preflopCoach";

export interface CoachDraw {
  kind: string;
  label: string;
  cards: Card[];
  potentialOuts: Card[];
  description: string;
}
export interface CoachAnalysis {
  preflop?: PreflopAnalysis;
  madeHand: string;
  bestFiveCards: Card[];
  draws: CoachDraw[];
  outs: Card[];
  boardTexture: { label: string; reasons: string[]; metrics: BoardMetrics };
  potOdds?: { call: number; potBefore: number; potAfter: number; contestablePotAfter: number; requiredEquity: number };
  warnings: string[];
  learningConcepts: { id: string; text: string }[];
}
export interface CoachDecision {
  index: number;
  player: PlayerId;
  street: Street;
  title: string;
  explanation: string;
  actionCategory: string;
  certainty: "observed" | "heuristic" | "unknown";
  board: Card[];
  analysis?: CoachAnalysis;
  betSizePercent?: number;
  technicalData?: { strength?: number; valueThreshold?: number; source: string };
}
export interface CoachReport {
  handId: string;
  actionCount: number;
  current: CoachAnalysis;
  decisions: CoachDecision[];
  showdown: { player: PlayerId; cards: Card[]; madeHand: string; bestFiveCards: Card[] }[];
  resultSummary?: string;
  takeaway: string;
}
