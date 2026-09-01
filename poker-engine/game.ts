import type {
  ActionType,
  Card,
  GameConfig,
  HandResult,
  LegalAction,
  PlayerAction,
  PlayerId,
  PlayerPublicState,
  Street,
} from "../shared/types";
import { cardLabel, createDeck, shuffleDeck } from "./cards";
import { compareScores, evaluateHand, getShowdownDetail } from "./evaluator";

interface EnginePlayer extends Omit<PlayerPublicState, "cards"> {
  cards: Card[];
}

export interface EngineState {
  config: GameConfig;
  handNumber: number;
  button: PlayerId;
  street: Street;
  deck: Card[];
  board: Card[];
  pot: number;
  currentBet: number;
  minRaise: number;
  actor: PlayerId | null;
  players: Record<PlayerId, EnginePlayer>;
  actions: PlayerAction[];
  handLog: string[];
  acted: PlayerId[];
  result?: HandResult;
}

export interface EngineAction {
  type: ActionType;
  amount?: number;
}

const other = (id: PlayerId): PlayerId => id === "human" ? "ai" : "human";
const playerName = (id: PlayerId): string => id === "human" ? "You" : "AI";
const streetName = (street: Street): string => street[0].toUpperCase() + street.slice(1);

function putChips(state: EngineState, id: PlayerId, amount: number): number {
  const player = state.players[id];
  const paid = Math.max(0, Math.min(player.stack, amount));
  player.stack -= paid;
  player.streetBet += paid;
  player.totalContribution += paid;
  state.pot += paid;
  player.allIn = player.stack === 0;
  return paid;
}

function record(state: EngineState, player: PlayerId, action: PlayerAction["action"], amount?: number): void {
  state.actions.push({ player, street: state.street, action, amount, at: Date.now() });
}

function postBlind(state: EngineState, id: PlayerId, amount: number, kind: "small-blind" | "big-blind"): void {
  const paid = putChips(state, id, amount);
  record(state, id, kind, paid);
  state.handLog.push(`${playerName(id)} posts ${kind === "small-blind" ? "small blind" : "big blind"} ${paid}`);
}

function dealHoleCards(state: EngineState): void {
  const first = state.button;
  const second = other(first);
  for (let round = 0; round < 2; round += 1) {
    state.players[first].cards.push(state.deck.pop()!);
    state.players[second].cards.push(state.deck.pop()!);
  }
}

export function createGame(config: GameConfig, random: () => number = Math.random): EngineState {
  const state: EngineState = {
    config,
    handNumber: 1,
    button: "human",
    street: "preflop",
    deck: [],
    board: [],
    pot: 0,
    currentBet: 0,
    minRaise: config.bigBlind,
    actor: null,
    players: {
      human: { id: "human", stack: config.startingStack, streetBet: 0, totalContribution: 0, folded: false, allIn: false, cards: [] },
      ai: { id: "ai", stack: config.startingStack, streetBet: 0, totalContribution: 0, folded: false, allIn: false, cards: [] },
    },
    actions: [],
    handLog: [],
    acted: [],
  };
  return startHand(state, random, false);
}

function startHand(state: EngineState, random: () => number, rotate: boolean): EngineState {
  if (rotate) {
    state.handNumber += 1;
    state.button = other(state.button);
  }
  state.street = "preflop";
  state.deck = shuffleDeck(createDeck(), random);
  state.board = [];
  state.pot = 0;
  state.currentBet = 0;
  state.minRaise = state.config.bigBlind;
  state.actor = state.button;
  state.actions = [];
  state.acted = [];
  state.result = undefined;
  state.handLog = [`Hand #${state.handNumber}`, `${playerName(state.button)} ${state.button === "human" ? "are" : "is"} Button / SB`];
  for (const id of ["human", "ai"] as PlayerId[]) {
    Object.assign(state.players[id], { streetBet: 0, totalContribution: 0, folded: false, allIn: false, cards: [] });
  }
  dealHoleCards(state);
  postBlind(state, state.button, state.config.smallBlind, "small-blind");
  postBlind(state, other(state.button), state.config.bigBlind, "big-blind");
  state.currentBet = Math.max(state.players.human.streetBet, state.players.ai.streetBet);

  if (state.players[state.actor].allIn) {
    state.actor = other(state.actor);
    if (state.players[state.actor].allIn) runToShowdown(state);
  }
  return state;
}

