import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "../poker-engine/game";
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

  it.each([
    [["Ah", "Kh", "Qh"] as Card[], { monotone: true, twoTone: false, broadwayCards: 3, connectedness: 3 }],
    [["9s", "9d", "8s", "7c"] as Card[], { paired: true, trips: false, twoTone: false, connectedness: 3 }],
    [["Ac", "Ad", "Ah", "2s", "3d"] as Card[], { paired: true, trips: true, highCard: 14 }],
  ])("derives stable board texture metrics for %j", (board, expected) => {
    const game = createGame(config, () => 0);
    game.board = board;
    expect(deriveBoardMetrics(game)).toMatchObject(expected);
  });
});
