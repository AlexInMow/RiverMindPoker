import type {
  AIDecision, AIVisibleGameState, Language, LegalAction, LocalBotCandidateAction,
  LocalBotDecisionTrace, Strategy,
} from "../../shared/types";
import { evaluateHand } from "../../poker-engine/evaluator";
import { classifyPreflopHand } from "./preflop";

const aggression: Record<Strategy, number> = {
  balanced: 0.45, tag: 0.5, lag: 0.68, nit: 0.2, "calling-station": 0.12,
  maniac: 0.86, tricky: 0.52, adaptive: 0.45,
};
const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const round = (value: number): number => Number(value.toFixed(4));

interface WeightedAction extends LocalBotCandidateAction { legal: LegalAction }
export interface LocalBotResult { decision: AIDecision; trace: LocalBotDecisionTrace }

export function estimateHandStrength(state: AIVisibleGameState): number {
  if (state.board.length < 3) return classifyPreflopHand(state.aiHoleCards).strength;
  const score = evaluateHand([...state.aiHoleCards, ...state.board]);
  return Math.min(1, score.category / 8 + (score.kickers[0] ?? 2) / 45);
}

function preflopRaiseTarget(state: AIVisibleGameState, action: LegalAction): number {
  const bb = state.blinds.big;
  const level = state.contextMetrics.preflopBetLevel;
  const preferred = level <= 1 ? 2.5 * bb
    : level === 2 ? state.contextMetrics.currentBet * (state.position.includes("BTN") ? 2.6 : 3)
      : level === 3 ? state.contextMetrics.currentBet * 2.25 : action.min!;
  return Math.round(Math.max(action.min!, Math.min(action.max!, preferred)));
}

function postflopSizedAction(action: LegalAction, pot: number, strength: number): number {
  if (action.type !== "bet" && action.type !== "raise") return action.amount ?? 0;
  const target = strength > 0.78 ? Math.round(pot * 0.8) : Math.round(pot * 0.55);
  return Math.max(action.min!, Math.min(action.max!, target));
}

function selectWeighted(actions: WeightedAction[], randomRoll: number): WeightedAction {
  const total = actions.reduce((sum, item) => sum + item.probability, 0);
  let cursor = randomRoll * total;
  for (const item of actions) {
    cursor -= item.probability;
    if (cursor <= 0) return item;
  }
  return actions.at(-1)!;
}

function styleThresholds(strategy: Strategy): { continueDelta: number; raiseDelta: number; jamDelta: number } {
  switch (strategy) {
    case "nit": return { continueDelta: 0.14, raiseDelta: 0.13, jamDelta: 0.08 };
    case "tag": return { continueDelta: 0.04, raiseDelta: 0.02, jamDelta: 0.02 };
    case "lag": return { continueDelta: -0.07, raiseDelta: -0.08, jamDelta: -0.03 };
    case "calling-station": return { continueDelta: -0.11, raiseDelta: 0.17, jamDelta: 0.06 };
    case "maniac": return { continueDelta: -0.11, raiseDelta: -0.15, jamDelta: -0.05 };
    case "tricky": return { continueDelta: -0.02, raiseDelta: -0.035, jamDelta: 0 };
    default: return { continueDelta: 0, raiseDelta: 0, jamDelta: 0 };
  }
}

function preflopReason(label: string, handClass: string, action: string, level: number, effectiveBB: number, stackOff: boolean): string {
  const facing = level >= 6 ? "6-bet+" : `${level}-bet`;
  if (action === "fold") return `Folded ${label} facing ${facing} at ${effectiveBB} BB; hand class ${handClass}, continuation threshold not met.`;
  if (stackOff) return `${action === "all-in" ? "Jammed" : "Committed"} ${label} for value facing ${facing} at ${effectiveBB} BB.`;
  return `${action} with ${label} (${handClass}) facing ${facing} at ${effectiveBB} BB.`;
}

