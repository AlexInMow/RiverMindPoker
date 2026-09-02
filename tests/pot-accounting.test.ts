import { describe, expect, it } from "vitest";
import { createDeck } from "../poker-engine/cards";
import { allocatePayouts, applyAction, assertChipAccounting, createGame, getLegalActions, startNextHand, type EngineState } from "../poker-engine/game";
import { SessionStore } from "../server/session";
import type { Card, GameConfig, PlayerId } from "../shared/types";

const config: GameConfig = {
  language: "ru", startingStack: 1000, smallBlind: 50, bigBlind: 100, strategy: "balanced", difficulty: "strong", tableTalk: false, coachMode: false, debugMode: true,
};

const showdownCards = {
  human: ["As", "Ad"] as Card[],
  ai: ["Kh", "Qh"] as Card[],
  board: ["2c", "5d", "7h", "9s", "Jc"] as Card[],
};
const fixedRandom = (fraction: number) => (upperExclusive: number) => Math.min(upperExclusive - 1, Math.floor(fraction * upperExclusive));

function rigRiver(options: {
  actor: PlayerId;
  humanStack: number;
  aiStack: number;
  humanContribution: number;
  aiContribution: number;
  humanStreetBet?: number;
  aiStreetBet?: number;
  acted?: PlayerId[];
  humanCards?: Card[];
  aiCards?: Card[];
  board?: Card[];
}): EngineState {
  const game = createGame(config, fixedRandom(0.37));
  game.street = "river";
  game.actor = options.actor;
  game.players.human.stack = options.humanStack;
  game.players.ai.stack = options.aiStack;
  game.players.human.totalContribution = options.humanContribution;
  game.players.ai.totalContribution = options.aiContribution;
  game.players.human.streetBet = options.humanStreetBet ?? 0;
  game.players.ai.streetBet = options.aiStreetBet ?? 0;
  game.players.human.allIn = options.humanStack === 0;
  game.players.ai.allIn = options.aiStack === 0;
  game.pot = options.humanContribution + options.aiContribution;
  game.currentBet = Math.max(game.players.human.streetBet, game.players.ai.streetBet);
  game.acted = options.acted ?? [];
  game.players.human.cards = options.humanCards ?? [...showdownCards.human];
  game.players.ai.cards = options.aiCards ?? [...showdownCards.ai];
  game.board = options.board ?? [...showdownCards.board];
  const used = new Set([...game.players.human.cards, ...game.players.ai.cards, ...game.board]);
  const available = createDeck().filter((card) => !used.has(card));
  game.burnCards = available.splice(0, 3);
  game.deck = available;
  game.cardsDrawn = 12;
  game.validatedCardsDrawn = 12;
  game.initialHoleCards = { human: [...game.players.human.cards], ai: [...game.players.ai.cards] };
  game.expectedTotalChips = options.humanStack + options.aiStack + game.pot;
  game.matchOver = false;
  game.result = undefined;
  assertChipAccounting(game, "rigged river state");
  return game;
}

function reachStreet(game: EngineState, street: "flop" | "turn" | "river"): void {
  applyAction(game, "human", { type: "call" });
  applyAction(game, "ai", { type: "check" });
  if (street === "flop") return;
  applyAction(game, "ai", { type: "check" });
  applyAction(game, "human", { type: "check" });
  if (street === "turn") return;
  applyAction(game, "ai", { type: "check" });
  applyAction(game, "human", { type: "check" });
}

function expectConserved(game: EngineState, total = game.expectedTotalChips): void {
  expect(game.players.human.stack).toBeGreaterThanOrEqual(0);
  expect(game.players.ai.stack).toBeGreaterThanOrEqual(0);
  expect(game.pot).toBeGreaterThanOrEqual(0);
  expect(game.players.human.stack + game.players.ai.stack + game.pot).toBe(total);
  assertChipAccounting(game, "test assertion");
}

