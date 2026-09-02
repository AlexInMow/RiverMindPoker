import type {
  ActionType,
  Card,
  EvaluatedHandSummary,
  GameConfig,
  HandResult,
  LegalAction,
  PlayerAction,
  PlayerId,
  PlayerPublicState,
  Street,
} from "../shared/types";
import { randomUUID } from "node:crypto";
import { cardLabel, createDeck, shuffleDeck, type RandomIndex } from "./cards";
import { compareScores, evaluateHand, getShowdownDetail } from "./evaluator";

interface EnginePlayer extends Omit<PlayerPublicState, "cards"> {
  cards: Card[];
}

export interface EngineState {
  config: GameConfig;
  handId: string;
  handNumber: number;
  button: PlayerId;
  street: Street;
  deck: Card[];
  burnCards: Card[];
  cardsDrawn: number;
  validatedCardsDrawn: number;
  shuffleCount: number;
  shuffledHandId: string;
  initialHoleCards: Record<PlayerId, Card[]>;
  board: Card[];
  pot: number;
  currentBet: number;
  minRaise: number;
  actor: PlayerId | null;
  /** Set only after the current hand has been fully settled and a final stack is zero. */
  matchOver: boolean;
  players: Record<PlayerId, EnginePlayer>;
  actions: PlayerAction[];
  handLog: string[];
  acted: PlayerId[];
  result?: HandResult;
  /** Fixed chip pool for the session; no rebuy mechanics exist. */
  expectedTotalChips: number;
}

export interface EngineAction {
  type: ActionType;
  amount?: number;
}

const other = (id: PlayerId): PlayerId => id === "human" ? "ai" : "human";
const playerName = (id: PlayerId): string => id === "human" ? "You" : "AI";
const streetName = (street: Street): string => street[0].toUpperCase() + street.slice(1);

function putChips(state: EngineState, id: PlayerId, amount: number): number {
  if (!Number.isInteger(amount) || amount < 0) throw new Error("Chip amounts must be non-negative whole numbers");
  const player = state.players[id];
  const paid = Math.max(0, Math.min(player.stack, amount));
  player.stack -= paid;
  player.streetBet += paid;
  player.totalContribution += paid;
  state.pot += paid;
  player.allIn = player.stack === 0;
  return paid;
}