export function startNextHand(state: EngineState, random: () => number = Math.random): EngineState {
  if (state.street !== "complete") throw new Error("Current hand is not complete");
  if (state.players.human.stack <= 0 || state.players.ai.stack <= 0) throw new Error("A player has no chips; start a new session");
  return startHand(state, random, true);
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

  const allInTarget = Math.max(player.streetBet, effectiveMax);
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
  if (state.actor !== id) throw new Error("It is not this player's turn");
  const action = validateAction(state, id, rawAction);
  const player = state.players[id];
  const previousBet = state.currentBet;
  let logLine = "";

  if (action.type === "fold") {
    player.folded = true;
    record(state, id, "fold");
    state.handLog.push(`${playerName(id)} folds`);
    finishByFold(state, other(id));
    return state;
  }

  if (action.type === "check") {
    record(state, id, "check");
    logLine = `${playerName(id)} checks`;
    state.acted.push(id);
  } else if (action.type === "call") {
    const paid = putChips(state, id, Math.max(0, state.currentBet - player.streetBet));
    record(state, id, "call", paid);
    logLine = `${playerName(id)} calls ${paid}`;
    state.acted.push(id);
  } else {
    let target = action.type === "all-in"
      ? getLegalActions(state, id).find((candidate) => candidate.type === "all-in")!.amount!
      : action.amount!;
    if (action.type === "all-in" && target <= previousBet) {
      const paid = putChips(state, id, target - player.streetBet);
      record(state, id, "all-in", target);
      state.handLog.push(`${playerName(id)} calls all-in for ${paid}`);
      state.acted = [...new Set([...state.acted, id])];
      if (bettingRoundComplete(state)) advanceStreet(state);
      else {
        state.actor = other(id);
        if (state.players[state.actor].allIn) advanceStreet(state);
      }
      return state;
    }
    const paid = putChips(state, id, target - player.streetBet);
    target = player.streetBet;
    const aggressiveType: "bet" | "raise" = previousBet === 0 ? "bet" : "raise";
    record(state, id, action.type === "all-in" ? "all-in" : aggressiveType, target);
    logLine = action.type === "all-in"
      ? `${playerName(id)} is all-in to ${target}`
      : `${playerName(id)} ${aggressiveType === "bet" ? "bets" : "raises to"} ${target}`;
    const raiseSize = target - previousBet;
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
  return state;
}

function bettingRoundComplete(state: EngineState): boolean {
  const [human, ai] = [state.players.human, state.players.ai];
  const betsMatched = human.streetBet === ai.streetBet || human.allIn || ai.allIn;
  return betsMatched && state.acted.includes("human") && state.acted.includes("ai");
}

function dealBoard(state: EngineState, count: number): void {
  state.deck.pop(); // burn
  for (let i = 0; i < count; i += 1) state.board.push(state.deck.pop()!);
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
  while (state.board.length < 5) {
    const count = state.board.length === 0 ? 3 : 1;
    const label = state.board.length === 0 ? "Flop" : state.board.length === 3 ? "Turn" : "River";
    dealBoard(state, count);
    state.handLog.push(`${label}: ${state.board.slice(-count).map(cardLabel).join(" ")}`);
  }
  showdown(state);
}

function refundUncalled(state: EngineState): void {
  const difference = state.players.human.totalContribution - state.players.ai.totalContribution;
  if (difference === 0) return;
  const id: PlayerId = difference > 0 ? "human" : "ai";
  const refund = Math.abs(difference);
  state.players[id].stack += refund;
  state.players[id].totalContribution -= refund;
  state.pot -= refund;
  state.handLog.push(`Uncalled ${refund} returned to ${playerName(id)}`);
}

function showdown(state: EngineState): void {
  state.street = "showdown";
  state.actor = null;
  refundUncalled(state);
  const humanScore = evaluateHand([...state.players.human.cards, ...state.board]);
  const aiScore = evaluateHand([...state.players.ai.cards, ...state.board]);
  const comparison = compareScores(humanScore, aiScore);
  const winners: PlayerId[] = comparison > 0 ? ["human"] : comparison < 0 ? ["ai"] : ["human", "ai"];
  const payouts: Record<PlayerId, number> = { human: 0, ai: 0 };
  if (winners.length === 1) {
    payouts[winners[0]] = state.pot;
  } else {
    const half = Math.floor(state.pot / 2);
    payouts.human = half;
    payouts.ai = half;
    payouts[state.button] += state.pot - half * 2;
  }
  state.players.human.stack += payouts.human;
  state.players.ai.stack += payouts.ai;
  const summary = winners.length === 2
    ? `Split pot — both players have ${humanScore.name}`
    : `${playerName(winners[0])} wins ${state.pot} with ${winners[0] === "human" ? humanScore.name : aiScore.name}`;
  const winnerScore = winners[0] === "human" ? humanScore : aiScore;
  const loserScore = winners[0] === "human" ? aiScore : humanScore;
  const showdownDetail = winners.length === 1 ? getShowdownDetail(winnerScore, loserScore) : undefined;
  state.result = { winners, pot: state.pot, summary, humanHand: humanScore.name, aiHand: aiScore.name, showdownDetail, payouts };
  state.handLog.push(`Showdown: You ${state.players.human.cards.map(cardLabel).join(" ")} · AI ${state.players.ai.cards.map(cardLabel).join(" ")}`);
  state.handLog.push(summary);
  state.street = "complete";
}

function finishByFold(state: EngineState, winner: PlayerId): void {
  state.players[winner].stack += state.pot;
  const payouts: Record<PlayerId, number> = { human: 0, ai: 0 };
  payouts[winner] = state.pot;
  const summary = `${playerName(winner)} wins ${state.pot} (opponent folded)`;
  state.result = { winners: [winner], pot: state.pot, summary, payouts };
  record(state, winner, "wins", state.pot);
  state.handLog.push(summary);
  state.actor = null;
  state.street = "complete";
}

export interface SidePot {
  amount: number;
  eligible: PlayerId[];
}

/** General contribution-layer algorithm retained for future multi-player support. */
export function buildSidePots(contributions: Array<{ id: PlayerId; amount: number; folded: boolean }>): SidePot[] {
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
