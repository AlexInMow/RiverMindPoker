import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDeck } from "../poker-engine/cards";
import { applyAction, assertCardIntegrity, assertChipAccounting, createGame, getLegalActions, playerIds, startNextHand, type EngineState } from "../poker-engine/game";
import type { Card, GameConfig, PlayerId } from "../shared/types";
import { PokerTable } from "../client/components/PokerTable";
import { SessionStore } from "../server/session";

const config = (opponentCount: 1 | 2 | 3 = 1): GameConfig => ({ language: "en", startingStack: 1_000, smallBlind: 50, bigBlind: 100, opponentCount, strategy: "balanced", difficulty: "strong", tableTalk: false, coachMode: false, debugMode: false });
const fixed = () => 0;

function passiveComplete(state: EngineState): void {
  let guard = 0;
  while (state.street !== "complete") {
    if (!state.actor) throw new Error("Missing actor");
    const legal = getLegalActions(state, state.actor);
    const action = legal.find((item) => item.type === "call") ?? legal.find((item) => item.type === "check") ?? legal[0];
    applyAction(state, state.actor, { type: action.type, amount: action.min });
    if (++guard > 80) throw new Error("Hand did not complete");
  }
}

function reachStreet(state: EngineState, street: "flop" | "turn" | "river"): void {
  while (state.street !== street) {
    if (!state.actor) throw new Error("Missing actor");
    const action = getLegalActions(state, state.actor).find((item) => item.type === "call") ?? getLegalActions(state, state.actor).find((item) => item.type === "check");
    if (!action) throw new Error("No passive action");
    applyAction(state, state.actor, { type: action.type });
  }
}

function assertShowdownReveal(state: EngineState, expected: PlayerId[]): void {
  expect(state.street).toBe("complete");
  expect(state.result?.endReason).toBe("showdown");
  expect(state.board).toHaveLength(5);
  for (const id of playerIds(state)) expect(state.players[id]!.showCards).toBe(expected.includes(id));
  assertChipAccounting(state);
  assertCardIntegrity(state);
}

function rigBoardPlay(state: EngineState): void {
  const holes: Record<string, [Card, Card]> = { human: ["2c", "3d"], ai: ["4c", "5d"] };
  const board: [Card, Card, Card, Card, Card] = ["As", "Ks", "Qs", "Js", "Ts"];
  const burns: [Card, Card, Card] = ["2h", "3h", "4h"];
  for (const id of playerIds(state)) { state.players[id]!.cards = [...holes[id]]; state.initialHoleCards[id] = [...holes[id]]; }
  const used = new Set<Card>([...Object.values(holes).flat(), ...board, ...burns]);
  const drawOrder: Card[] = [burns[0], board[0], board[1], board[2], burns[1], board[3], burns[2], board[4]];
  state.deck = [...createDeck().filter((card) => !used.has(card)), ...drawOrder.reverse()];
  state.cardsDrawn = 4; state.validatedCardsDrawn = 4;
}

