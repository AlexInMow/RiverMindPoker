import { randomUUID } from "node:crypto";
import type {
  ActionType, AIPlayerId, Card, EvaluatedHandSummary, GameConfig, HandResult,
  LegalAction, OpponentCount, PlayerAction, PlayerId, PlayerPublicState, Seat,
  SettledPotResult, SidePot, Street,
} from "../shared/types";
import { cardLabel, createDeck, shuffleDeck, type RandomIndex } from "./cards";
import { compareScores, evaluateHand, getShowdownDetail, type HandScore } from "./evaluator";

export interface EnginePlayer extends Omit<PlayerPublicState, "cards"> { cards: Card[] }
export type EnginePlayers = Record<string, EnginePlayer>;

export interface EngineState {
  config: GameConfig & { opponentCount: OpponentCount };
  handId: string;
  handNumber: number;
  seats: Seat[];
  button: PlayerId;
  smallBlindPlayer: PlayerId;
  bigBlindPlayer: PlayerId;
  positions: Partial<Record<PlayerId, string>>;
  street: Street;
  deck: Card[];
  burnCards: Card[];
  cardsDrawn: number;
  validatedCardsDrawn: number;
  shuffleCount: number;
  shuffledHandId: string;
  initialHoleCards: Record<string, Card[]>;
  board: Card[];
  pot: number;
  currentBet: number;
  minRaise: number;
  actor: PlayerId | null;
  matchOver: boolean;
  players: EnginePlayers;
  actions: PlayerAction[];
  handLog: string[];
  acted: PlayerId[];
  raiseLocked: PlayerId[];
  result?: HandResult;
  expectedTotalChips: number;
}

export interface EngineAction { type: ActionType; amount?: number }

const AI_IDS: AIPlayerId[] = ["ai", "ai-2", "ai-3"];
const playableActions = new Set<ActionType>(["fold", "check", "call", "bet", "raise", "all-in"]);
export const isAIPlayer = (id: PlayerId): id is AIPlayerId => id !== "human";
export const playerName = (id: PlayerId): string => id === "human" ? "You" : `AI ${AI_IDS.indexOf(id as AIPlayerId) + 1}`;
const logPlayerName = (state: EngineState, id: PlayerId): string => id === "human" ? "You" : state.seats.length === 2 ? "AI" : playerName(id);
const streetName = (street: Street): string => street[0].toUpperCase() + street.slice(1);
const unique = <T>(items: T[]): T[] => [...new Set(items)];

export function playerIds(state: EngineState): PlayerId[] { return state.seats.map((seat) => seat.playerId); }
function player(state: EngineState, id: PlayerId): EnginePlayer {
  const value = state.players[id];
  if (!value) throw new Error(`Unknown player ${id}`);
  return value;
}
function aliveIds(state: EngineState): PlayerId[] { return playerIds(state).filter((id) => !player(state, id).eliminated); }
function inHandIds(state: EngineState): PlayerId[] { return aliveIds(state).filter((id) => !player(state, id).folded); }
function actionableIds(state: EngineState): PlayerId[] { return inHandIds(state).filter((id) => !player(state, id).allIn); }
function seatIndex(state: EngineState, id: PlayerId): number {
  const index = state.seats.findIndex((seat) => seat.playerId === id);
  if (index < 0) throw new Error(`Seat not found for ${id}`);
  return index;
}

export function nextActivePlayer(state: EngineState, after: PlayerId, predicate: (candidate: EnginePlayer) => boolean = () => true): PlayerId | null {
  const start = seatIndex(state, after);
  for (let offset = 1; offset <= state.seats.length; offset += 1) {
    const id = state.seats[(start + offset) % state.seats.length].playerId;
    const candidate = player(state, id);
    if (!candidate.eliminated && predicate(candidate)) return id;
  }
  return null;
}

function clockwiseFrom(state: EngineState, after: PlayerId, ids: PlayerId[]): PlayerId[] {
  const allowed = new Set(ids);
  const start = seatIndex(state, after);
  const result: PlayerId[] = [];
  for (let offset = 1; offset <= state.seats.length; offset += 1) {
    const id = state.seats[(start + offset) % state.seats.length].playerId;
    if (allowed.has(id)) result.push(id);
  }
  return result;
}

