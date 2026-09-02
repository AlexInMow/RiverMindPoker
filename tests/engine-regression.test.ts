import { describe, expect, it } from "vitest";
import { applyAction, assertChipAccounting, createGame, getLegalActions } from "../poker-engine/game";
import type { GameConfig } from "../shared/types";

const config: GameConfig = {
  language: "ru", startingStack: 1_000, smallBlind: 50, bigBlind: 100,
  strategy: "balanced", difficulty: "strong", tableTalk: false, coachMode: false, debugMode: false,
};

describe("poker engine betting regressions", () => {
  it("preserves full-raise sizing through open raise, 3-bet, and 4-bet", () => {
    const game = createGame(config, () => 0);
    applyAction(game, "human", { type: "raise", amount: 300 });
    expect(getLegalActions(game, "ai").find((action) => action.type === "raise")?.min).toBe(500);
    applyAction(game, "ai", { type: "raise", amount: 500 });
    expect(getLegalActions(game, "human").find((action) => action.type === "raise")?.min).toBe(700);
    applyAction(game, "human", { type: "raise", amount: 700 });
    expect(game.minRaise).toBe(200);
    assertChipAccounting(game, "raise ladder regression");
  });

  it("accepts a short all-in raise, preserves the prior minimum raise, and settles once", () => {
    const game = createGame(config, () => 0);
    applyAction(game, "human", { type: "raise", amount: 300 });
    game.players.ai.stack = 250;
    game.players.human.stack = 1_350;
    assertChipAccounting(game, "short all-in fixture");

    applyAction(game, "ai", { type: "all-in" });
    expect(game.currentBet).toBe(350);
    expect(game.minRaise).toBe(200);
    expect(game.actions.at(-1)).toMatchObject({ player: "ai", action: "all-in", amount: 350 });
    expect(getLegalActions(game, "human").map((action) => action.type)).toEqual(["fold", "call", "all-in"]);

    applyAction(game, "human", { type: "call" });
    expect(game.street).toBe("complete");
    expect(game.players.human.stack + game.players.ai.stack).toBe(2_000);
    expect(() => applyAction(game, "human", { type: "call" })).toThrow(/turn/);
  });

  it("rejects a raise below the current full-raise minimum without mutating state", () => {
    const game = createGame(config, () => 0);
    applyAction(game, "human", { type: "raise", amount: 300 });
    const snapshot = structuredClone(game);
    expect(() => applyAction(game, "ai", { type: "raise", amount: 499 })).toThrow(/between 500/);
    expect(game).toEqual(snapshot);
  });
});