function assertWholeNonNegative(value: number, label: string, context: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Accounting invariant failed after ${context}: ${label} must be a non-negative whole number (received ${value})`);
  }
}

/** Exported for focused tests and debug tooling. The engine calls it after every public mutation. */
export function assertChipAccounting(state: EngineState, context = "state update"): void {
  assertWholeNonNegative(state.expectedTotalChips, "expectedTotalChips", context);
  assertWholeNonNegative(state.pot, "pot", context);
  assertWholeNonNegative(state.currentBet, "currentBet", context);
  for (const id of ["human", "ai"] as PlayerId[]) {
    const player = state.players[id];
    assertWholeNonNegative(player.stack, `${id}.stack`, context);
    assertWholeNonNegative(player.streetBet, `${id}.streetBet`, context);
    assertWholeNonNegative(player.totalContribution, `${id}.totalContribution`, context);
    if (player.streetBet > player.totalContribution) {
      throw new Error(`Accounting invariant failed after ${context}: ${id}.streetBet exceeds totalContribution`);
    }
    if (player.allIn !== (player.stack === 0)) {
      throw new Error(`Accounting invariant failed after ${context}: ${id}.allIn does not match its stack`);
    }
  }

  const stacks = state.players.human.stack + state.players.ai.stack;
  if (state.street === "complete") {
    if (!state.result) throw new Error(`Accounting invariant failed after ${context}: completed hand has no result`);
    if (state.pot !== 0) throw new Error(`Accounting invariant failed after ${context}: completed hand still has a live pot`);
    if (stacks !== state.expectedTotalChips) {
      throw new Error(`Accounting invariant failed after ${context}: completed stacks ${stacks} != ${state.expectedTotalChips}`);
    }
    const paid = state.result.payouts.human + state.result.payouts.ai;
    if (paid !== state.result.pot) {
      throw new Error(`Accounting invariant failed after ${context}: payouts ${paid} != result pot ${state.result.pot}`);
    }
    const expectedMatchOver = state.players.human.stack === 0 || state.players.ai.stack === 0;
    if (state.matchOver !== expectedMatchOver) {
      throw new Error(`Accounting invariant failed after ${context}: matchOver was evaluated before or inconsistently with final stacks`);
    }
    return;
  }

  if (state.matchOver) {
    throw new Error(`Accounting invariant failed after ${context}: active hand cannot be matchOver`);
  }

  const contributions = state.players.human.totalContribution + state.players.ai.totalContribution;
  const highestStreetBet = Math.max(state.players.human.streetBet, state.players.ai.streetBet);
  if (state.currentBet !== highestStreetBet) {
    throw new Error(`Accounting invariant failed after ${context}: currentBet ${state.currentBet} != highest street bet ${highestStreetBet}`);
  }
  if (contributions !== state.pot) {
    throw new Error(`Accounting invariant failed after ${context}: contributions ${contributions} != pot ${state.pot}`);
  }
  if (stacks + state.pot !== state.expectedTotalChips) {
    throw new Error(`Accounting invariant failed after ${context}: stacks + pot ${stacks + state.pot} != ${state.expectedTotalChips}`);
  }
}

/** Verifies the complete 52-card partition and immutable per-hand dealing metadata. */
export function assertCardIntegrity(state: EngineState, context = "state update"): void {
  const standardDeck = createDeck();
  if (standardDeck.length !== 52 || new Set(standardDeck).size !== 52) {
    throw new Error(`Card invariant failed after ${context}: canonical deck is not 52 unique cards`);
  }
  if (state.shuffleCount !== 1 || state.shuffledHandId !== state.handId) {
    throw new Error(`Card invariant failed after ${context}: hand ${state.handId} must be shuffled exactly once`);
  }
  const zones = [
    ...state.deck,
    ...state.players.human.cards,
    ...state.players.ai.cards,
    ...state.board,
    ...state.burnCards,
  ];
  if (zones.length !== 52 || new Set(zones).size !== 52) {
    throw new Error(`Card invariant failed after ${context}: deck, holes, board and burns must partition 52 unique cards`);
  }
  const validCards = new Set(standardDeck);
  if (zones.some((card) => !validCards.has(card))) {
    throw new Error(`Card invariant failed after ${context}: unknown card found`);
  }
  const dealtCount = state.players.human.cards.length + state.players.ai.cards.length + state.board.length + state.burnCards.length;
  if (state.cardsDrawn !== dealtCount || state.deck.length + state.cardsDrawn !== 52) {
    throw new Error(`Card invariant failed after ${context}: deck pointer moved inconsistently`);
  }
  if (state.cardsDrawn < state.validatedCardsDrawn) {
    throw new Error(`Card invariant failed after ${context}: deck pointer moved backward`);
  }
  state.validatedCardsDrawn = state.cardsDrawn;
  for (const id of ["human", "ai"] as PlayerId[]) {
    const initial = state.initialHoleCards[id];
    if (initial.length !== 2 || state.players[id].cards.length !== 2 || initial.some((card, index) => card !== state.players[id].cards[index])) {
      throw new Error(`Card invariant failed after ${context}: ${id} hole cards changed within hand ${state.handId}`);
    }
  }
}

function assertEngineState(state: EngineState, context: string): void {
  assertChipAccounting(state, context);
  assertCardIntegrity(state, context);
}

function record(
  state: EngineState,
  player: PlayerId,
  action: PlayerAction["action"],
  amount?: number,
  semantics?: Pick<PlayerAction, "effectiveAmount" | "aggressive">,
): void {
  state.actions.push({ player, street: state.street, action, amount, ...semantics, at: Date.now() });
}

function postBlind(state: EngineState, id: PlayerId, amount: number, kind: "small-blind" | "big-blind"): void {
  const paid = putChips(state, id, amount);
  record(state, id, kind, paid);
  state.handLog.push(`${playerName(id)} posts ${kind === "small-blind" ? "small blind" : "big blind"} ${paid}`);
}

function drawCard(state: EngineState): Card {
  const card = state.deck.pop();
  if (!card) throw new Error("Deck exhausted");
  state.cardsDrawn += 1;
  return card;
}

function burnCard(state: EngineState): void {
  state.burnCards.push(drawCard(state));
}

function dealHoleCards(state: EngineState): void {
  const first = state.button;
  const second = other(first);
  for (let round = 0; round < 2; round += 1) {
    state.players[first].cards.push(drawCard(state));
    state.players[second].cards.push(drawCard(state));
  }
}

export function createGame(config: GameConfig, randomIndex?: RandomIndex): EngineState {
  if (![config.startingStack, config.smallBlind, config.bigBlind].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error("Stacks and blinds must be positive whole numbers");
  }
  if (config.smallBlind >= config.bigBlind) throw new Error("Small blind must be below big blind");
  const state: EngineState = {
    config,
    handId: "",
    handNumber: 1,
    button: "human",
    street: "preflop",
    deck: [],
    burnCards: [],
    cardsDrawn: 0,
    validatedCardsDrawn: 0,
    shuffleCount: 0,
    shuffledHandId: "",
    initialHoleCards: { human: [], ai: [] },
    board: [],
    pot: 0,
    currentBet: 0,
    minRaise: config.bigBlind,
    actor: null,
    matchOver: false,
    players: {
      human: { id: "human", stack: config.startingStack, streetBet: 0, totalContribution: 0, folded: false, allIn: false, cards: [] },
      ai: { id: "ai", stack: config.startingStack, streetBet: 0, totalContribution: 0, folded: false, allIn: false, cards: [] },
    },
    actions: [],
    handLog: [],
    acted: [],
    expectedTotalChips: config.startingStack * 2,
  };
  return startHand(state, randomIndex, false);
}

function startHand(state: EngineState, randomIndex: RandomIndex | undefined, rotate: boolean): EngineState {
  if (rotate) {
    state.handNumber += 1;
    state.button = other(state.button);
  }
  state.handId = randomUUID();
  state.street = "preflop";
  state.shuffleCount = 0;
  state.shuffledHandId = "";
  state.deck = shuffleDeck(createDeck(), randomIndex);
  state.shuffleCount += 1;
  state.shuffledHandId = state.handId;
  state.burnCards = [];
  state.cardsDrawn = 0;
  state.validatedCardsDrawn = 0;
  state.initialHoleCards = { human: [], ai: [] };
  state.board = [];
  state.pot = 0;
  state.currentBet = 0;
  state.minRaise = state.config.bigBlind;
  state.actor = state.button;
  state.matchOver = false;
  state.actions = [];
  state.acted = [];
  state.result = undefined;
  state.handLog = [`Hand #${state.handNumber}`, `${playerName(state.button)} ${state.button === "human" ? "are" : "is"} Button / SB`];
  for (const id of ["human", "ai"] as PlayerId[]) {
    Object.assign(state.players[id], { streetBet: 0, totalContribution: 0, folded: false, allIn: false, cards: [] });
  }
  dealHoleCards(state);
  state.initialHoleCards = {
    human: [...state.players.human.cards],
    ai: [...state.players.ai.cards],
  };
  postBlind(state, state.button, state.config.smallBlind, "small-blind");
  postBlind(state, other(state.button), state.config.bigBlind, "big-blind");
  state.currentBet = Math.max(state.players.human.streetBet, state.players.ai.streetBet);

  if (state.players[state.actor].allIn) {
    state.actor = other(state.actor);
    if (state.players[state.actor].allIn) runToShowdown(state);
  }
  assertEngineState(state, "start hand");
  return state;
}