function computePositions(state: EngineState): Partial<Record<PlayerId, string>> {
  const alive = aliveIds(state);
  const ordered = clockwiseFrom(state, state.button, alive.filter((id) => id !== state.button));
  const positions: Partial<Record<PlayerId, string>> = {};
  if (alive.length === 2) {
    positions[state.button] = "BTN / SB";
    positions[ordered[0]] = "BB";
  } else if (alive.length === 3) {
    positions[state.button] = "BTN";
    positions[ordered[0]] = "SB";
    positions[ordered[1]] = "BB";
  } else {
    positions[state.button] = "BTN";
    positions[ordered[0]] = "SB";
    positions[ordered[1]] = "BB";
    positions[ordered[2]] = "UTG";
  }
  return positions;
}

function assignBlinds(state: EngineState): void {
  const alive = aliveIds(state);
  if (alive.length < 2) throw new Error("At least two players are required");
  if (alive.length === 2) {
    state.smallBlindPlayer = state.button;
    state.bigBlindPlayer = nextActivePlayer(state, state.button)!;
  } else {
    state.smallBlindPlayer = nextActivePlayer(state, state.button)!;
    state.bigBlindPlayer = nextActivePlayer(state, state.smallBlindPlayer)!;
  }
  state.positions = computePositions(state);
}

function putChips(state: EngineState, id: PlayerId, amount: number): number {
  if (!Number.isInteger(amount) || amount < 0) throw new Error("Chip amounts must be non-negative whole numbers");
  const target = player(state, id);
  const paid = Math.min(target.stack, amount);
  target.stack -= paid;
  target.streetBet += paid;
  target.totalContribution += paid;
  state.pot += paid;
  target.allIn = target.stack === 0;
  return paid;
}

