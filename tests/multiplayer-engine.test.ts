import { describe, expect, it } from "vitest";
import { createDeck, shuffleDeck } from "../poker-engine/cards";
import {
  allocatePayouts, applyAction, assertCardIntegrity, assertChipAccounting, buildSidePots,
  createGame, getLegalActions, playerIds, refundUncalled, startNextHand, type EngineState,
} from "../poker-engine/game";
import type { Card, GameConfig, OpponentCount, PlayerId } from "../shared/types";

const config = (opponentCount: OpponentCount, startingStack = 1_000): GameConfig => ({
  language: "en", startingStack, smallBlind: 50, bigBlind: 100, opponentCount,
  strategy: "balanced", difficulty: "strong", tableTalk: false, coachMode: false, debugMode: false,
});
const fixed = () => 0;

function passiveComplete(state: EngineState): void {
  let steps = 0;
  while (state.street !== "complete") {
    if (!state.actor) throw new Error("Missing actor");
    const legal = getLegalActions(state, state.actor);
    const action = legal.find((candidate) => candidate.type === "call") ?? legal.find((candidate) => candidate.type === "check") ?? legal[0];
    applyAction(state, state.actor, { type: action.type, amount: action.min });
    if (++steps > 100) throw new Error("Hand did not terminate");
  }
}

function setAvailableTotals(state: EngineState, totals: Partial<Record<PlayerId, number>>): void {
  for (const id of playerIds(state)) {
    const total = totals[id];
    if (total === undefined) throw new Error(`Missing total for ${id}`);
    state.players[id]!.stack = total - state.players[id]!.streetBet;
    state.players[id]!.allIn = state.players[id]!.stack === 0;
  }
  assertChipAccounting(state, "redistributed fixture stacks");
}

function rigRunout(state: EngineState, holes: Partial<Record<PlayerId, [Card, Card]>>, board: [Card, Card, Card, Card, Card]): void {
  const burns: [Card, Card, Card] = ["2s", "3s", "4s"];
  const holeCards = playerIds(state).flatMap((id) => holes[id] ?? []);
  const used = new Set<Card>([...holeCards, ...board, ...burns]);
  expect(used.size).toBe(holeCards.length + 8);
  for (const id of playerIds(state)) {
    const cards = holes[id];
    if (!cards) throw new Error(`Missing hole cards for ${id}`);
    state.players[id]!.cards = [...cards];
    state.initialHoleCards[id] = [...cards];
  }
  const drawOrder: Card[] = [burns[0], board[0], board[1], board[2], burns[1], board[3], burns[2], board[4]];
  state.deck = [...createDeck().filter((card) => !used.has(card)), ...drawOrder.reverse()];
  state.cardsDrawn = holeCards.length;
  state.validatedCardsDrawn = holeCards.length;
  assertCardIntegrity(state, "rigged multiway runout");
}

describe("multiplayer seating and dealing", () => {
  it.each([
    [1, ["human", "ai"], "human", "human", "ai", { human: "BTN / SB", ai: "BB" }],
    [2, ["human", "ai", "ai-2"], "human", "ai", "ai-2", { human: "BTN", ai: "SB", "ai-2": "BB" }],
    [3, ["human", "ai", "ai-2", "ai-3"], "ai-3", "ai", "ai-2", { human: "BTN", ai: "SB", "ai-2": "BB", "ai-3": "UTG" }],
  ] as const)("starts a %i-opponent hand in correct seat order", (opponents, ids, actor, sb, bb, positions) => {
    const state = createGame(config(opponents), fixed);
    expect(playerIds(state)).toEqual(ids);
    expect(state.actor).toBe(actor);
    expect(state.smallBlindPlayer).toBe(sb);
    expect(state.bigBlindPlayer).toBe(bb);
    expect(state.positions).toMatchObject(positions);
    assertChipAccounting(state);
    assertCardIntegrity(state);
  });

  it.each([1, 2, 3] as OpponentCount[])("deals one card clockwise left of the button for %i opponents", (opponents) => {
    const expectedDeck = shuffleDeck(createDeck(), fixed);
    const state = createGame(config(opponents), fixed);
    const order = [...playerIds(state).slice(1), "human"] as PlayerId[];
    const expected: Partial<Record<PlayerId, Card[]>> = {};
    for (let round = 0; round < 2; round += 1) for (const id of order) (expected[id] ??= []).push(expectedDeck.pop()!);
    for (const id of playerIds(state)) expect(state.players[id]!.cards).toEqual(expected[id]);
  });

  it.each([1, 2, 3] as OpponentCount[])("completes an ordinary %i-opponent hand", (opponents) => {
    const state = createGame(config(opponents), fixed);
    passiveComplete(state);
    expect(state.board).toHaveLength(5);
    expect(state.result?.pot).toBe((opponents + 1) * 100);
    expect(Object.values(state.result!.payouts).reduce((sum, amount) => sum + (amount ?? 0), 0)).toBe(state.result!.pot);
    assertChipAccounting(state);
    assertCardIntegrity(state);
  });

  it("keeps the full big-blind bring-in when the multiway BB is all-in short", () => {
    const state = createGame(config(2), fixed);
    passiveComplete(state);
    setAvailableTotals(state, { human: 70, ai: 1_465, "ai-2": 1_465 });
    startNextHand(state, fixed);
    expect(state.bigBlindPlayer).toBe("human");
    expect(state.players.human.allIn).toBe(true);
    expect(state.players.human.streetBet).toBe(70);
    expect(state.currentBet).toBe(100);
    expect(state.actor).toBe("ai");
    expect(getLegalActions(state, "ai").find((action) => action.type === "call")?.amount).toBe(100);
  });

  it("does not cap a multiway raise by one short opponent's stack", () => {
    const state = createGame(config(3), fixed);
    setAvailableTotals(state, { human: 1_000, ai: 500, "ai-2": 1_000, "ai-3": 1_500 });
    const legal = getLegalActions(state, "ai-3");
    expect(legal.find((action) => action.type === "raise")?.max).toBe(1_500);
    expect(legal.find((action) => action.type === "all-in")?.amount).toBe(1_500);
  });

  it("lets the heads-up SB call only the short BB's actual blind", () => {
    const state = createGame(config(1), fixed);
    passiveComplete(state);
    setAvailableTotals(state, { human: 70, ai: 1_930 });
    startNextHand(state, fixed);
    expect(state.actor).toBe("ai");
    expect(getLegalActions(state, "ai").find((action) => action.type === "call")?.amount).toBe(20);
    applyAction(state, "ai", { type: "call" });
    expect(state.street).toBe("complete");
    expect(state.result?.pot).toBe(140);
    assertChipAccounting(state);
  });
});

