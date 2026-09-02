import { describe, expect, it } from "vitest";
import { applyAction, createGame, startNextHand } from "../poker-engine/game";
import type { Card, GameConfig } from "../shared/types";
import { deriveAIContext, deriveBoardMetrics } from "../server/ai/context";

const config: GameConfig = {
  language: "ru", startingStack: 10_000, smallBlind: 50, bigBlind: 100,
  strategy: "adaptive", difficulty: "expert", tableTalk: false, coachMode: false, debugMode: false,
};

describe("deterministic AI context", () => {
  it("computes amount to call, pot odds, effective stack, SPR and bet level without mutation", () => {
    const game = createGame(config, () => 0);
    applyAction(game, "human", { type: "raise", amount: 300 });
    const snapshot = structuredClone(game);
    const context = deriveAIContext(game);
    expect(context).toMatchObject({
      amountToCall: 200,
      potOdds: 0.3333,
      effectiveStack: 9_700,
      spr: 24.25,
      contextMetrics: { facingAggression: true, preflopBetLevel: 2, isInPositionPostflop: false },
    });
    expect(context.contextMetrics.lastAction).toMatchObject({ player: "human", action: "raise", amount: 300 });
    expect(game).toEqual(snapshot);
  });

  it("does not classify completing the small blind as facing aggression", () => {
    const game = createGame(config, () => 0);
    applyAction(game, "human", { type: "fold" });
    startNextHand(game, () => 0);
    const context = deriveAIContext(game);
    expect(game.button).toBe("ai");
    expect(context.amountToCall).toBe(50);
    expect(context.contextMetrics.facingAggression).toBe(false);
  });

  it.each([
    [["Ah", "Kh", "Qh"] as Card[], { monotone: true, twoTone: false, broadwayCards: 3, connectedness: 3 }],
    [["9s", "9d", "8s", "7c"] as Card[], { paired: true, trips: false, twoTone: false, connectedness: 3 }],
    [["5s", "7d", "9s", "Kc"] as Card[], { twoTone: false, connectedness: 3 }],
    [["2s", "7d", "Qd", "Ac"] as Card[], { twoTone: false, connectedness: 2 }],
    [["2s", "5d", "9s", "Kd"] as Card[], { twoTone: true, connectedness: 2 }],
    [["Ac", "Ad", "Ah", "2s", "3d"] as Card[], { paired: true, trips: true, highCard: 14 }],
  ])("derives stable board texture metrics for %j", (board, expected) => {
    const game = createGame(config, () => 0);
    game.board = board;
    expect(deriveBoardMetrics(game)).toMatchObject(expected);
  });
});