export function startNextHand(state: EngineState, randomIndex?: RandomIndex): EngineState {
  if (state.street !== "complete") throw new Error("Current hand is not complete");
  if (state.matchOver || state.players.human.stack <= 0 || state.players.ai.stack <= 0) throw new Error("A player has no chips; start a new session");
  return startHand(state, randomIndex, true);
}

export function getLegalActions(state: EngineState, id: PlayerId): LegalAction[] {
  if (state.actor !== id || state.street === "complete" || state.street === "showdown") return [];
  const player = state.players[id];
  const opponent = state.players[other(id)];
  if (player.folded || player.allIn) return [];
  const toCall = Math.max(0, state.currentBet - player.streetBet);
  const ownMax = player.streetBet + player.stack;
  const effectiveMax = Math.min(ownMax, opponent.streetBet + opponent.stack);
  const actions: LegalAction[] = [];

  if (toCall > 0) {
    actions.push({ type: "fold", label: "FOLD" });
    actions.push({ type: "call", amount: Math.min(toCall, player.stack), label: `CALL ${Math.min(toCall, player.stack)}` });
  } else {
    actions.push({ type: "check", label: "CHECK" });
  }

  if (state.currentBet === 0 && effectiveMax > 0) {
    const min = Math.min(state.config.bigBlind, effectiveMax);
    actions.push({ type: "bet", min, max: effectiveMax, label: `BET TO ${min}` });
  } else if (effectiveMax > state.currentBet) {
    const fullMin = state.currentBet + state.minRaise;
    if (effectiveMax >= fullMin) actions.push({ type: "raise", min: fullMin, max: effectiveMax, label: `RAISE TO ${fullMin}` });
  }

  const allInTarget = ownMax;
  if (player.stack > 0 && allInTarget > player.streetBet) {
    actions.push({ type: "all-in", amount: allInTarget, label: `ALL-IN ${allInTarget}` });
  }
  return actions;
}