describe("multiway pots and settlement", () => {
  it("builds main and multiple side-pot contribution layers with folded money retained", () => {
    expect(buildSidePots([
      { id: "human", amount: 1_000, folded: false },
      { id: "ai", amount: 700, folded: true },
      { id: "ai-2", amount: 400, folded: false },
      { id: "ai-3", amount: 150, folded: false },
    ])).toEqual([
      { amount: 600, eligible: ["human", "ai-2", "ai-3"] },
      { amount: 750, eligible: ["human", "ai-2"] },
      { amount: 600, eligible: ["human"] },
      { amount: 300, eligible: ["human"] },
    ]);
  });

  it("refunds only the unique contribution above the second-highest layer", () => {
    const state = createGame(config(2), fixed);
    state.players.human.totalContribution = 1_000;
    state.players.ai.totalContribution = 900;
    state.players["ai-2"]!.totalContribution = 700;
    state.players.human.streetBet = 1_000;
    state.players.ai.streetBet = 900;
    state.players["ai-2"]!.streetBet = 700;
    state.players.human.stack = 0;
    state.players.ai.stack = 100;
    state.players["ai-2"]!.stack = 300;
    state.players.human.allIn = true;
    state.pot = 2_600;
    state.currentBet = 1_000;
    state.expectedTotalChips = 3_000;
    expect(refundUncalled(state)).toEqual({ player: "human", amount: 100 });
    expect(state.players.human.totalContribution).toBe(900);
    expect(state.pot).toBe(2_500);
  });

  it("settles three side-pot layers to three different winners", () => {
    const state = createGame(config(3), fixed);
    setAvailableTotals(state, { human: 1_750, ai: 1_250, "ai-2": 700, "ai-3": 300 });
    rigRunout(state, {
      human: ["Kc", "Kd"], ai: ["Ac", "Ad"], "ai-2": ["7c", "7d"], "ai-3": ["Ts", "Js"],
    }, ["2c", "3d", "7h", "8s", "9c"]);
    applyAction(state, "ai-3", { type: "all-in" });
    applyAction(state, "human", { type: "all-in" });
    applyAction(state, "ai", { type: "all-in" });
    applyAction(state, "ai-2", { type: "call" });
    expect(state.street).toBe("complete");
    expect(state.result?.pots?.map((pot) => ({ amount: pot.amount, winners: pot.winners }))).toEqual([
      { amount: 1_200, winners: ["ai-3"] },
      { amount: 1_200, winners: ["ai-2"] },
      { amount: 1_100, winners: ["ai"] },
    ]);
    expect(state.players.human.stack).toBe(500);
    expect(state.players.ai.stack).toBe(1_100);
    expect(state.players["ai-2"]!.stack).toBe(1_200);
    expect(state.players["ai-3"]!.stack).toBe(1_200);
    assertChipAccounting(state);
  });

  it("splits an odd main pot left of the button and awards the side pot separately", () => {
    const state = createGame(config(2, 1_200), fixed);
    setAvailableTotals(state, { human: 1_599, ai: 1_600, "ai-2": 401 });
    rigRunout(state, { human: ["As", "Ah"], ai: ["Kc", "Qd"], "ai-2": ["Ad", "Ac"] }, ["5c", "6d", "8h", "9s", "Jc"]);
    applyAction(state, "human", { type: "all-in" });
    applyAction(state, "ai", { type: "all-in" });
    applyAction(state, "ai-2", { type: "call" });
    expect(state.result?.pots?.[0]).toMatchObject({ amount: 1_203, winners: ["human", "ai-2"] });
    expect(state.result?.pots?.[0].payouts).toMatchObject({ human: 601, "ai-2": 602 });
    expect(state.result?.pots?.[1]).toMatchObject({ amount: 2_396, winners: ["human"] });
    expect(state.players.human.stack).toBe(2_997);
    expect(state.players["ai-2"]!.stack).toBe(602);
    expect(state.players.ai.stack).toBe(1);
  });

  it("uses deterministic clockwise odd-chip allocation", () => {
    expect(allocatePayouts(["human", "ai-2"], 5, "human", ["human", "ai", "ai-2"])).toMatchObject({ human: 2, "ai-2": 3 });
  });
});