function decidePreflop(state: AIVisibleGameState, strategy: Strategy, randomRoll: number) {
  const legal = state.legalActions;
  const profile = classifyPreflopHand(state.aiHoleCards);
  const level = Math.max(1, state.contextMetrics.preflopBetLevel);
  const effectiveBB = state.contextMetrics.effectiveStackBB;
  const bb = state.blinds.big;
  const policy = strategy === "adaptive" ? state.counterStrategy : undefined;
  const multiwayPlayers = Math.max(2, state.playersLeftInHand ?? 2);
  const multiwayTightening = (multiwayPlayers - 2) * 0.045;
  const adaptiveConfidence = policy?.confidence ?? 0;
  const adaptiveCap = Math.min(0.06, adaptiveConfidence * 0.06);
  const adaptiveDefend = policy ? clamp(policy.frequencyAdjustments.defend, 0, adaptiveCap) : 0;
  const adaptiveRaise = policy ? clamp(policy.frequencyAdjustments.raise, -adaptiveCap, adaptiveCap) : 0;
  const style = styleThresholds(strategy);
  const callFraction = state.amountToCall / Math.max(1, effectiveBB * bb);
  const pressurePenalty = Math.max(0, callFraction - 0.04) * 1.1;
  const continueByLevel = [0.12, 0.12, 0.28, 0.5, 0.68, 0.82, 0.9];
  const raiseByLevel = [0.23, 0.23, 0.48, 0.69, 0.83, 0.92, 0.96];
  const index = Math.min(6, level);
  const continueThreshold = clamp(continueByLevel[index] + style.continueDelta + pressurePenalty + multiwayTightening - adaptiveDefend, 0.05, 0.98);
  const raiseThreshold = clamp(raiseByLevel[index] + style.raiseDelta + pressurePenalty * 0.7 + multiwayTightening * 1.25 - adaptiveRaise, 0.08, 0.99);
  const jamThreshold = clamp((effectiveBB >= 80 ? 0.78 : effectiveBB >= 40 ? 0.7 : 0.6) + style.jamDelta - adaptiveRaise * 0.25, 0.55, 0.92);
  const call = legal.find((item) => item.type === "call");
  const check = legal.find((item) => item.type === "check");
  const fold = legal.find((item) => item.type === "fold");
  const raise = legal.find((item) => item.type === "raise") ?? legal.find((item) => item.type === "bet");
  const aggressiveAllIn = legal.find((item) => item.type === "all-in" && (item.amount ?? 0) > state.contextMetrics.currentBet);
  const raiseAmount = raise ? preflopRaiseTarget(state, raise) : null;
  const raisePaid = raiseAmount === null ? 0 : Math.max(0, raiseAmount - state.contextMetrics.aiStreetBet);
  const raiseCommittedFraction = raiseAmount === null ? 0
    : (state.contextMetrics.aiCommittedBB * bb + raisePaid) / Math.max(1, effectiveBB * bb);
  const raiseIsStackOff = raiseCommittedFraction >= 0.55;
  const fundamentalsAllowStackOff = effectiveBB < 40 ? profile.strength >= 0.6
    : profile.handClass === "premium" || profile.handClass === "strong" && profile.strength >= jamThreshold;
  const stackOffAllowed = fundamentalsAllowStackOff && profile.strength >= jamThreshold;
  const adjustedAggression = clamp(aggression[strategy] + adaptiveRaise);

  const continuationFloor = level >= 4 ? 0.001 : 0.01;
  let continueProbability = !state.contextMetrics.facingAggression ? 0.995
    : clamp(0.34 + (profile.strength - continueThreshold) * 2.1 + (adjustedAggression - 0.45) * 0.18, continuationFloor, 0.995);
  if (policy) {
    const confirmedDefenseShift = adaptiveDefend * 1.5 + Math.max(0, -policy.frequencyAdjustments.fold) * 0.35;
    continueProbability = clamp(continueProbability + confirmedDefenseShift, continuationFloor, 0.995);
  }
  if (profile.handClass === "premium") continueProbability = 1;

  let raiseProbability = clamp(0.04 + (profile.strength - raiseThreshold) * 1.7 + (adjustedAggression - 0.45) * 0.24, 0, 0.82);
  if (level <= 2 && profile.strength < raiseThreshold) {
    const bluff = { nit: 0.005, tag: 0.02, balanced: 0.035, lag: 0.075, maniac: 0.14, tricky: 0.055, "calling-station": 0.005, adaptive: 0.035 }[strategy];
    raiseProbability = Math.max(raiseProbability, bluff + adaptiveRaise * 0.4);
  }
  if (profile.handClass === "premium" && level <= 3 && raise) raiseProbability = continueProbability;
  if (level >= 4 && profile.strength < raiseThreshold) raiseProbability *= level >= 5 ? 0.04 : 0.12;
  if (raiseIsStackOff && !stackOffAllowed) raiseProbability = 0;
  raiseProbability = Math.min(raiseProbability, continueProbability);

  let jamProbability = 0;
  if (aggressiveAllIn && stackOffAllowed && (level >= 4 || !raise)) {
    jamProbability = clamp((profile.strength - 0.71) * 3.15 - style.jamDelta, 0.01, 0.94);
    if (effectiveBB >= 80 && profile.handClass === "strong") jamProbability *= 0.72;
    if (!raise && profile.handClass === "premium") jamProbability = 1;
    jamProbability = Math.min(jamProbability, continueProbability);
  }
  if (raiseIsStackOff && stackOffAllowed) raiseProbability = clamp((profile.strength - 0.71) * 2.7 - style.jamDelta, 0.01, 0.9);
  if (raiseProbability + jamProbability > continueProbability) {
    const scale = continueProbability / (raiseProbability + jamProbability);
    raiseProbability *= scale;
    jamProbability *= scale;
  }

  const candidates: WeightedAction[] = [];
  const passive = call ?? check;
  const passiveProbability = Math.max(0, continueProbability - raiseProbability - jamProbability);
  if (fold) candidates.push({ legal: fold, action: "fold", amount: 0, probability: 1 - continueProbability });
  if (passive) candidates.push({ legal: passive, action: passive.type, amount: passive.amount ?? 0, probability: passiveProbability });
  if (raise && raiseProbability > 0) candidates.push({ legal: raise, action: raise.type, amount: raiseAmount!, probability: raiseProbability });
  if (aggressiveAllIn && jamProbability > 0) candidates.push({ legal: aggressiveAllIn, action: "all-in", amount: aggressiveAllIn.amount ?? 0, probability: jamProbability });
  if (!candidates.length) {
    const fallback = legal[0];
    candidates.push({ legal: fallback, action: fallback.type, amount: fallback.amount ?? fallback.min ?? 0, probability: 1 });
  }
  const choice = selectWeighted(candidates, randomRoll);
  const chosenStackOff = choice.action === "all-in" || choice.action === "raise" && raiseIsStackOff;
  const resultingPot = ["raise", "bet", "all-in"].includes(choice.action)
    ? state.pot + Math.max(0, choice.amount - state.contextMetrics.aiStreetBet) : null;
  const trace: LocalBotDecisionTrace = {
    handClass: profile.handClass, handLabel: profile.label, rawPreflopStrength: profile.strength,
    preflopBetLevel: level, effectiveStackBB: effectiveBB, amountToCallBB: state.contextMetrics.amountToCallBB,
    potOdds: state.potOdds, committedBB: state.contextMetrics.aiCommittedBB,
    committedFraction: state.contextMetrics.committedFractionOfEffectiveStack,
    raiseTargetBB: ["raise", "bet", "all-in"].includes(choice.action) ? round(choice.amount / bb) : null,
    raiseIncrementBB: ["raise", "bet", "all-in"].includes(choice.action) ? round((choice.amount - state.contextMetrics.currentBet) / bb) : null,
    resultingPotBB: resultingPot === null ? null : round(resultingPot / bb),
    remainingStackAfterCall: state.contextMetrics.remainingStackAfterCall,
    remainingStackAfterRaise: ["raise", "bet", "all-in"].includes(choice.action)
      ? Math.max(0, state.aiStack - Math.max(0, choice.amount - state.contextMetrics.aiStreetBet)) : null,
    strategy, adaptiveConfidence, baseAggression: aggression[strategy], adjustedAggression,
    continueThreshold: round(continueThreshold), raiseThreshold: round(raiseThreshold), jamThreshold: round(jamThreshold),
    randomRoll: round(randomRoll),
    candidateActions: candidates.map(({ action, probability, amount }) => ({ action, probability: round(probability), amount })),
    chosenAction: choice.action, stackOffAllowed,
    reasonSummary: preflopReason(profile.label, profile.handClass, choice.action, level, effectiveBB, chosenStackOff),
  };
  return { choice, trace, strength: profile.strength };
}