function assertWholeNonNegative(value: number, label: string, context: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Accounting invariant failed after ${context}: ${label} must be a non-negative whole number (received ${value})`);
}

export function assertChipAccounting(state: EngineState, context = "state update"): void {
  assertWholeNonNegative(state.expectedTotalChips, "expectedTotalChips", context);
  assertWholeNonNegative(state.pot, "pot", context);
  assertWholeNonNegative(state.currentBet, "currentBet", context);
  let stacks = 0;
  let contributions = 0;
  for (const id of playerIds(state)) {
    const current = player(state, id);
    assertWholeNonNegative(current.stack, `${id}.stack`, context);
    assertWholeNonNegative(current.streetBet, `${id}.streetBet`, context);
    assertWholeNonNegative(current.totalContribution, `${id}.totalContribution`, context);
    if (current.streetBet > current.totalContribution) throw new Error(`Accounting invariant failed after ${context}: ${id}.streetBet exceeds totalContribution`);
    if (current.allIn !== (current.stack === 0 && !current.eliminated)) throw new Error(`Accounting invariant failed after ${context}: ${id}.allIn does not match its stack`);
    if (current.eliminated && current.stack !== 0) throw new Error(`Accounting invariant failed after ${context}: eliminated ${id} still has chips`);
    stacks += current.stack;
    contributions += current.totalContribution;
  }
  if (new Set(state.raiseLocked).size !== state.raiseLocked.length || state.raiseLocked.some((id) => !state.players[id])) throw new Error(`Accounting invariant failed after ${context}: invalid raise-right state`);
  if (state.street === "complete") {
    if (!state.result) throw new Error(`Accounting invariant failed after ${context}: completed hand has no result`);
    if (state.pot !== 0) throw new Error(`Accounting invariant failed after ${context}: completed hand still has a live pot`);
    if (stacks !== state.expectedTotalChips) throw new Error(`Accounting invariant failed after ${context}: completed stacks ${stacks} != ${state.expectedTotalChips}`);
    const paid = Object.values(state.result.payouts).reduce((sum, amount) => sum + (amount ?? 0), 0);
    if (paid !== state.result.pot) throw new Error(`Accounting invariant failed after ${context}: payouts ${paid} != result pot ${state.result.pot}`);
    const expectedMatchOver = player(state, "human").eliminated || aliveIds(state).every((id) => id === "human");
    if (state.matchOver !== expectedMatchOver) throw new Error(`Accounting invariant failed after ${context}: inconsistent matchOver`);
    return;
  }
  if (state.matchOver) throw new Error(`Accounting invariant failed after ${context}: active hand cannot be matchOver`);
  const highestStreetBet = Math.max(...playerIds(state).map((id) => player(state, id).streetBet));
  const shortBigBlindBringIn = state.street === "preflop" && state.currentBet === state.config.bigBlind && highestStreetBet < state.currentBet;
  if (state.currentBet !== highestStreetBet && !shortBigBlindBringIn) throw new Error(`Accounting invariant failed after ${context}: currentBet ${state.currentBet} != ${highestStreetBet}`);
  if (contributions !== state.pot) throw new Error(`Accounting invariant failed after ${context}: contributions ${contributions} != pot ${state.pot}`);
  if (stacks + state.pot !== state.expectedTotalChips) throw new Error(`Accounting invariant failed after ${context}: stacks + pot ${stacks + state.pot} != ${state.expectedTotalChips}`);
}

export function assertCardIntegrity(state: EngineState, context = "state update"): void {
  const canonical = createDeck();
  if (canonical.length !== 52 || new Set(canonical).size !== 52) throw new Error("Canonical deck is invalid");
  if (state.shuffleCount !== 1 || state.shuffledHandId !== state.handId) throw new Error(`Card invariant failed after ${context}: hand must be shuffled exactly once`);
  const holes = playerIds(state).flatMap((id) => player(state, id).cards);
  const zones = [...state.deck, ...holes, ...state.board, ...state.burnCards];
  if (zones.length !== 52 || new Set(zones).size !== 52) throw new Error(`Card invariant failed after ${context}: zones must partition 52 unique cards`);
  const valid = new Set(canonical);
  if (zones.some((card) => !valid.has(card))) throw new Error(`Card invariant failed after ${context}: unknown card`);
  const dealt = holes.length + state.board.length + state.burnCards.length;
  if (state.cardsDrawn < state.validatedCardsDrawn) throw new Error(`Card invariant failed after ${context}: deck pointer moved backward`);
  if (state.cardsDrawn !== dealt || state.deck.length + state.cardsDrawn !== 52) throw new Error(`Card invariant failed after ${context}: invalid forward-only deck pointer`);
  state.validatedCardsDrawn = state.cardsDrawn;
  for (const id of playerIds(state)) {
    const initial = state.initialHoleCards[id] ?? [];
    const cards = player(state, id).cards;
    if (![0, 2].includes(initial.length) || cards.length !== initial.length || initial.some((card, index) => card !== cards[index])) throw new Error(`Card invariant failed after ${context}: ${id} hole cards changed`);
  }
}

function assertEngineState(state: EngineState, context: string): void {
  assertChipAccounting(state, context);
  assertCardIntegrity(state, context);
  if (state.actor) {
    const actor = player(state, state.actor);
    if (actor.eliminated || actor.folded || actor.allIn) throw new Error(`Actor invariant failed after ${context}`);
  }
}

function record(state: EngineState, id: PlayerId, action: PlayerAction["action"], amount?: number, semantics?: Pick<PlayerAction, "effectiveAmount" | "aggressive">): void {
  state.actions.push({ player: id, street: state.street, action, amount, ...semantics, at: Date.now() });
}
function postBlind(state: EngineState, id: PlayerId, amount: number, kind: "small-blind" | "big-blind"): void {
  const paid = putChips(state, id, amount);
  record(state, id, kind, paid, { aggressive: false });
  state.handLog.push(`${logPlayerName(state, id)} posts ${kind === "small-blind" ? "small blind" : "big blind"} ${paid}`);
}
function drawCard(state: EngineState): Card {
  const card = state.deck.pop();
  if (!card) throw new Error("Deck exhausted");
  state.cardsDrawn += 1;
  return card;
}
function burnCard(state: EngineState): void { state.burnCards.push(drawCard(state)); }
function dealHoleCards(state: EngineState): void {
  const order = clockwiseFrom(state, state.button, aliveIds(state).filter((id) => id !== state.button));
  order.push(state.button);
  for (let round = 0; round < 2; round += 1) for (const id of order) player(state, id).cards.push(drawCard(state));
}
function createSeats(opponentCount: OpponentCount, strategy: GameConfig["strategy"]): Seat[] {
  const ids: PlayerId[] = ["human", ...AI_IDS.slice(0, opponentCount)];
  return ids.map((playerId, seatIndexValue) => ({ seatIndex: seatIndexValue, playerId, kind: playerId === "human" ? "human" : "ai", displayName: playerName(playerId), strategy: playerId === "human" ? undefined : strategy }));
}

export function createGame(config: GameConfig, randomIndex?: RandomIndex): EngineState {
  if (![config.startingStack, config.smallBlind, config.bigBlind].every((value) => Number.isInteger(value) && value > 0)) throw new Error("Stacks and blinds must be positive whole numbers");
  if (config.smallBlind >= config.bigBlind) throw new Error("Small blind must be below big blind");
  const opponentCount = config.opponentCount ?? 1;
  if (![1, 2, 3].includes(opponentCount)) throw new Error("Opponent count must be 1, 2 or 3");
  const seats = createSeats(opponentCount, config.strategy);
  const players = {} as EnginePlayers;
  for (const seat of seats) players[seat.playerId] = { id: seat.playerId, stack: config.startingStack, streetBet: 0, totalContribution: 0, folded: false, allIn: false, eliminated: false, cards: [] };
  const state: EngineState = {
    config: { ...config, opponentCount }, handId: "", handNumber: 1, seats,
    button: "human", smallBlindPlayer: "human", bigBlindPlayer: "ai", positions: {},
    street: "preflop", deck: [], burnCards: [], cardsDrawn: 0, validatedCardsDrawn: 0,
    shuffleCount: 0, shuffledHandId: "", initialHoleCards: { human: [], ai: [] }, board: [],
    pot: 0, currentBet: 0, minRaise: config.bigBlind, actor: null, matchOver: false,
    players, actions: [], handLog: [], acted: [], raiseLocked: [], result: undefined,
    expectedTotalChips: config.startingStack * seats.length,
  };
  return startHand(state, randomIndex, false);
}

function nextPendingActor(state: EngineState, after: PlayerId): PlayerId | null {
  return nextActivePlayer(state, after, (candidate) => !candidate.folded && !candidate.allIn && (!state.acted.includes(candidate.id) || candidate.streetBet !== state.currentBet));
}
export function bettingRoundComplete(state: EngineState): boolean {
  const remaining = inHandIds(state);
  if (remaining.length <= 1) return true;
  const actionable = actionableIds(state);
  if (actionable.length === 0) return true;
  const matched = actionable.every((id) => player(state, id).streetBet === state.currentBet);
  if (actionable.length === 1) return matched;
  return matched && actionable.every((id) => state.acted.includes(id));
}

function startHand(state: EngineState, randomIndex: RandomIndex | undefined, rotate: boolean): EngineState {
  if (rotate) {
    state.handNumber += 1;
    const nextButton = nextActivePlayer(state, state.button);
    if (!nextButton) throw new Error("No next button seat");
    state.button = nextButton;
  }
  state.handId = randomUUID();
  state.street = "preflop";
  state.deck = shuffleDeck(createDeck(), randomIndex);
  state.shuffleCount = 1;
  state.shuffledHandId = state.handId;
  state.burnCards = [];
  state.cardsDrawn = 0;
  state.validatedCardsDrawn = 0;
  state.initialHoleCards = { human: [], ai: [] };
  state.board = [];
  state.pot = 0;
  state.currentBet = 0;
  state.minRaise = state.config.bigBlind;
  state.actor = null;
  state.matchOver = false;
  state.actions = [];
  state.acted = [];
  state.raiseLocked = [];
  state.result = undefined;
  for (const id of playerIds(state)) {
    const current = player(state, id);
    current.eliminated = current.stack === 0;
    Object.assign(current, { streetBet: 0, totalContribution: 0, folded: current.eliminated, allIn: false, cards: [] });
  }
  assignBlinds(state);
  state.handLog = [`Hand #${state.handNumber}`, `${logPlayerName(state, state.button)} ${state.button === "human" ? "are" : "is"} Button`];
  dealHoleCards(state);
  for (const id of playerIds(state)) state.initialHoleCards[id] = [...player(state, id).cards];
  postBlind(state, state.smallBlindPlayer, state.config.smallBlind, "small-blind");
  postBlind(state, state.bigBlindPlayer, state.config.bigBlind, "big-blind");
  const postedMaximum = Math.max(...playerIds(state).map((id) => player(state, id).streetBet));
  state.currentBet = aliveIds(state).length > 2 ? Math.max(state.config.bigBlind, postedMaximum) : postedMaximum;
  if (bettingRoundComplete(state)) runToShowdown(state);
  else {
    const first = nextPendingActor(state, state.bigBlindPlayer);
    if (!first) throw new Error("No valid preflop actor");
    state.actor = first;
  }
  assertEngineState(state, "start hand");
  return state;
}