function validateAction(state: EngineState, id: PlayerId, input: EngineAction): EngineAction {
  const legal = getLegalActions(state, id);
  const match = legal.find((action) => action.type === input.type);
  if (!match) throw new Error(`Illegal action: ${input.type}`);
  if (input.type === "bet" || input.type === "raise") {
    if (!Number.isInteger(input.amount)) throw new Error("Bet and raise amounts must be whole-chip targets");
    if (input.amount! < match.min! || input.amount! > match.max!) throw new Error(`Amount must be between ${match.min} and ${match.max}`);
  }
  return input;
}

export function applyAction(state: EngineState, id: PlayerId, rawAction: EngineAction): EngineState {
  assertEngineState(state, "before action");
  if (state.actor !== id) throw new Error("It is not this player's turn");
  const action = validateAction(state, id, rawAction);
  const player = state.players[id];
  const previousBet = state.currentBet;
  let logLine = "";

  if (action.type === "fold") {
    player.folded = true;
    record(state, id, "fold", undefined, { aggressive: false });
    state.handLog.push(`${playerName(id)} folds`);
    finishByFold(state, other(id));
    assertEngineState(state, "fold payout");
    return state;
  }

  if (action.type === "check") {
    record(state, id, "check", undefined, { aggressive: false });
    logLine = `${playerName(id)} checks`;
    state.acted.push(id);
  } else if (action.type === "call") {
    const paid = putChips(state, id, Math.max(0, state.currentBet - player.streetBet));
    record(state, id, "call", paid, { effectiveAmount: player.streetBet, aggressive: false });
    logLine = `${playerName(id)} calls ${paid}`;
    state.acted.push(id);
  } else {
    let target = action.type === "all-in"
      ? getLegalActions(state, id).find((candidate) => candidate.type === "all-in")!.amount!
      : action.amount!;
    const opponentMax = state.players[other(id)].streetBet + state.players[other(id)].stack;
    const effectiveTarget = Math.min(target, opponentMax);
    if (action.type === "all-in" && effectiveTarget <= previousBet) {
      const paid = putChips(state, id, target - player.streetBet);
      record(state, id, "all-in", target, { effectiveAmount: effectiveTarget, aggressive: false });
      state.handLog.push(`${playerName(id)} calls all-in for ${paid}`);
      state.acted = [...new Set([...state.acted, id])];
      if (bettingRoundComplete(state)) advanceStreet(state);
      else {
        state.actor = other(id);
        if (state.players[state.actor].allIn) advanceStreet(state);
      }
      assertEngineState(state, "short all-in call");
      return state;
    }
    const paid = putChips(state, id, target - player.streetBet);
    target = player.streetBet;
    const aggressiveType: "bet" | "raise" = previousBet === 0 ? "bet" : "raise";
    const semanticAggression = effectiveTarget > previousBet;
    record(state, id, action.type === "all-in" ? "all-in" : aggressiveType, target, { effectiveAmount: effectiveTarget, aggressive: semanticAggression });
    logLine = action.type === "all-in"
      ? `${playerName(id)} is all-in to ${target}`
      : `${playerName(id)} ${aggressiveType === "bet" ? "bets" : "raises to"} ${target}`;
    const raiseSize = effectiveTarget - previousBet;
    if (raiseSize >= state.minRaise) state.minRaise = raiseSize;
    state.currentBet = Math.max(state.currentBet, target);
    state.acted = [id];
    void paid;
  }
  state.acted = [...new Set(state.acted)];
  state.handLog.push(logLine);

  if (bettingRoundComplete(state)) {
    advanceStreet(state);
  } else {
    state.actor = other(id);
    if (state.players[state.actor].allIn) advanceStreet(state);
  }
  assertEngineState(state, `${id} ${action.type}`);
  return state;
}

