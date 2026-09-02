import { rankValue } from "../../poker-engine/cards";
import type { EngineState } from "../../poker-engine/game";
import type { AIContextMetrics, BoardMetrics, CompactHandAction, PlayerAction, Street } from "../../shared/types";

const playable = new Set(["fold", "check", "call", "bet", "raise", "all-in"]);
const round = (value: number): number => Number(value.toFixed(4));

function connectedness(ranks: number[]): number {
  const unique = [...new Set(ranks)];
  if (unique.includes(14)) unique.push(1);
  unique.sort((a, b) => a - b);
  let best = 0;
  for (let start = 0; start < unique.length; start += 1) {
    let count = 0;
    for (let end = start; end < unique.length && unique[end] - unique[start] <= 4; end += 1) count += 1;
    best = Math.max(best, count);
  }
  return best;
}

export function deriveBoardMetrics(state: EngineState): BoardMetrics {
  const ranks = state.board.map(rankValue);
  const rankCounts = new Map<number, number>();
  const suitCounts = new Map<string, number>();
  for (const card of state.board) {
    const rank = rankValue(card);
    rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
    suitCounts.set(card[1], (suitCounts.get(card[1]) ?? 0) + 1);
  }
  const maxRankCount = Math.max(0, ...rankCounts.values());
  const maxSuitCount = Math.max(0, ...suitCounts.values());
  const boardConnectedness = connectedness(ranks);
  const paired = maxRankCount >= 2;
  const monotone = state.board.length >= 3 && maxSuitCount === state.board.length;
  const twoTone = state.board.length >= 3 && maxSuitCount === state.board.length - 1;
  const wetness = state.board.length < 3 ? 0 : Math.min(1, round(
    (maxSuitCount >= 3 ? 0.35 : maxSuitCount === 2 ? 0.18 : 0)
    + (boardConnectedness >= 4 ? 0.4 : boardConnectedness === 3 ? 0.25 : 0)
    + (paired ? 0.12 : 0)
    + (ranks.filter((rank) => rank >= 10).length >= 2 ? 0.13 : 0),
  ));
  return {
    cards: state.board.length,
    highCard: ranks.length ? Math.max(...ranks) : null,
    uniqueRanks: rankCounts.size,
    paired,
    trips: maxRankCount >= 3,
    maxSuitCount,
    monotone,
    twoTone,
    broadwayCards: ranks.filter((rank) => rank >= 10).length,
    connectedness: boardConnectedness,
    wetness,
  };
}

function preflopBetLevel(actions: PlayerAction[]): number {
  let level = 1;
  let target = 0;
  for (const action of actions.filter((item) => item.street === "preflop")) {
    if (action.action === "big-blind") target = Math.max(target, action.amount ?? 0);
    if (action.action === "raise" || action.action === "bet" || (action.action === "all-in" && (action.amount ?? 0) > target)) {
      level += 1;
      target = Math.max(target, action.amount ?? target);
    }
  }
  return level;
}

function compactLastAction(actions: PlayerAction[]): CompactHandAction | undefined {
  const action = [...actions].reverse().find((item) => playable.has(item.action));
  if (!action) return undefined;
  return { player: action.player, street: action.street as Street, action: action.action as CompactHandAction["action"], amount: action.amount };
}

export function deriveAIContext(state: EngineState): {
  amountToCall: number;
  potOdds: number;
  effectiveStack: number;
  spr: number;
  boardMetrics: BoardMetrics;
  contextMetrics: AIContextMetrics;
} {
  const amountToCall = Math.min(state.players.ai.stack, Math.max(0, state.currentBet - state.players.ai.streetBet));
  const effectiveStack = Math.min(state.players.ai.stack, state.players.human.stack);
  return {
    amountToCall,
    potOdds: amountToCall ? round(amountToCall / (state.pot + amountToCall)) : 0,
    effectiveStack,
    spr: state.pot ? round(effectiveStack / state.pot) : 0,
    boardMetrics: deriveBoardMetrics(state),
    contextMetrics: {
      isInPositionPostflop: state.button === "ai",
      facingAggression: amountToCall > 0,
      preflopBetLevel: preflopBetLevel(state.actions),
      currentBet: state.currentBet,
      aiStreetBet: state.players.ai.streetBet,
      playerStreetBet: state.players.human.streetBet,
      lastAction: compactLastAction(state.actions),
    },
  };
}