export function startNextHand(state: EngineState, randomIndex?: RandomIndex): EngineState {
  if (state.street !== "complete") throw new Error("Current hand is not complete");
  if (state.matchOver) throw new Error("A player has no chips; start a new session");
  return startHand(state, randomIndex, true);
}

function maxCallableTarget(state: EngineState, id: PlayerId): number {
  const opponents = inHandIds(state).filter((candidate) => candidate !== id);
  return opponents.length ? Math.max(...opponents.map((candidate) => player(state, candidate).streetBet + player(state, candidate).stack)) : 0;
}
export function getLegalActions(state: EngineState, id: PlayerId): LegalAction[] {
  if (state.actor !== id || state.street === "complete" || state.street === "showdown") return [];
  const current = player(state, id);
  if (current.folded || current.allIn || current.eliminated) return [];
  const toCall = Math.max(0, state.currentBet - current.streetBet);
  const ownMax = current.streetBet + current.stack;
  const responders = actionableIds(state).filter((candidate) => candidate !== id);
  const canRaise = !state.raiseLocked.includes(id) && responders.length > 0;
  const actions: LegalAction[] = [];
  if (toCall > 0) {
    actions.push({ type: "fold", label: "FOLD" });
    actions.push({ type: "call", amount: Math.min(toCall, current.stack), label: `CALL ${Math.min(toCall, current.stack)}` });
  } else actions.push({ type: "check", label: "CHECK" });
  if (canRaise && state.currentBet === 0 && ownMax >= state.config.bigBlind) actions.push({ type: "bet", min: state.config.bigBlind, max: ownMax, label: `BET TO ${state.config.bigBlind}` });
  else if (canRaise && ownMax >= state.currentBet + state.minRaise) actions.push({ type: "raise", min: state.currentBet + state.minRaise, max: ownMax, label: `RAISE TO ${state.currentBet + state.minRaise}` });
  if (current.stack > 0 && ownMax > current.streetBet && (ownMax <= state.currentBet || canRaise || toCall > 0 && !state.raiseLocked.includes(id))) actions.push({ type: "all-in", amount: ownMax, label: `ALL-IN ${ownMax}` });
  return actions;
}
function validateAction(state: EngineState, id: PlayerId, input: EngineAction): EngineAction {
  const match = getLegalActions(state, id).find((action) => action.type === input.type);
  if (!match) throw new Error(`Illegal action: ${input.type}`);
  if (input.type === "bet" || input.type === "raise") {
    if (!Number.isInteger(input.amount)) throw new Error("Bet and raise amounts must be whole-chip targets");
    if (input.amount! < match.min! || input.amount! > match.max!) throw new Error(`Amount must be between ${match.min} and ${match.max}`);
  }
  return input;
}
function continueAfterAction(state: EngineState, id: PlayerId): void {
  if (inHandIds(state).length === 1) return finishByFold(state, inHandIds(state)[0]);
  if (bettingRoundComplete(state)) return advanceStreet(state);
  const next = nextPendingActor(state, id);
  if (!next) throw new Error("Betting round is incomplete but no player can act");
  state.actor = next;
}

