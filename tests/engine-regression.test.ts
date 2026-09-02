import { describe, expect, it } from "vitest";
import { applyAction, assertChipAccounting, createGame, getLegalActions, startNextHand } from "../poker-engine/game";
import type { GameConfig } from "../shared/types";
import { StatsTracker } from "../server/stats";
import { SessionStore } from "../server/session";

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
    expect(getLegalActions(game, "human").some((action) => action.type === "raise")).toBe(true);
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
    expect(game.actions.at(-1)).toMatchObject({ effectiveAmount: 350, aggressive: true });
    expect(getLegalActions(game, "human").map((action) => action.type)).toEqual(["fold", "call"]);
    expect(game.actor).toBe("human");

    applyAction(game, "human", { type: "call" });
    expect(game.street).toBe("complete");
    expect(game.players.human.stack + game.players.ai.stack).toBe(2_000);
    expect(() => applyAction(game, "human", { type: "call" })).toThrow(/turn/);
  });

  it("classifies an all-in consisting only of uncallable excess as a non-aggressive call", () => {
    const store = new SessionStore();
    const session = store.create(config, () => 0);
    const game = session.state;
    applyAction(game, "human", { type: "fold" });
    startNextHand(game, () => 0);
    game.players.ai.stack = 250;
    game.players.human.stack = 1_600;
    assertChipAccounting(game, "effective all-in fixture");

    applyAction(game, "ai", { type: "all-in" });
    store.act(session, { type: "all-in" });
    const humanAction = game.actions.find((action) => action.player === "human" && action.action === "all-in")!;
    expect(humanAction).toMatchObject({ amount: 1_700, effectiveAmount: 300, aggressive: false });

    expect(session.tracker.profile()).toMatchObject({ vpip: 100, pfr: 0, threeBet: 0, aggressionFactor: 0 });
    expect(session.adaptiveHands[0].playerLineTags).not.toContain("preflop-aggression");
  });

  it("uses only the covered portion of an aggressive all-in for statistical sizing", () => {
    const game = createGame(config, () => 0);
    game.players.human.stack = 1_650;
    game.players.ai.stack = 200;
    assertChipAccounting(game, "covered all-in fixture");
    applyAction(game, "human", { type: "all-in" });
    const action = game.actions.at(-1)!;
    expect(action).toMatchObject({ amount: 1_700, effectiveAmount: 300, aggressive: true });
    applyAction(game, "ai", { type: "call" });

    const tracker = new StatsTracker(config.startingStack, config.bigBlind);
    tracker.observe({ player: "human", action: "all-in", street: "preflop", amount: action.effectiveAmount, isAggressive: true, facingBet: true });
    tracker.finish(game);
    expect(tracker.profile()).toMatchObject({ pfr: 100, threeBet: 0, averageBetSize: 300 });
  });

  it("rejects a raise below the current full-raise minimum without mutating state", () => {
    const game = createGame(config, () => 0);
    applyAction(game, "human", { type: "raise", amount: 300 });
    const snapshot = structuredClone(game);
    expect(() => applyAction(game, "ai", { type: "raise", amount: 499 })).toThrow(/between 500/);
    expect(game).toEqual(snapshot);
  });
});
