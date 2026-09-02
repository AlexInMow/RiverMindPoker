import { describe, expect, it } from "vitest";
import { createDeck } from "../poker-engine/cards";
import { allocatePayouts, applyAction, buildSidePots, createGame, getLegalActions, startNextHand } from "../poker-engine/game";
import type { Card, GameConfig, PlayerId } from "../shared/types";

const config: GameConfig = {
  language: "ru", startingStack: 10000, smallBlind: 50, bigBlind: 100, strategy: "balanced", difficulty: "strong", tableTalk: false, coachMode: false, debugMode: false,
};

const cards = (...values: Card[]) => values;
const fixedRandom = (fraction: number) => (upperExclusive: number) => Math.min(upperExclusive - 1, Math.floor(fraction * upperExclusive));

function rigRiverShowdown(humanCards: Card[], aiCards: Card[], board: Card[], pot = 150) {
  const game = createGame(config, fixedRandom(0.42));
  game.players.human.cards = humanCards;
  game.players.ai.cards = aiCards;
  game.board = board;
  const used = new Set([...humanCards, ...aiCards, ...board]);
  const available = createDeck().filter((card) => !used.has(card));
  game.burnCards = available.splice(0, 3);
  game.deck = available;
  game.cardsDrawn = 12;
  game.validatedCardsDrawn = 12;
  game.initialHoleCards = { human: [...humanCards], ai: [...aiCards] };
  game.street = "river";
  game.actor = "human";
  game.currentBet = 0;
  game.players.human.streetBet = 0;
  game.players.ai.streetBet = 0;
  game.players.human.totalContribution = Math.floor(pot / 2);
  game.players.ai.totalContribution = Math.floor(pot / 2);
  game.players.human.stack = config.startingStack - Math.floor(pot / 2);
  game.players.ai.stack = config.startingStack - Math.floor(pot / 2);
  game.pot = Math.floor(pot / 2) * 2;
  game.acted = ["ai"];
  applyAction(game, "human", { type: "check" });
  return game;
}

