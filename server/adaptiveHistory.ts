import type { EngineState } from "../poker-engine/game";
import type { ActionType, AdaptiveHandSummary, CompactHandAction, PlayerAction, PlayerId, RepeatedPlayerPattern, Street } from "../shared/types";

const playableActions = new Set<ActionType>(["fold", "check", "call", "bet", "raise", "all-in"]);
const isPlayableAction = (action: PlayerAction["action"]): action is ActionType => playableActions.has(action as ActionType);

function aggressive(action: CompactHandAction, priorTarget: number): boolean {
  return action.aggressive ?? (action.action === "bet" || action.action === "raise" || (action.action === "all-in" && (action.effectiveAmount ?? action.amount ?? 0) > priorTarget));
}

export function buildAdaptiveHandSummary(state: EngineState): AdaptiveHandSummary {
  if (!state.result) throw new Error("Cannot summarize an unfinished hand");
  const actions = state.actions
    .filter((action) => isPlayableAction(action.action))
    .map<CompactHandAction>((action) => ({
      player: action.player,
      street: action.street,
      action: action.action as ActionType,
      amount: action.amount,
      effectiveAmount: action.effectiveAmount,
      aggressive: action.aggressive,
    }));

  const targets: Partial<Record<Street, number>> = { preflop: state.config.bigBlind };
  let preflopLevel = 1;
  let preflopAggressor: PlayerId | undefined;
  let humanPreflopAggression = false;
  let humanFlopPressure = false;
  let humanFlopCBet = false;
  let humanTurnBarrel = false;
  const humanCheckedPostflop: Partial<Record<Street, boolean>> = {};
  const aiBetAfterHumanCheck: Partial<Record<Street, boolean>> = {};
  let humanCheckRaise = false;
  let foldedToThreeBet = false;
  let humanRiverAggression = false;
  const firstPostflopAggressor: Partial<Record<Street, PlayerId>> = {};

  for (const action of actions) {
    const priorTarget = targets[action.street] ?? 0;
    const isAggressive = aggressive(action, priorTarget);
    if (action.street === "preflop") {
      if (action.player === "human" && action.action === "fold" && preflopLevel === 3) foldedToThreeBet = true;
      if (isAggressive) {
        preflopLevel += 1;
        preflopAggressor = action.player;
        if (action.player === "human") humanPreflopAggression = true;
      }
    } else {
      const noPriorStreetAggression = !firstPostflopAggressor[action.street];
      if (action.player === "human" && action.action === "check") humanCheckedPostflop[action.street] = true;
      if (action.player === "ai" && isAggressive && humanCheckedPostflop[action.street]) aiBetAfterHumanCheck[action.street] = true;
      if (action.player === "human" && isAggressive && aiBetAfterHumanCheck[action.street]) humanCheckRaise = true;
      if (isAggressive && !firstPostflopAggressor[action.street]) firstPostflopAggressor[action.street] = action.player;
      if (action.player === "human" && action.street === "flop" && isAggressive) {
        humanFlopPressure = true;
        if (preflopAggressor === "human" && firstPostflopAggressor.flop === "human") humanFlopCBet = true;
      }
      if (action.player === "human" && action.street === "turn" && isAggressive && humanFlopCBet && noPriorStreetAggression) humanTurnBarrel = true;
      if (action.player === "human" && action.street === "river" && isAggressive) humanRiverAggression = true;
    }
    if (isAggressive) targets[action.street] = action.effectiveAmount ?? action.amount ?? priorTarget;
  }

  const playerLineTags: string[] = [];
  if (humanPreflopAggression) playerLineTags.push("preflop-aggression");
  if (humanFlopPressure) playerLineTags.push("flop-pressure");
  if (humanPreflopAggression && humanFlopPressure) playerLineTags.push("preflop-aggression+flop-pressure");
  if (foldedToThreeBet) playerLineTags.push("fold-to-3bet");
  if (humanFlopCBet) playerLineTags.push("flop-cbet");
  if (humanTurnBarrel) playerLineTags.push("turn-barrel");
  if (humanCheckRaise) playerLineTags.push("check-raise");
  if (humanRiverAggression) playerLineTags.push("river-aggression");

  return {
    handNumber: state.handNumber,
    button: state.button,
    pot: state.result.pot,
    winner: state.result.winners.length === 2 ? "split" : state.result.winners[0],
    reachedShowdown: Boolean(state.result.humanHand),
    actions,
    playerLineTags,
  };
}

export function findRepeatedPlayerPatterns(hands: AdaptiveHandSummary[], minimumOccurrences = 2): RepeatedPlayerPattern[] {
  const occurrences = new Map<string, number[]>();
  for (const hand of hands) {
    for (const pattern of new Set(hand.playerLineTags)) {
      const handNumbers = occurrences.get(pattern) ?? [];
      handNumbers.push(hand.handNumber);
      occurrences.set(pattern, handNumbers);
    }
  }
  return [...occurrences.entries()]
    .filter(([, handNumbers]) => handNumbers.length >= minimumOccurrences)
    .map(([pattern, handNumbers]) => ({ pattern, occurrences: handNumbers.length, handNumbers }))
    .sort((left, right) => right.occurrences - left.occurrences || left.pattern.localeCompare(right.pattern));
}