function decidePostflop(state: AIVisibleGameState, strategy: Strategy, randomRoll: number, randomValue: () => number) {
  const legal = state.legalActions;
  const strength = estimateHandStrength(state);
  const policy = strategy === "adaptive" ? state.counterStrategy : undefined;
  const adjustments = policy?.frequencyAdjustments;
  const multiwayExtra = Math.max(0, (state.playersLeftInHand ?? 2) - 2);
  const aggro = clamp(aggression[strategy] + (adjustments?.raise ?? 0) * (state.contextMetrics.facingAggression ? 0.7 : 1));
  const positionalAdjustment = state.contextMetrics.isInPositionPostflop ? -0.02 : 0;
  const lowSprAdjustment = state.spr > 0 && state.spr < 2 ? -0.05 : 0;
  const valueThreshold = clamp(0.68 + multiwayExtra * 0.06 - (adjustments?.value ?? 0) * 1.4 + positionalAdjustment + lowSprAdjustment + state.boardMetrics.wetness * 0.03, 0.42, 0.94);
  const bluffChance = clamp((aggro * (0.28 + strength * 0.5) + (adjustments?.bluff ?? 0) * (state.contextMetrics.facingAggression ? 0.3 : 1)) * Math.max(.45, 1 - multiwayExtra * .22));
  const allInRaise = legal.find((item) => item.type === "all-in" && (item.amount ?? 0) > state.contextMetrics.currentBet);
  const aggressive = legal.find((item) => item.type === "raise") ?? legal.find((item) => item.type === "bet") ?? allInRaise;
  const call = legal.find((item) => item.type === "call");
  const check = legal.find((item) => item.type === "check");
  const fold = legal.find((item) => item.type === "fold");
  let legalChoice: LegalAction;
  if (aggressive && (strength > valueThreshold || randomRoll < bluffChance)) legalChoice = aggressive;
  else if (check) legalChoice = check;
  else {
    const baseCallThreshold = strategy === "calling-station" ? 0.28 : strategy === "nit" ? 0.64 : 0.42;
    const callThreshold = clamp(baseCallThreshold + multiwayExtra * .04 - (adjustments?.defend ?? 0) + (state.potOdds - 0.25) * 0.45, 0.18, 0.86);
    const speculativeCallChance = clamp(0.16 + (adjustments?.call ?? 0) + Math.max(0, -(adjustments?.fold ?? 0)) * 0.35, 0.04, 0.42);
    legalChoice = call && (strength > callThreshold || randomValue() < speculativeCallChance) ? call : fold ?? call ?? legal[0];
  }
  const amount = postflopSizedAction(legalChoice, state.pot, strength);
  const choice: WeightedAction = { legal: legalChoice, action: legalChoice.type, amount, probability: 1 };
  const raised = aggressive && legalChoice === aggressive;
  const trace: LocalBotDecisionTrace = {
    preflopBetLevel: state.contextMetrics.preflopBetLevel, effectiveStackBB: state.contextMetrics.effectiveStackBB,
    amountToCallBB: state.contextMetrics.amountToCallBB, potOdds: state.potOdds,
    committedBB: state.contextMetrics.aiCommittedBB, committedFraction: state.contextMetrics.committedFractionOfEffectiveStack,
    raiseTargetBB: raised ? round(amount / state.blinds.big) : null,
    raiseIncrementBB: raised ? round((amount - state.contextMetrics.currentBet) / state.blinds.big) : null,
    resultingPotBB: raised ? round((state.pot + amount - state.contextMetrics.aiStreetBet) / state.blinds.big) : null,
    remainingStackAfterCall: state.contextMetrics.remainingStackAfterCall,
    remainingStackAfterRaise: raised ? Math.max(0, state.aiStack - amount + state.contextMetrics.aiStreetBet) : null,
    strategy, adaptiveConfidence: policy?.confidence ?? 0, baseAggression: aggression[strategy], adjustedAggression: aggro,
    continueThreshold: 0, raiseThreshold: valueThreshold, jamThreshold: 1, randomRoll: round(randomRoll),
    candidateActions: [{ action: choice.action, amount, probability: 1 }], chosenAction: choice.action,
    stackOffAllowed: false,
    reasonSummary: `Postflop ${choice.action}; strength ${strength.toFixed(3)}, board wetness ${state.boardMetrics.wetness.toFixed(3)}.`,
  };
  return { choice, trace, strength };
}

export function dummyDecisionWithTrace(
  state: AIVisibleGameState, strategy: Strategy, tableTalk: boolean,
  language: Language = "en", randomValue: () => number = Math.random,
): LocalBotResult {
  const randomRoll = randomValue();
  const result = state.street === "preflop" ? decidePreflop(state, strategy, randomRoll) : decidePostflop(state, strategy, randomRoll, randomValue);
  const talks = language === "ru"
    ? ["Интересный размер.", "Посмотрим следующую карту.", "Непростое решение.", "Добавим немного интриги."]
    : ["Interesting sizing.", "Let's see another card.", "You're putting me in a spot.", "Let's make this interesting."];
  return {
    decision: {
      action: result.choice.action, amount: result.choice.amount, reasoning_summary: result.trace.reasonSummary,
      table_talk: tableTalk && randomValue() < 0.3 ? talks[Math.floor(randomValue() * talks.length)] : "",
    },
    trace: result.trace,
  };
}

export function dummyDecision(
  state: AIVisibleGameState, strategy: Strategy, tableTalk: boolean,
  language: Language = "en", randomValue: () => number = Math.random,
): AIDecision {
  return dummyDecisionWithTrace(state, strategy, tableTalk, language, randomValue).decision;
}
