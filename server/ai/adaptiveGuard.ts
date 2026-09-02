import type { AIDecision, AIVisibleGameState, LegalAction, Strategy } from "../../shared/types";
import { estimateHandStrength } from "./dummyBot";

function decisionFrom(action: LegalAction, original: AIDecision): AIDecision {
  return { ...original, action: action.type, amount: action.min ?? action.amount ?? 0 };
}

export function calibrateAdaptiveDecision(
  decision: AIDecision,
  state: AIVisibleGameState,
  strategy: Strategy,
): { decision: AIDecision; adjustment?: string } {
  if (strategy !== "adaptive" || decision.action !== "fold" || state.amountToCall <= 0) return { decision };

  const strength = estimateHandStrength(state);
  const policy = state.counterStrategy;
  const aggressive = state.legalActions.find((action) => action.type === "raise")
    ?? state.legalActions.find((action) => action.type === "all-in" && (action.amount ?? 0) > state.contextMetrics.currentBet);
  const call = state.legalActions.find((action) => action.type === "call");
  const premium = strength >= (state.street === "preflop" ? 0.78 : 0.72);

  if (premium && (aggressive || call)) {
    return {
      decision: decisionFrom(aggressive ?? call!, decision),
      adjustment: `adaptive over-fold guard: premium strength ${strength.toFixed(3)} cannot fold to available legal defense`,
    };
  }

  const confirmedPressure = policy.opponentType === "aggressive" && policy.confidence >= 0.25;
  const callFractionOfStack = state.amountToCall / Math.max(1, state.effectiveStack + state.amountToCall);
  const positionBonus = state.contextMetrics.isInPositionPostflop ? 0.02 : 0;
  const adjustedStrength = strength
    + policy.frequencyAdjustments.defend * 0.55
    + positionBonus
    - callFractionOfStack * 0.12;
  const requiredStrength = state.potOdds + 0.04;

  if (confirmedPressure && strength >= 0.34 && adjustedStrength >= requiredStrength && call) {
    return {
      decision: decisionFrom(call, decision),
      adjustment: `adaptive over-fold guard: confirmed pressure and adjusted defense ${adjustedStrength.toFixed(3)} >= ${requiredStrength.toFixed(3)}`,
    };
  }
  return { decision };
}
