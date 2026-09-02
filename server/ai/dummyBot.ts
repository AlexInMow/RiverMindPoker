import type { AIDecision, AIVisibleGameState, Language, LegalAction, PlayerProfile, RepeatedPlayerPattern, Strategy } from "../../shared/types";
import { rankValue } from "../../poker-engine/cards";
import { evaluateHand } from "../../poker-engine/evaluator";

const aggression: Record<Strategy, number> = {
  balanced: 0.45, tag: 0.5, lag: 0.68, nit: 0.2, "calling-station": 0.12, maniac: 0.86, tricky: 0.52, adaptive: 0.48,
};

export interface AdaptivePolicy {
  opponentType: "unknown" | "aggressive" | "nit" | "calling-station" | "balanced";
  confidence: number;
  aggressionDelta: number;
  defendDelta: number;
  valueThresholdDelta: number;
  bluffDelta: number;
}

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));

export function deriveAdaptivePolicy(profile: PlayerProfile, patterns: RepeatedPlayerPattern[] = []): AdaptivePolicy {
  const repeatedPressure = patterns.some((pattern) => pattern.pattern === "preflop-aggression+flop-pressure" && pattern.occurrences >= 2);
  const foldProne = profile.foldFrequency >= 60
    || (profile.foldToThreeBetOpportunities >= 3 && profile.foldToThreeBet >= 65)
    || (profile.foldToCBetOpportunities >= 3 && profile.foldToCBet >= 65);
  const aggressive = profile.pfr >= 32 || profile.threeBet >= 15 || repeatedPressure
    || (profile.flopCBetOpportunities >= 3 && profile.flopCBet >= 75);
  const callingStation = profile.vpip >= 45 && profile.pfr <= 20 && profile.foldFrequency <= 35
    || (profile.wentToShowdown >= 45 && profile.foldFrequency <= 35);
  const nit = profile.vpip <= 22 || (foldProne && profile.pfr <= 20);
  const confidence = clamp(profile.hands / 20);

  if (profile.hands < 3) return { opponentType: "unknown", confidence, aggressionDelta: 0, defendDelta: 0, valueThresholdDelta: 0, bluffDelta: 0 };
  if (callingStation) return {
    opponentType: "calling-station", confidence,
    aggressionDelta: 0.04 * confidence, defendDelta: 0,
    valueThresholdDelta: -0.12 * confidence, bluffDelta: -0.16 * confidence,
  };
  if (aggressive) return {
    opponentType: "aggressive", confidence,
    aggressionDelta: -0.04 * confidence, defendDelta: 0.16 * confidence,
    valueThresholdDelta: 0.05 * confidence, bluffDelta: -0.04 * confidence,
  };
  if (nit || foldProne) return {
    opponentType: "nit", confidence,
    aggressionDelta: 0.16 * confidence, defendDelta: -0.08 * confidence,
    valueThresholdDelta: 0, bluffDelta: 0.15 * confidence,
  };
  return { opponentType: "balanced", confidence, aggressionDelta: 0, defendDelta: 0, valueThresholdDelta: 0, bluffDelta: 0 };
}

function handStrength(state: AIVisibleGameState): number {
  const [a, b] = state.aiHoleCards.map(rankValue);
  if (state.board.length < 3) {
    const pair = a === b ? 0.42 + a / 35 : 0;
    const suited = state.aiHoleCards[0][1] === state.aiHoleCards[1][1] ? 0.07 : 0;
    const connected = Math.abs(a - b) <= 2 ? 0.05 : 0;
    return Math.min(1, Math.max(a, b) / 18 + pair + suited + connected);
  }
  const score = evaluateHand([...state.aiHoleCards, ...state.board]);
  return Math.min(1, score.category / 8 + (score.kickers[0] ?? 2) / 45);
}

function sizedAction(action: LegalAction, pot: number, strength: number): number {
  if (action.type !== "bet" && action.type !== "raise") return action.amount ?? 0;
  const target = strength > 0.78 ? Math.round(pot * 0.8) : Math.round(pot * 0.55);
  return Math.max(action.min!, Math.min(action.max!, target));
}

export function dummyDecision(
  state: AIVisibleGameState,
  strategy: Strategy,
  tableTalk: boolean,
  language: Language = "en",
  randomValue: () => number = Math.random,
): AIDecision {
  const legal = state.legalActions;
  const strength = handStrength(state);
  const policy = strategy === "adaptive" ? deriveAdaptivePolicy(state.playerProfile, state.repeatedPlayerPatterns) : undefined;
  const facingAggression = state.contextMetrics.facingAggression;
  const aggro = clamp(aggression[strategy] + (policy?.aggressionDelta ?? 0) * (facingAggression ? 0.25 : 1));
  const positionalAdjustment = state.contextMetrics.isInPositionPostflop && state.street !== "preflop" ? -0.02 : 0;
  const lowSprAdjustment = state.street !== "preflop" && state.spr > 0 && state.spr < 2 ? -0.05 : 0;
  const textureAdjustment = state.boardMetrics.wetness * 0.03;
  const valueThreshold = clamp(0.68 + (policy?.valueThresholdDelta ?? 0) + positionalAdjustment + lowSprAdjustment + textureAdjustment, 0.42, 0.9);
  const bluffChance = clamp(aggro * (0.28 + strength * 0.5) + (policy?.bluffDelta ?? 0) * (facingAggression ? 0.25 : 1));
  const allInRaise = legal.find((item) => item.type === "all-in" && (item.amount ?? 0) > state.contextMetrics.currentBet);
  const aggressive = legal.find((item) => item.type === "raise") ?? legal.find((item) => item.type === "bet") ?? allInRaise;
  const call = legal.find((item) => item.type === "call");
  const check = legal.find((item) => item.type === "check");
  const fold = legal.find((item) => item.type === "fold");
  let choice: LegalAction;

  if (aggressive && (strength > valueThreshold || randomValue() < bluffChance)) choice = aggressive;
  else if (check) choice = check;
  else {
    const baseCallThreshold = strategy === "calling-station" ? 0.28 : strategy === "nit" ? 0.64 : 0.42;
    const potOddsAdjustment = (state.potOdds - 0.25) * 0.45;
    const callThreshold = clamp(baseCallThreshold - (policy?.defendDelta ?? 0) + potOddsAdjustment, 0.18, 0.82);
    const speculativeCallChance = clamp(0.16 + (policy?.defendDelta ?? 0) * 0.7, 0.04, 0.34);
    if (call && (strength > callThreshold || randomValue() < speculativeCallChance)) choice = call;
    else choice = fold ?? call ?? legal[0];
  }

  const talks = language === "ru"
    ? ["Интересный размер.", "Посмотрим следующую карту.", "Непростое решение.", "Добавим немного интриги."]
    : ["Interesting sizing.", "Let's see another card.", "You're putting me in a spot.", "Let's make this interesting."];
  return {
    action: choice.type,
    amount: sizedAction(choice, state.pot, strength),
    reasoning_summary: language === "ru"
      ? `Локальный бот оценил относительную силу руки в ${Math.round(strength * 100)}%${policy ? ` и определил стиль игрока как «${policy.opponentType}»` : ""}.`
      : `Local bot estimated relative hand strength at ${Math.round(strength * 100)}%${policy ? ` and classified the player as ${policy.opponentType}` : ` and followed its ${strategy} profile`}.`,
    table_talk: tableTalk && randomValue() < 0.3 ? talks[Math.floor(randomValue() * talks.length)] : "",
  };
}