function bettingRoundComplete(state: EngineState): boolean {
  const [human, ai] = [state.players.human, state.players.ai];
  const betsMatched = human.streetBet === ai.streetBet || human.allIn || ai.allIn;
  return betsMatched && state.acted.includes("human") && state.acted.includes("ai");
}

function dealBoard(state: EngineState, count: number): void {
  burnCard(state);
  for (let i = 0; i < count; i += 1) state.board.push(drawCard(state));
}

function advanceStreet(state: EngineState): void {
  if (state.players.human.allIn || state.players.ai.allIn) {
    runToShowdown(state);
    return;
  }
  const next: Record<Exclude<Street, "showdown" | "complete">, Street> = {
    preflop: "flop",
    flop: "turn",
    turn: "river",
    river: "showdown",
  };
  const nextStreet = next[state.street as Exclude<Street, "showdown" | "complete">];
  if (nextStreet === "showdown") {
    showdown(state);
    return;
  }
  state.street = nextStreet;
  if (nextStreet === "flop") dealBoard(state, 3);
  else dealBoard(state, 1);
  state.handLog.push(`${streetName(nextStreet)}: ${state.board.slice(nextStreet === "flop" ? 0 : -1).map(cardLabel).join(" ")}`);
  state.players.human.streetBet = 0;
  state.players.ai.streetBet = 0;
  state.currentBet = 0;
  state.minRaise = state.config.bigBlind;
  state.acted = [];
  state.actor = other(state.button); // BB acts first postflop.
}

function runToShowdown(state: EngineState): void {
  if (state.result || state.street === "complete") return;
  while (state.board.length < 5) {
    const count = state.board.length === 0 ? 3 : 1;
    const label = state.board.length === 0 ? "Flop" : state.board.length === 3 ? "Turn" : "River";
    dealBoard(state, count);
    state.handLog.push(`${label}: ${state.board.slice(-count).map(cardLabel).join(" ")}`);
  }
  showdown(state);
}

function refundUncalled(state: EngineState): { player?: PlayerId; amount: number } {
  const difference = state.players.human.totalContribution - state.players.ai.totalContribution;
  if (difference === 0) return { amount: 0 };
  const id: PlayerId = difference > 0 ? "human" : "ai";
  const refund = Math.abs(difference);
  if (refund > state.players[id].streetBet || refund > state.pot) {
    throw new Error("Accounting invariant failed: uncalled contribution is not present in the current street bet and pot");
  }
  state.players[id].stack += refund;
  state.players[id].allIn = false;
  state.players[id].streetBet -= refund;
  state.players[id].totalContribution -= refund;
  state.pot -= refund;
  state.currentBet = Math.max(state.players.human.streetBet, state.players.ai.streetBet);
  state.handLog.push(`Uncalled ${refund} returned to ${playerName(id)}`);
  return { player: id, amount: refund };
}

function clearSettledBets(state: EngineState): void {
  state.players.human.streetBet = 0;
  state.players.ai.streetBet = 0;
  state.currentBet = 0;
}