describe("folds, elimination and table-size transitions", () => {
  it("ends immediately after multiple preflop folds", () => {
    const state = createGame(config(3), fixed);
    applyAction(state, "ai-3", { type: "fold" });
    applyAction(state, "human", { type: "fold" });
    applyAction(state, "ai", { type: "fold" });
    expect(state.street).toBe("complete");
    expect(state.result?.winners).toEqual(["ai-2"]);
    expect(state.board).toHaveLength(0);
    assertChipAccounting(state);
  });

  it("rotates 4-handed to 3-handed and then heads-up while skipping eliminated seats", () => {
    const state = createGame(config(3), fixed);
    passiveComplete(state);
    const aiStack = state.players.ai.stack;
    state.players.ai.stack = 0;
    state.players.ai.eliminated = true;
    state.players.human.stack += aiStack;
    state.matchOver = false;
    startNextHand(state, fixed);
    expect(state.button).toBe("ai-2");
    expect(state.positions).toMatchObject({ "ai-2": "BTN", "ai-3": "SB", human: "BB" });
    passiveComplete(state);
    const ai3Stack = state.players["ai-3"]!.stack;
    state.players["ai-3"]!.stack = 0;
    state.players["ai-3"]!.eliminated = true;
    state.players.human.stack += ai3Stack;
    state.matchOver = false;
    startNextHand(state, fixed);
    expect(state.positions[state.button]).toBe("BTN / SB");
    expect([state.smallBlindPlayer, state.bigBlindPlayer].sort()).toEqual(["ai-2", "human"].sort());
    assertChipAccounting(state);
    assertCardIntegrity(state);
  });

  it("rotates the button and blinds clockwise across four active seats", () => {
    const state = createGame(config(3), fixed);
    const observed = [{ button: state.button, sb: state.smallBlindPlayer, bb: state.bigBlindPlayer }];
    for (let hand = 0; hand < 3; hand += 1) {
      passiveComplete(state);
      startNextHand(state, fixed);
      observed.push({ button: state.button, sb: state.smallBlindPlayer, bb: state.bigBlindPlayer });
    }
    expect(observed).toEqual([
      { button: "human", sb: "ai", bb: "ai-2" },
      { button: "ai", sb: "ai-2", bb: "ai-3" },
      { button: "ai-2", sb: "ai-3", bb: "human" },
      { button: "ai-3", sb: "human", bb: "ai" },
    ]);
  });
});

describe("multiway raise reopening", () => {
  function reachReturningAllIn(total: number): EngineState {
    const state = createGame(config(3), fixed);
    setAvailableTotals(state, { human: 1_200, ai: 1_200, "ai-2": 4_000 - 2_400 - total, "ai-3": total });
    applyAction(state, "ai-3", { type: "call" });
    applyAction(state, "human", { type: "raise", amount: 300 });
    applyAction(state, "ai", { type: "call" });
    applyAction(state, "ai-2", { type: "call" });
    applyAction(state, "ai-3", { type: "all-in" });
    expect(state.actor).toBe("human");
    return state;
  }

  it("does not reopen raise rights after a short multiway all-in", () => {
    const state = reachReturningAllIn(350);
    expect(getLegalActions(state, "human").map((action) => action.type)).toEqual(["fold", "call"]);
    expect(state.raiseLocked).toContain("human");
  });

  it("reopens raise rights for every responder after a full all-in raise", () => {
    const state = reachReturningAllIn(500);
    expect(getLegalActions(state, "human").map((action) => action.type)).toContain("raise");
    expect(state.raiseLocked).not.toContain("human");
  });
});