describe("pot, stack and all-in accounting", () => {
  it("does not end the match while AI is temporarily all-in and lets it continue after AI wins", () => {
    const game = rigRiver({
      actor: "ai", humanStack: 3000, aiStack: 2000, humanContribution: 0, aiContribution: 0,
      humanCards: ["Kh", "Qh"], aiCards: ["As", "Ad"],
    });
    applyAction(game, "ai", { type: "all-in" });
    expect(game.players.ai.stack).toBe(0);
    expect(game.street).toBe("river");
    expect(game.result).toBeUndefined();
    expect(game.matchOver).toBe(false);
    const store = new SessionStore();
    const session = store.create(config);
    session.state = game;
    expect(store.publicState(session).matchOver).toBe(false);

    applyAction(game, "human", { type: "call" });
    expect(game.result?.winners).toEqual(["ai"]);
    expect(game.players.ai.stack).toBe(4000);
    expect(game.players.human.stack).toBe(1000);
    expect(game.matchOver).toBe(false);
    expect(store.publicState(session).matchOver).toBe(false);
    expect(() => startNextHand(game, fixedRandom(0.11))).not.toThrow();
  });

  it("ends the match only after AI loses its all-in at showdown", () => {
    const game = rigRiver({ actor: "ai", humanStack: 3000, aiStack: 2000, humanContribution: 0, aiContribution: 0 });
    applyAction(game, "ai", { type: "all-in" });
    expect(game.players.ai.stack).toBe(0);
    expect(game.matchOver).toBe(false);

    applyAction(game, "human", { type: "call" });
    expect(game.result?.winners).toEqual(["human"]);
    expect(game.players.ai.stack).toBe(0);
    expect(game.players.human.stack).toBe(5000);
    expect(game.matchOver).toBe(true);
    expect(() => startNextHand(game, fixedRandom(0.13))).toThrow(/no chips/);
  });

  it("does not end the match while the human is temporarily all-in and lets it continue after a win", () => {
    const game = rigRiver({ actor: "human", humanStack: 2000, aiStack: 3000, humanContribution: 0, aiContribution: 0 });
    applyAction(game, "human", { type: "all-in" });
    expect(game.players.human.stack).toBe(0);
    expect(game.matchOver).toBe(false);

    applyAction(game, "ai", { type: "call" });
    expect(game.result?.winners).toEqual(["human"]);
    expect(game.players.human.stack).toBe(4000);
    expect(game.players.ai.stack).toBe(1000);
    expect(game.matchOver).toBe(false);
    expect(() => startNextHand(game, fixedRandom(0.15))).not.toThrow();
  });

  it("ends the match only after the human loses their all-in at showdown", () => {
    const game = rigRiver({
      actor: "human", humanStack: 2000, aiStack: 3000, humanContribution: 0, aiContribution: 0,
      humanCards: ["Kh", "Qh"], aiCards: ["As", "Ad"],
    });
    applyAction(game, "human", { type: "all-in" });
    expect(game.players.human.stack).toBe(0);
    expect(game.matchOver).toBe(false);

    applyAction(game, "ai", { type: "call" });
    expect(game.result?.winners).toEqual(["ai"]);
    expect(game.players.human.stack).toBe(0);
    expect(game.players.ai.stack).toBe(5000);
    expect(game.matchOver).toBe(true);
    expect(() => startNextHand(game, fixedRandom(0.17))).toThrow(/no chips/);
  });

  it("adds a won pot to the winner's remaining stack instead of replacing it", () => {
    const game = rigRiver({ actor: "human", humanStack: 800, aiStack: 800, humanContribution: 200, aiContribution: 200, acted: ["ai"] });
    applyAction(game, "human", { type: "check" });
    expect(game.result?.winners).toEqual(["human"]);
    expect(game.result?.pot).toBe(400);
    expect(game.result?.payouts.human).toBe(400);
    expect(game.players.human.stack).toBe(1200);
    expect(game.players.ai.stack).toBe(800);
    expect(game.pot).toBe(0);
    expect(game.currentBet).toBe(0);
    expect(game.players.human.streetBet).toBe(0);
    expect(game.players.ai.streetBet).toBe(0);
    expectConserved(game, 2000);
  });

  it("calculates call from the amount already invested on the street", () => {
    const game = rigRiver({ actor: "human", humanStack: 800, aiStack: 500, humanContribution: 200, aiContribution: 500, humanStreetBet: 200, aiStreetBet: 500, acted: ["ai"] });
    expect(getLegalActions(game, "human").find((action) => action.type === "call")?.amount).toBe(300);
    applyAction(game, "human", { type: "call" });
    expect([...game.actions].reverse().find((action) => action.player === "human")?.amount).toBe(300);
    expectConserved(game, 2000);
  });

  it("turns a call into a short-stack all-in when only 150 chips remain", () => {
    const game = rigRiver({ actor: "human", humanStack: 150, aiStack: 1150, humanContribution: 200, aiContribution: 500, humanStreetBet: 200, aiStreetBet: 500, acted: ["ai"] });
    expect(getLegalActions(game, "human").find((action) => action.type === "call")?.amount).toBe(150);
    applyAction(game, "human", { type: "call" });
    expect(game.result?.pot).toBe(700);
    expect(game.handLog).toContain("Uncalled 150 returned to AI");
    expectConserved(game, 2000);
  });

  it("returns the 700 chips above effective stack before showdown", () => {
    const game = rigRiver({ actor: "human", humanStack: 1000, aiStack: 300, humanContribution: 0, aiContribution: 0 });
    expect(getLegalActions(game, "human").find((action) => action.type === "all-in")?.amount).toBe(1000);
    applyAction(game, "human", { type: "all-in" });
    expect(game.players.human.stack).toBe(0);
    applyAction(game, "ai", { type: "call" });
    expect(game.handLog).toContain("Uncalled 700 returned to You");
    expect(game.result?.pot).toBe(600);
    expect(game.players.human.stack).toBe(1300);
    expect(game.players.ai.stack).toBe(0);
    expectConserved(game, 1300);
  });

  it("preserves a covering player's remaining stack when calling an opponent all-in", () => {
    const game = rigRiver({ actor: "ai", humanStack: 1000, aiStack: 300, humanContribution: 0, aiContribution: 0 });
    applyAction(game, "ai", { type: "all-in" });
    expect(getLegalActions(game, "human").find((action) => action.type === "call")?.amount).toBe(300);
    applyAction(game, "human", { type: "call" });
    expect(game.result?.pot).toBe(600);
    expect(game.players.human.stack).toBe(1300);
    expect(game.players.ai.stack).toBe(0);
    expectConserved(game, 1300);
  });

  it("returns an uncalled bet before awarding a fold pot", () => {
    const game = createGame(config, fixedRandom(0.23));
    applyAction(game, "human", { type: "raise", amount: 600 });
    applyAction(game, "ai", { type: "fold" });
    expect(game.handLog).toContain("Uncalled 500 returned to You");
    expect(game.result?.pot).toBe(200);
    expect(game.result?.payouts).toEqual({ human: 200, ai: 0 });
    expect(game.players.human.stack).toBe(1100);
    expect(game.players.ai.stack).toBe(900);
    expectConserved(game);
  });

  it("handles a normal bet followed by a fold", () => {
    const game = createGame(config, fixedRandom(0.31));
    reachStreet(game, "flop");
    applyAction(game, "ai", { type: "bet", amount: 200 });
    applyAction(game, "human", { type: "fold" });
    expect(game.result?.pot).toBe(200);
    expect(game.players.ai.stack).toBe(1100);
    expect(game.players.human.stack).toBe(900);
    expectConserved(game);
  });

  it("handles bet-call and raise-call without charging either action twice", () => {
    const betCall = createGame(config, fixedRandom(0.42));
    reachStreet(betCall, "flop");
    applyAction(betCall, "ai", { type: "bet", amount: 200 });
    applyAction(betCall, "human", { type: "call" });
    expect(betCall.players.human.totalContribution).toBe(300);
    expect(betCall.players.ai.totalContribution).toBe(300);
    expect(betCall.pot).toBe(600);
    expectConserved(betCall);

    const raiseCall = createGame(config, fixedRandom(0.51));
    applyAction(raiseCall, "human", { type: "raise", amount: 300 });
    applyAction(raiseCall, "ai", { type: "call" });
    expect(raiseCall.players.human.totalContribution).toBe(300);
    expect(raiseCall.players.ai.totalContribution).toBe(300);
    expect(raiseCall.pot).toBe(600);
    expectConserved(raiseCall);
  });

  it("keeps the pot while resetting street bets between betting rounds", () => {
    const game = createGame(config, fixedRandom(0.56));
    applyAction(game, "human", { type: "raise", amount: 300 });
    applyAction(game, "ai", { type: "call" });
    expect(game.street).toBe("flop");
    expect(game.pot).toBe(600);
    expect(game.players.human.streetBet).toBe(0);
    expect(game.players.ai.streetBet).toBe(0);
    expect(game.players.human.totalContribution).toBe(300);
    expect(game.players.ai.totalContribution).toBe(300);
    expect(game.currentBet).toBe(0);
    expectConserved(game);
  });

  it.each(["preflop", "flop", "turn", "river"] as const)("settles an all-in correctly on the %s", (street) => {
    const game = createGame(config, fixedRandom(0.61));
    if (street !== "preflop") {
      reachStreet(game, street);
      applyAction(game, "ai", { type: "check" });
    }
    applyAction(game, "human", { type: "all-in" });
    applyAction(game, "ai", { type: "call" });
    expect(game.street).toBe("complete");
    expect(game.board).toHaveLength(5);
    expect(game.pot).toBe(0);
    expectConserved(game);
  });

  it("settles all-in versus fold without counting the uncalled amount as winnings", () => {
    const game = createGame(config, fixedRandom(0.67));
    applyAction(game, "human", { type: "all-in" });
    applyAction(game, "ai", { type: "fold" });
    expect(game.handLog).toContain("Uncalled 900 returned to You");
    expect(game.result?.pot).toBe(200);
    expect(game.players.human.stack).toBe(1100);
    expectConserved(game);
  });

  it("splits an all-in pot and defines the odd-chip rule explicitly", () => {
    const board = ["9s", "8d", "7c", "6h", "5s"] as Card[];
    const game = rigRiver({ actor: "human", humanStack: 50, aiStack: 0, humanContribution: 950, aiContribution: 1000, humanStreetBet: 0, aiStreetBet: 50, acted: ["ai"], humanCards: ["2c", "3d"], aiCards: ["4c", "3s"], board });
    applyAction(game, "human", { type: "call" });
    expect(game.result?.winners).toEqual(["human", "ai"]);
    expect(game.result?.payouts).toEqual({ human: 1000, ai: 1000 });
    expect(game.players.human.stack).toBe(1000);
    expect(game.players.ai.stack).toBe(1000);
    expect(allocatePayouts(["human", "ai"], 151, "human")).toEqual({ human: 75, ai: 76 });
    expectConserved(game);
  });

  it("supports a one-chip stack and an exact full-stack call", () => {
    const oneChip = createGame({ ...config, startingStack: 1, smallBlind: 1, bigBlind: 2 }, fixedRandom(0.73));
    expect(oneChip.street).toBe("complete");
    expectConserved(oneChip, 2);

    const exactCall = createGame({ ...config, startingStack: 100 }, fixedRandom(0.79));
    expect(getLegalActions(exactCall, "human").find((action) => action.type === "call")?.amount).toBe(50);
    applyAction(exactCall, "human", { type: "call" });
    expect(exactCall.street).toBe("complete");
    expectConserved(exactCall, 200);
  });

  it("rejects bets above stack and repeat action or payout attempts", () => {
    const game = createGame(config, fixedRandom(0.83));
    expect(() => applyAction(game, "human", { type: "raise", amount: 1001 })).toThrow(/between/);
    applyAction(game, "human", { type: "fold" });
    const snapshot = structuredClone({ human: game.players.human.stack, ai: game.players.ai.stack, pot: game.pot, result: game.result });
    expect(() => applyAction(game, "human", { type: "fold" })).toThrow(/turn/);
    expect({ human: game.players.human.stack, ai: game.players.ai.stack, pot: game.pot, result: game.result }).toEqual(snapshot);
    expectConserved(game);
  });

  it("cannot process rapid repeated all-in or call actions twice", () => {
    const game = rigRiver({ actor: "ai", humanStack: 1000, aiStack: 300, humanContribution: 0, aiContribution: 0 });
    applyAction(game, "ai", { type: "all-in" });
    const afterAllIn = structuredClone({ human: game.players.human.stack, ai: game.players.ai.stack, pot: game.pot });
    expect(() => applyAction(game, "ai", { type: "all-in" })).toThrow(/turn/);
    expect({ human: game.players.human.stack, ai: game.players.ai.stack, pot: game.pot }).toEqual(afterAllIn);
    applyAction(game, "human", { type: "call" });
    const afterCall = structuredClone({ human: game.players.human.stack, ai: game.players.ai.stack, pot: game.pot, result: game.result });
    expect(() => applyAction(game, "human", { type: "call" })).toThrow(/turn/);
    expect({ human: game.players.human.stack, ai: game.players.ai.stack, pot: game.pot, result: game.result }).toEqual(afterCall);
    expectConserved(game);
  });

  it("conserves chips across several sequential hands", () => {
    const game = createGame(config, fixedRandom(0.89));
    for (let hand = 1; hand <= 12; hand += 1) {
      expect(game.handNumber).toBe(hand);
      applyAction(game, game.actor!, { type: "fold" });
      expect(game.pot).toBe(0);
      expectConserved(game);
      if (hand < 12) startNextHand(game, fixedRandom(0.89 - hand / 100));
    }
  });

  it("server-side turn validation makes rapid duplicate actions and payouts idempotent", () => {
    const store = new SessionStore();
    const session = store.create(config);
    store.act(session, { type: "fold" });
    const afterPayout = session.state.players.human.stack + session.state.players.ai.stack;
    expect(() => store.act(session, { type: "fold" })).toThrow(/turn/);
    expect(session.state.players.human.stack + session.state.players.ai.stack).toBe(afterPayout);
    expectConserved(session.state);

    startNextHand(session.state, fixedRandom(0.91));
    expect(() => startNextHand(session.state, fixedRandom(0.91))).toThrow(/not complete/);
    expectConserved(session.state);
  });

  it("fails loudly when a debug accounting invariant is corrupted", () => {
    const game = createGame(config, fixedRandom(0.97));
    game.players.human.stack += 1;
    expect(() => assertChipAccounting(game, "intentional corruption")).toThrow(/stacks \+ pot/);
  });
});