function showdown(state: EngineState): void {
  if (state.result || state.street === "complete") return;
  state.street = "showdown";
  state.actor = null;
  refundUncalled(state);
  assertEngineState(state, "uncalled refund before showdown");
  const humanScore = evaluateHand([...state.players.human.cards, ...state.board]);
  const aiScore = evaluateHand([...state.players.ai.cards, ...state.board]);
  const comparison = compareScores(humanScore, aiScore);
  const winners: PlayerId[] = comparison > 0 ? ["human"] : comparison < 0 ? ["ai"] : ["human", "ai"];
  const payouts = allocatePayouts(winners, state.pot, state.button);
  const settledPot = state.pot;
  state.players.human.stack += payouts.human;
  state.players.ai.stack += payouts.ai;
  state.players.human.allIn = state.players.human.stack === 0;
  state.players.ai.allIn = state.players.ai.stack === 0;
  const summary = winners.length === 2
    ? `Split pot — both players have ${humanScore.name}`
    : `${playerName(winners[0])} ${winners[0] === "human" ? "win" : "wins"} ${state.pot} with ${winners[0] === "human" ? humanScore.name : aiScore.name}`;
  const winnerScore = winners[0] === "human" ? humanScore : aiScore;
  const loserScore = winners[0] === "human" ? aiScore : humanScore;
  const showdownDetail = winners.length === 1 ? getShowdownDetail(winnerScore, loserScore) : undefined;
  const summarize = (score: typeof humanScore): EvaluatedHandSummary => ({
    category: score.category,
    name: score.name,
    rankValues: [...score.rankValues],
    bestFive: [...score.bestFive],
  });
  state.result = {
    winners,
    pot: state.pot,
    summary,
    humanHand: humanScore.name,
    aiHand: aiScore.name,
    humanScore: summarize(humanScore),
    aiScore: summarize(aiScore),
    showdownDetail,
    payouts,
  };
  state.handLog.push(`Showdown: You ${state.players.human.cards.map(cardLabel).join(" ")} · AI ${state.players.ai.cards.map(cardLabel).join(" ")}`);
  state.handLog.push(summary);
  state.pot = 0;
  clearSettledBets(state);
  state.street = "complete";
  state.matchOver = state.players.human.stack === 0 || state.players.ai.stack === 0;
  if (payouts.human + payouts.ai !== settledPot) throw new Error("Accounting invariant failed: showdown payout does not equal the settled pot");
  assertEngineState(state, "showdown payout");
}

/** The odd chip goes to the first seat left of the button (the non-button in heads-up). */
export function allocatePayouts(winners: PlayerId[], pot: number, button: PlayerId): Record<PlayerId, number> {
  assertWholeNonNegative(pot, "pot", "payout allocation");
  if (winners.length !== 1 && winners.length !== 2) throw new Error("Payout requires one winner or a two-player split");
  if (new Set(winners).size !== winners.length) throw new Error("Payout winner list contains duplicates");
  const payouts: Record<PlayerId, number> = { human: 0, ai: 0 };
  if (winners.length === 1) {
    payouts[winners[0]] = pot;
    return payouts;
  }
  const half = Math.floor(pot / 2);
  payouts.human = half;
  payouts.ai = half;
  payouts[other(button)] += pot - half * 2;
  return payouts;
}

function finishByFold(state: EngineState, winner: PlayerId): void {
  if (state.result || state.street === "complete") return;
  refundUncalled(state);
  assertEngineState(state, "uncalled refund before fold payout");
  const settledPot = state.pot;
  state.players[winner].stack += settledPot;
  state.players.human.allIn = state.players.human.stack === 0;
  state.players.ai.allIn = state.players.ai.stack === 0;
  const payouts: Record<PlayerId, number> = { human: 0, ai: 0 };
  payouts[winner] = settledPot;
  const summary = `${playerName(winner)} ${winner === "human" ? "win" : "wins"} ${settledPot} (opponent folded)`;
  state.result = { winners: [winner], pot: settledPot, summary, payouts };
  record(state, winner, "wins", settledPot);
  state.handLog.push(summary);
  state.actor = null;
  state.pot = 0;
  clearSettledBets(state);
  state.street = "complete";
  state.matchOver = state.players.human.stack === 0 || state.players.ai.stack === 0;
  assertEngineState(state, "fold payout");
}

export interface SidePot {
  amount: number;
  eligible: PlayerId[];
}

/** General contribution-layer algorithm retained for future multi-player support. */
export function buildSidePots(contributions: Array<{ id: PlayerId; amount: number; folded: boolean }>): SidePot[] {
  if (contributions.some((entry) => !Number.isInteger(entry.amount) || entry.amount < 0)) {
    throw new Error("Contributions must be non-negative whole numbers");
  }
  const levels = [...new Set(contributions.map((entry) => entry.amount).filter(Boolean))].sort((a, b) => a - b);
  const pots: SidePot[] = [];
  let previous = 0;
  for (const level of levels) {
    const participants = contributions.filter((entry) => entry.amount >= level);
    const amount = (level - previous) * participants.length;
    if (amount > 0) pots.push({ amount, eligible: participants.filter((entry) => !entry.folded).map((entry) => entry.id) });
    previous = level;
  }
  return pots;
}