describe("engine-owned showdown reveal state", () => {
  it("reveals both hands after a river check-check and keeps them visible", () => {
    const state = createGame(config(), fixed); passiveComplete(state);
    assertShowdownReveal(state, ["human", "ai"]);
    expect(state.result?.evaluatedHands?.human?.bestFive).toHaveLength(5);
    expect(state.result?.evaluatedHands?.ai?.bestFive).toHaveLength(5);
  });

  it("does not reveal either opponent hand after a river fold", () => {
    const state = createGame(config(), fixed); reachStreet(state, "river");
    applyAction(state, "ai", { type: "bet", amount: 100 }); applyAction(state, "human", { type: "fold" });
    expect(state.result?.endReason).toBe("fold");
    expect(state.result?.evaluatedHands).toBeUndefined();
    expect(playerIds(state).every((id) => !state.players[id]!.showCards)).toBe(true);
    const store = new SessionStore(); const session = store.create(config(), fixed); session.state = state;
    const publicState = store.publicState(session);
    expect(publicState.players.ai.cards).toBeNull();
    expect(renderToStaticMarkup(<PokerTable game={publicState} language="en" />)).not.toContain("revealed-cards");
  });

  it.each(["bet-call", "raise-call"] as const)("reveals both hands after a river %s", (line) => {
    const state = createGame(config(), fixed); reachStreet(state, "river");
    applyAction(state, "ai", { type: "bet", amount: 100 });
    if (line === "raise-call") { applyAction(state, "human", { type: "raise", amount: 300 }); applyAction(state, "ai", { type: "call" }); }
    else applyAction(state, "human", { type: "call" });
    assertShowdownReveal(state, ["human", "ai"]);
  });

  it.each(["preflop", "flop", "turn", "river"] as const)("runs out and reveals zero-stack participants after a %s all-in", (street) => {
    const state = createGame(config(), fixed);
    if (street !== "preflop") reachStreet(state, street);
    const actor = state.actor!;
    applyAction(state, actor, { type: "all-in" });
    applyAction(state, state.actor!, { type: "call" });
    assertShowdownReveal(state, ["human", "ai"]);
    const busted = playerIds(state).filter((id) => state.players[id]!.stack === 0);
    for (const id of busted) expect(state.players[id]!.showCards).toBe(true);
    const store = new SessionStore(); const session = store.create(config(), fixed); session.state = state;
    expect(renderToStaticMarkup(<PokerTable game={store.publicState(session)} language="en" />)).not.toContain("card-back");
  });

  it("reveals all participants at a three-way showdown", () => {
    const state = createGame(config(2), fixed); passiveComplete(state);
    assertShowdownReveal(state, ["human", "ai", "ai-2"]);
  });

  it("keeps a folded player hidden when the other two reach showdown", () => {
    const state = createGame(config(2), fixed);
    applyAction(state, "human", { type: "call" }); applyAction(state, "ai", { type: "fold" });
    passiveComplete(state);
    assertShowdownReveal(state, ["human", "ai-2"]);
  });

  it("reveals an all-in player while two opponents continue building a side pot", () => {
    const state = createGame(config(2), fixed);
    state.players.human.stack = 1_400;
    state.players.ai.stack = 150;
    state.players["ai-2"]!.stack = 1_300;
    applyAction(state, "human", { type: "call" });
    applyAction(state, "ai", { type: "all-in" });
    applyAction(state, "ai-2", { type: "call" });
    applyAction(state, "human", { type: "call" });
    applyAction(state, "ai-2", { type: "bet", amount: 100 });
    applyAction(state, "human", { type: "call" });
    passiveComplete(state);
    expect(state.result?.pots).toHaveLength(2);
    assertShowdownReveal(state, ["human", "ai", "ai-2"]);
  });

  it("keeps a player who folds after a side pot forms hidden from the final showdown", () => {
    const state = createGame(config(2), fixed);
    state.players.human.stack = 1_400;
    state.players.ai.stack = 150;
    state.players["ai-2"]!.stack = 1_300;
    applyAction(state, "human", { type: "call" });
    applyAction(state, "ai", { type: "all-in" });
    applyAction(state, "ai-2", { type: "call" });
    applyAction(state, "human", { type: "call" });
    applyAction(state, "ai-2", { type: "bet", amount: 100 });
    applyAction(state, "human", { type: "call" });
    applyAction(state, "ai-2", { type: "bet", amount: 100 });
    applyAction(state, "human", { type: "fold" });
    expect(state.result?.pots?.length).toBeGreaterThan(1);
    assertShowdownReveal(state, ["ai", "ai-2"]);
  });

  it("reveals every participant when the board plays and the pot splits", () => {
    const state = createGame(config(), fixed); rigBoardPlay(state); passiveComplete(state);
    expect(state.result?.winners.sort()).toEqual(["ai", "human"]);
    expect(state.result?.humanScore?.bestFive).toEqual(["As", "Ks", "Qs", "Js", "Ts"]);
    assertShowdownReveal(state, ["human", "ai"]);
  });

  it("preserves reveal through completed-hand renders and clears it on the next hand", () => {
    const store = new SessionStore(); const session = store.create(config(), fixed); passiveComplete(session.state);
    let publicState = store.publicState(session);
    expect(publicState.players.ai.cards).toHaveLength(2);
    const markup = renderToStaticMarkup(<PokerTable game={publicState} language="en" />);
    expect(markup).not.toContain("card-back");
    startNextHand(session.state, fixed); publicState = store.publicState(session);
    expect(publicState.result).toBeUndefined();
    expect(publicState.players.ai.showCards).toBe(false);
    expect(publicState.players.ai.cards).toBeNull();
    expect(playerIds(session.state).every((id) => !session.state.players[id]!.allIn && !session.state.players[id]!.showCards)).toBe(true);
    expect(renderToStaticMarkup(<PokerTable game={publicState} language="en" />)).toContain("card-back");
  });
});