export function applyAction(state: EngineState, id: PlayerId, rawAction: EngineAction): EngineState {
  assertEngineState(state, "before action");
  if (state.actor !== id) throw new Error("It is not this player's turn");
  const action = validateAction(state, id, rawAction);
  const current = player(state, id);
  const previousBet = state.currentBet;
  let logLine = "";
  if (action.type === "fold") {
    current.folded = true;
    record(state, id, "fold", undefined, { aggressive: false });
    state.acted = unique([...state.acted, id]);
    state.raiseLocked = unique([...state.raiseLocked, id]);
    state.handLog.push(`${logPlayerName(state, id)} folds`);
    continueAfterAction(state, id);
    assertEngineState(state, "fold");
    return state;
  }
  if (action.type === "check") {
    record(state, id, "check", undefined, { aggressive: false });
    logLine = `${logPlayerName(state, id)} checks`;
    state.acted = unique([...state.acted, id]);
    state.raiseLocked = unique([...state.raiseLocked, id]);
  } else if (action.type === "call") {
    const paid = putChips(state, id, Math.max(0, state.currentBet - current.streetBet));
    record(state, id, "call", paid, { effectiveAmount: current.streetBet, aggressive: false });
    logLine = current.allIn ? `${logPlayerName(state, id)} calls all-in for ${paid}` : `${logPlayerName(state, id)} calls ${paid}`;
    state.acted = unique([...state.acted, id]);
    state.raiseLocked = unique([...state.raiseLocked, id]);
  } else {
    const target = action.type === "all-in" ? getLegalActions(state, id).find((candidate) => candidate.type === "all-in")!.amount! : action.amount!;
    const effectiveTarget = Math.min(target, maxCallableTarget(state, id));
    const paid = putChips(state, id, target - current.streetBet);
    const semanticAggression = effectiveTarget > previousBet;
    if (!semanticAggression) {
      record(state, id, action.type === "all-in" ? "all-in" : "call", target, { effectiveAmount: effectiveTarget, aggressive: false });
      logLine = `${logPlayerName(state, id)} calls all-in for ${paid}`;
      state.acted = unique([...state.acted, id]);
      state.raiseLocked = unique([...state.raiseLocked, id]);
    } else {
      const aggressiveType: "bet" | "raise" = previousBet === 0 ? "bet" : "raise";
      record(state, id, action.type === "all-in" ? "all-in" : aggressiveType, target, { effectiveAmount: effectiveTarget, aggressive: true });
      logLine = action.type === "all-in" ? `${logPlayerName(state, id)} is all-in to ${target}` : `${logPlayerName(state, id)} ${aggressiveType === "bet" ? "bets" : "raises to"} ${target}`;
      const effectiveRaiseSize = effectiveTarget - previousBet;
      const fullRaise = effectiveRaiseSize >= state.minRaise;
      if (fullRaise) {
        state.minRaise = effectiveRaiseSize;
        state.acted = [id];
        state.raiseLocked = [id];
      } else {
        state.acted = unique([...state.acted, id]);
        state.raiseLocked = unique([...state.raiseLocked, id]);
      }
    }
    state.currentBet = Math.max(...playerIds(state).map((candidate) => player(state, candidate).streetBet));
  }
  state.handLog.push(logLine);
  continueAfterAction(state, id);
  assertEngineState(state, `${id} ${action.type}`);
  return state;
}

