import type { AIDecision, AIVisibleGameState, Language, LegalAction, Strategy } from "../../shared/types";
import { rankValue } from "../../poker-engine/cards";
import { evaluateHand } from "../../poker-engine/evaluator";

const aggression: Record<Strategy, number> = {
  balanced: 0.45, tag: 0.5, lag: 0.68, nit: 0.2, "calling-station": 0.12, maniac: 0.86, tricky: 0.52, adaptive: 0.48,
};

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

export function dummyDecision(state: AIVisibleGameState, strategy: Strategy, tableTalk: boolean, language: Language = "en"): AIDecision {
  const legal = state.legalActions;
  const strength = handStrength(state);
  const aggro = aggression[strategy];
  const random = Math.random();
  const aggressive = legal.find((item) => item.type === "raise") ?? legal.find((item) => item.type === "bet");
  const call = legal.find((item) => item.type === "call");
  const check = legal.find((item) => item.type === "check");
  const fold = legal.find((item) => item.type === "fold");
  let choice: LegalAction;

  if (aggressive && (strength > 0.68 || random < aggro * (0.28 + strength * 0.5))) choice = aggressive;
  else if (check) choice = check;
  else if (call && (strength > (strategy === "calling-station" ? 0.28 : strategy === "nit" ? 0.64 : 0.42) || random < 0.16)) choice = call;
  else choice = fold ?? call ?? legal[0];

  const talks = language === "ru"
    ? ["Интересный размер.", "Посмотрим следующую карту.", "Непростое решение.", "Добавим немного интриги."]
    : ["Interesting sizing.", "Let's see another card.", "You're putting me in a spot.", "Let's make this interesting."];
  return {
    action: choice.type,
    amount: sizedAction(choice, state.pot, strength),
    reasoning_summary: language === "ru"
      ? `Локальный бот оценил относительную силу руки в ${Math.round(strength * 100)}% и следовал выбранному стилю.`
      : `Local bot estimated relative hand strength at ${Math.round(strength * 100)}% and followed its ${strategy} profile.`,
    table_talk: tableTalk && Math.random() < 0.3 ? talks[Math.floor(Math.random() * talks.length)] : "",
  };
}
