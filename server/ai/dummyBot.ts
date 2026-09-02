import type { AIDecision, AIVisibleGameState, Language, LegalAction, Strategy } from "../../shared/types";
import { rankValue } from "../../poker-engine/cards";
import { evaluateHand } from "../../poker-engine/evaluator";

const aggression: Record<Strategy, number> = {
  balanced: 0.45, tag: 0.5, lag: 0.68, nit: 0.2, "calling-station": 0.12, maniac: 0.86, tricky: 0.52, adaptive: 0.48,
};

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));

export function estimateHandStrength(state: AIVisibleGameState): number {
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
  const strength = estimateHandStrength(state);
  const policy = strategy === "adaptive" ? state.counterStrategy : undefined;
  const adjustments = policy?.frequencyAdjustments;
  const facingAggression = state.contextMetrics.facingAggression;
  const aggro = clamp(aggression[strategy] + (adjustments?.raise ?? 0) * (facingAggression ? 0.7 : 1));
  const positionalAdjustment = state.contextMetrics.isInPositionPostflop && state.street !== "preflop" ? -0.02 : 0;
  const lowSprAdjustment = state.street !== "preflop" && state.spr > 0 && state.spr < 2 ? -0.05 : 0;
  const textureAdjustment = state.boardMetrics.wetness * 0.03;
  const valueThreshold = clamp(0.68 - (adjustments?.value ?? 0) * 1.4 + positionalAdjustment + lowSprAdjustment + textureAdjustment, 0.42, 0.9);
  const bluffChance = clamp(aggro * (0.28 + strength * 0.5) + (adjustments?.bluff ?? 0) * (facingAggression ? 0.3 : 1));
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
    const callThreshold = clamp(baseCallThreshold - (adjustments?.defend ?? 0) + potOddsAdjustment, 0.18, 0.82);
    const speculativeCallChance = clamp(0.16 + (adjustments?.call ?? 0) + Math.max(0, -(adjustments?.fold ?? 0)) * 0.35, 0.04, 0.42);
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
