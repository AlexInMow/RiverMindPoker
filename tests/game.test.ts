import { describe, expect, it } from "vitest";
import { applyAction, buildSidePots, createGame, getLegalActions, startNextHand } from "../poker-engine/game";
import type { GameConfig, PlayerId } from "../shared/types";

const config: GameConfig = {
  language: "ru", startingStack: 10000, smallBlind: 50, bigBlind: 100, strategy: "balanced", difficulty: "strong", tableTalk: false, coachMode: false, debugMode: false,
};

describe("heads-up engine", () => {
  it("posts blinds and gives the button first action preflop", () => {
    const game = createGame(config, () => 0.42);
    expect(game.button).toBe("human");
    expect(game.actor).toBe("human");
    expect(game.pot).toBe(150);
    expect(game.players.human.stack).toBe(9950);
    expect(game.players.ai.stack).toBe(9900);
    expect(getLegalActions(game, "human").map((action) => action.type)).toEqual(expect.arrayContaining(["fold", "call", "raise", "all-in"]));
  });

  it("awards the full pot on a fold without using the evaluator", () => {
    const game = createGame(config, () => 0.2);
    applyAction(game, "human", { type: "fold" });
    expect(game.street).toBe("complete");
    expect(game.result?.winners).toEqual(["ai"]);
    expect(game.players.ai.stack).toBe(10050);
    expect(game.players.human.stack).toBe(9950);
  });

  it("plays every street to deterministic showdown and conserves chips", () => {
    const game = createGame(config, () => 0.33);
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
    const game = createGame(short, () => 0.71);
    applyAction(game, "human", { type: "all-in" });
    expect(game.actor).toBe("ai");
    applyAction(game, "ai", { type: "call" });
    expect(game.street).toBe("complete");
    expect(game.board).toHaveLength(5);
    expect(game.players.human.stack + game.players.ai.stack).toBe(2000);
  });

  it("rotates the button after a completed hand", () => {
    const game = createGame(config, () => 0.17);
    applyAction(game, "human", { type: "fold" });
    startNextHand(game, () => 0.8);
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
});