describe("heads-up engine", () => {
  it("posts blinds and gives the button first action preflop", () => {
    const game = createGame(config, fixedRandom(0.42));
    expect(game.button).toBe("human");
    expect(game.actor).toBe("human");
    expect(game.pot).toBe(150);
    expect(game.players.human.stack).toBe(9950);
    expect(game.players.ai.stack).toBe(9900);
    expect(getLegalActions(game, "human").map((action) => action.type)).toEqual(expect.arrayContaining(["fold", "call", "raise", "all-in"]));
  });

  it("awards the full pot on a fold without using the evaluator", () => {
    const game = createGame(config, fixedRandom(0.2));
    applyAction(game, "human", { type: "fold" });
    expect(game.street).toBe("complete");
    expect(game.result?.winners).toEqual(["ai"]);
    expect(game.players.ai.stack).toBe(10050);
    expect(game.players.human.stack).toBe(9950);
  });

  it("plays every street to deterministic showdown and conserves chips", () => {
    const game = createGame(config, fixedRandom(0.33));
    applyAction(game, "human", { type: "call" });
    applyAction(game, "ai", { type: "check" });
    for (let street = 0; street < 3; street += 1) {
      expect(game.actor).toBe("ai");
      applyAction(game, "ai", { type: "check" });
      applyAction(game, "human", { type: "check" });
    }
    expect(game.street).toBe("complete");
    expect(game.board).toHaveLength(5);
    expect(game.result?.humanHand).toBeTruthy();
    expect(game.result?.aiHand).toBeTruthy();
    expect(game.players.human.stack + game.players.ai.stack).toBe(20000);
  });

  it("runs out the board after an all-in is called", () => {
    const short = { ...config, startingStack: 1000 };
    const game = createGame(short, fixedRandom(0.71));
    applyAction(game, "human", { type: "all-in" });
    expect(game.actor).toBe("ai");
    applyAction(game, "ai", { type: "call" });
    expect(game.street).toBe("complete");
    expect(game.board).toHaveLength(5);
    expect(game.players.human.stack + game.players.ai.stack).toBe(2000);
  });

  it("rotates the button after a completed hand", () => {
    const game = createGame(config, fixedRandom(0.17));
    applyAction(game, "human", { type: "fold" });
    startNextHand(game, fixedRandom(0.8));
    expect(game.handNumber).toBe(2);
    expect(game.button).toBe("ai");
    expect(game.actor).toBe("ai");
  });

  it("builds contribution layers for future side pots", () => {
    const pots = buildSidePots([
      { id: "human" as PlayerId, amount: 200, folded: false },
      { id: "ai" as PlayerId, amount: 500, folded: false },
    ]);
    expect(pots).toEqual([{ amount: 400, eligible: ["human", "ai"] }, { amount: 300, eligible: ["ai"] }]);
  });

  it("resolves the third-kicker regression through the complete showdown path", () => {
    const game = rigRiverShowdown(
      cards("Jd", "8h"),
      cards("Jh", "3d"),
      cards("As", "6c", "9c", "7c", "Ad"),
    );
    expect(game.result?.winners).toEqual(["human"]);
    expect(game.result?.humanScore?.rankValues).toEqual([14, 11, 9, 8]);
    expect(game.result?.aiScore?.rankValues).toEqual([14, 11, 9, 7]);
    expect(game.result?.showdownDetail).toMatchObject({ reason: "kicker", category: 1, decisiveIndex: 3, winningRank: 8, losingRank: 7 });
  });

  it.each([
    ["straight", cards("9s", "8d", "7c", "6h", "5s")],
    ["flush", cards("Ah", "Jh", "8h", "5h", "2h")],
    ["full house", cards("As", "Ad", "Ac", "Kh", "Ks")],
  ])("splits a board-only %s and records identical rank vectors", (_name, board) => {
    const game = rigRiverShowdown(cards("2c", "3d"), cards("4c", "3s"), board);
    expect(game.result?.winners).toEqual(["human", "ai"]);
    expect(game.result?.humanScore?.rankValues).toEqual(game.result?.aiScore?.rankValues);
    expect(game.players.human.stack + game.players.ai.stack).toBe(config.startingStack * 2);
  });

  it("gives an odd split-pot chip to the first seat left of the button", () => {
    expect(allocatePayouts(["human", "ai"], 151, "human")).toEqual({ human: 75, ai: 76 });
    expect(allocatePayouts(["human", "ai"], 151, "ai")).toEqual({ human: 76, ai: 75 });
  });

  it("commits the full stack on all-in, then refunds unmatched chips", () => {
    const game = createGame({ ...config, startingStack: 1000 }, fixedRandom(0.17));
    game.players.human.stack = 1450;
    game.players.ai.stack = 400;
    applyAction(game, "human", { type: "all-in" });
    expect(game.players.human.stack).toBe(0);
    expect(game.players.human.streetBet).toBe(1500);
    expect(game.actions.at(-1)).toMatchObject({ player: "human", action: "all-in", amount: 1500 });
    expect(getLegalActions(game, "ai").find((action) => action.type === "call")?.amount).toBe(400);
    applyAction(game, "ai", { type: "call" });
    expect(game.street).toBe("complete");
    expect(game.pot).toBe(0);
    expect(game.result?.pot).toBe(1000);
    expect(game.players.human.stack + game.players.ai.stack).toBe(2000);
    expect(game.players.human.stack).toBeGreaterThanOrEqual(0);
    expect(game.players.ai.stack).toBeGreaterThanOrEqual(0);
  });

  it("rejects overbets, fractional bets, repeat actions and invalid contributions", () => {
    const game = createGame(config, fixedRandom(0.26));
    expect(() => applyAction(game, "human", { type: "raise", amount: 10001 })).toThrow(/between/);
    expect(() => applyAction(game, "human", { type: "raise", amount: 250.5 })).toThrow(/whole-chip/);
    applyAction(game, "human", { type: "fold" });
    const stacks = game.players.human.stack + game.players.ai.stack;
    expect(() => applyAction(game, "human", { type: "fold" })).toThrow();
    expect(game.players.human.stack + game.players.ai.stack).toBe(stacks);
    expect(() => buildSidePots([{ id: "human", amount: -1, folded: false }])).toThrow(/non-negative/);
  });

  it("preserves chip, deck and street invariants across 500 randomized hands", () => {
    let seed = 0xdecafbad;
    const random = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 0x100000000;
    };
    const total = 2000;
    for (let hand = 0; hand < 500; hand += 1) {
      const game = createGame({ ...config, startingStack: 1000 }, (upperExclusive) => Math.floor(random() * upperExclusive));
      let actions = 0;
      while (game.street !== "complete" && actions < 100) {
        const actor = game.actor!;
        const legal = getLegalActions(game, actor);
        expect(legal.length).toBeGreaterThan(0);
        const selected = legal[Math.floor(random() * legal.length)];
        const amount = selected.type === "bet" || selected.type === "raise"
          ? Math.floor(selected.min! + random() * (selected.max! - selected.min! + 1))
          : undefined;
        applyAction(game, actor, { type: selected.type, amount });
        expect(game.players.human.stack).toBeGreaterThanOrEqual(0);
        expect(game.players.ai.stack).toBeGreaterThanOrEqual(0);
        expect(game.pot).toBeGreaterThanOrEqual(0);
        expect(game.players.human.stack + game.players.ai.stack + game.pot).toBe(total);
        const visibleCards = [...game.players.human.cards, ...game.players.ai.cards, ...game.board];
        expect(new Set(visibleCards).size).toBe(visibleCards.length);
        if (game.street === "preflop") expect(game.board).toHaveLength(0);
        if (game.street === "flop") expect(game.board).toHaveLength(3);
        if (game.street === "turn") expect(game.board).toHaveLength(4);
        if (game.street === "river") expect(game.board).toHaveLength(5);
        actions += 1;
      }
      expect(game.street).toBe("complete");
      expect(game.players.human.stack + game.players.ai.stack).toBe(total);
    }
  });
});