function dealBoard(state: EngineState, count: number): void {
  burnCard(state);
  for (let index = 0; index < count; index += 1) state.board.push(drawCard(state));
}
function resetStreetState(state: EngineState): void {
  for (const id of playerIds(state)) player(state, id).streetBet = 0;
  state.currentBet = 0;
  state.minRaise = state.config.bigBlind;
  state.acted = [];
  state.raiseLocked = [];
}
function advanceStreet(state: EngineState): void {
  const next: Record<Exclude<Street, "showdown" | "complete">, Street> = { preflop: "flop", flop: "turn", turn: "river", river: "showdown" };
  const nextStreet = next[state.street as Exclude<Street, "showdown" | "complete">];
  if (nextStreet === "showdown") return showdown(state);
  if (actionableIds(state).length <= 1) return runToShowdown(state);
  state.street = nextStreet;
  dealBoard(state, nextStreet === "flop" ? 3 : 1);
  state.handLog.push(`${streetName(nextStreet)}: ${state.board.slice(nextStreet === "flop" ? 0 : -1).map(cardLabel).join(" ")}`);
  resetStreetState(state);
  const first = nextActivePlayer(state, state.button, (candidate) => !candidate.folded && !candidate.allIn);
  if (!first) return runToShowdown(state);
  state.actor = first;
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

export function refundUncalled(state: EngineState): { player?: PlayerId; amount: number } {
  const ranked = playerIds(state).map((id) => ({ id, amount: player(state, id).totalContribution })).sort((a, b) => b.amount - a.amount);
  if (ranked.length < 2 || ranked[0].amount <= ranked[1].amount) return { amount: 0 };
  const id = ranked[0].id;
  const refund = ranked[0].amount - ranked[1].amount;
  const current = player(state, id);
  current.stack += refund;
  current.totalContribution -= refund;
  current.streetBet = Math.max(0, current.streetBet - refund);
  current.allIn = false;
  state.pot -= refund;
  state.currentBet = Math.max(...playerIds(state).map((candidate) => player(state, candidate).streetBet));
  state.handLog.push(`Uncalled ${refund} returned to ${logPlayerName(state, id)}`);
  return { player: id, amount: refund };
}
function emptyPayouts(stateOrIds: EngineState | PlayerId[]): HandResult["payouts"] {
  const ids = Array.isArray(stateOrIds) ? stateOrIds : playerIds(stateOrIds);
  const payouts = { human: 0, ai: 0 } as HandResult["payouts"];
  for (const id of ids) payouts[id] = 0;
  return payouts;
}
export function buildSidePots(contributions: Array<{ id: PlayerId; amount: number; folded: boolean }>): SidePot[] {
  if (contributions.some((entry) => !Number.isInteger(entry.amount) || entry.amount < 0)) throw new Error("Contributions must be non-negative whole numbers");
  const levels = [...new Set(contributions.map((entry) => entry.amount).filter((amount) => amount > 0))].sort((a, b) => a - b);
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
export function currentSidePots(state: EngineState): SidePot[] {
  return buildSidePots(playerIds(state).map((id) => ({ id, amount: player(state, id).totalContribution, folded: player(state, id).folded })));
}

export function allocatePayouts(winners: PlayerId[], pot: number, button: PlayerId, seatOrder: PlayerId[] = ["human", "ai"]): HandResult["payouts"] {
  assertWholeNonNegative(pot, "pot", "payout allocation");
  if (!winners.length || new Set(winners).size !== winners.length) throw new Error("Payout winners must be unique and non-empty");
  const payouts = emptyPayouts(seatOrder);
  const share = Math.floor(pot / winners.length);
  for (const id of winners) payouts[id] = share;
  const odd = pot - share * winners.length;
  const buttonIndex = seatOrder.indexOf(button);
  const ordered = [...seatOrder.slice(buttonIndex + 1), ...seatOrder.slice(0, buttonIndex + 1)].filter((id) => winners.includes(id));
  for (let index = 0; index < odd; index += 1) payouts[ordered[index % ordered.length]]! += 1;
  return payouts;
}
function summarizeScore(score: HandScore): EvaluatedHandSummary {
  return { category: score.category, name: score.name, rankValues: [...score.rankValues], bestFive: [...score.bestFive] };
}
function finalizeSettlement(state: EngineState): void {
  for (const id of playerIds(state)) {
    const current = player(state, id);
    current.streetBet = 0;
    current.totalContribution = 0;
    current.eliminated = current.stack === 0;
    current.allIn = false;
    if (current.eliminated) current.folded = true;
  }
  state.currentBet = 0;
  state.pot = 0;
  state.actor = null;
  state.street = "complete";
  state.matchOver = player(state, "human").eliminated || aliveIds(state).every((id) => id === "human");
}
function showdown(state: EngineState): void {
  if (state.result || state.street === "complete") return;
  state.street = "showdown";
  state.actor = null;
  refundUncalled(state);
  assertChipAccounting(state, "uncalled refund before showdown");
  const contenders = inHandIds(state);
  const scores = {} as Partial<Record<PlayerId, HandScore>>;
  const evaluatedHands: Partial<Record<PlayerId, EvaluatedHandSummary>> = {};
  for (const id of contenders) {
    scores[id] = evaluateHand([...player(state, id).cards, ...state.board]);
    evaluatedHands[id] = summarizeScore(scores[id]!);
  }
  const pots = currentSidePots(state);
  const totalPot = state.pot;
  const totalPayouts = emptyPayouts(state);
  const settledPots: SettledPotResult[] = [];
  for (let index = 0; index < pots.length; index += 1) {
    const pot = pots[index];
    if (!pot.eligible.length) throw new Error("Side pot has no eligible player");
    let winners = [pot.eligible[0]];
    for (const id of pot.eligible.slice(1)) {
      const comparison = compareScores(scores[id]!, scores[winners[0]]!);
      if (comparison > 0) winners = [id];
      else if (comparison === 0) winners.push(id);
    }
    const payouts = allocatePayouts(winners, pot.amount, state.button, playerIds(state));
    for (const id of playerIds(state)) {
      const amount = payouts[id] ?? 0;
      player(state, id).stack += amount;
      totalPayouts[id] = (totalPayouts[id] ?? 0) + amount;
    }
    settledPots.push({ ...pot, index, winners, payouts });
  }
  const winners = unique(settledPots.flatMap((pot) => pot.winners));
  const summary = settledPots.map((pot, index) => `${index === 0 ? "Main pot" : `Side pot ${index}`}: ${pot.winners.map((id) => logPlayerName(state, id)).join(" / ")} ${pot.winners.length > 1 ? "split" : "wins"} ${pot.amount}`).join(" · ");
  const humanScore = evaluatedHands.human;
  const aiScore = evaluatedHands.ai;
  const losingPlayer = contenders.find((id) => id !== winners[0]);
  const showdownDetail = contenders.length === 2 && winners.length === 1 && losingPlayer
    ? getShowdownDetail(scores[winners[0]]!, scores[losingPlayer]!)
    : undefined;
  state.result = { winners, pot: totalPot, summary, evaluatedHands, pots: settledPots, payouts: totalPayouts, humanHand: humanScore?.name, aiHand: aiScore?.name, humanScore, aiScore, showdownDetail };
  state.handLog.push(`Showdown: ${contenders.map((id) => `${logPlayerName(state, id)} ${player(state, id).cards.map(cardLabel).join(" ")}`).join(" · ")}`);
  state.handLog.push(summary);
  finalizeSettlement(state);
  assertEngineState(state, "showdown payout");
}
function finishByFold(state: EngineState, winner: PlayerId): void {
  if (state.result || state.street === "complete") return;
  refundUncalled(state);
  assertChipAccounting(state, "uncalled refund before fold payout");
  const totalPot = state.pot;
  const payouts = emptyPayouts(state);
  payouts[winner] = totalPot;
  player(state, winner).stack += totalPot;
  const summary = `${logPlayerName(state, winner)} ${winner === "human" ? "win" : "wins"} ${totalPot} (opponents folded)`;
  const potResult: SettledPotResult = { index: 0, amount: totalPot, eligible: [winner], winners: [winner], payouts };
  state.result = { winners: [winner], pot: totalPot, summary, payouts, pots: [potResult] };
  record(state, winner, "wins", totalPot);
  state.handLog.push(summary);
  finalizeSettlement(state);
  assertEngineState(state, "fold payout");
}
export function isPlayableAction(action: PlayerAction): action is PlayerAction & { action: ActionType } { return playableActions.has(action.action as ActionType); }
