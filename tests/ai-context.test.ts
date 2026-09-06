import { describe, expect, it } from "vitest";
import { applyAction, createGame, startNextHand } from "../poker-engine/game";
import type { Card, GameConfig, PlayerId } from "../shared/types";
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
    expect(context.contextMetrics).toMatchObject({
      effectiveStackBB: 100,
      amountToCallBB: 2,
      potBB: 4,
      aiCommittedBB: 1,
      humanCommittedBB: 3,
      committedFractionOfEffectiveStack: 0.01,
      minimumRaiseTo: 500,
      minimumRaiseToBB: 5,
      minimumRaiseIncrementBB: 2,
      remainingStackAfterCall: 9_700,
      remainingStackAfterMinimumRaise: 9_500,
    });
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

  it("ignores one or several all-in seats when determining postflop position", () => {
    const game = createGame({ ...config, opponentCount: 3 }, () => 0);
    game.street = "flop";

    expect(deriveAIContext(game, "ai-3").contextMetrics.isInPositionPostflop).toBe(false);
    game.players.human.allIn = true;
    expect(deriveAIContext(game, "ai-3").contextMetrics.isInPositionPostflop).toBe(true);

    game.players["ai-3"].allIn = true;
    expect(deriveAIContext(game, "ai-2").contextMetrics.isInPositionPostflop).toBe(true);
  });

  it("uses the latest aggressor rather than the largest stack in a three-way context", () => {
    const game = createGame({ ...config, opponentCount: 2 }, () => 0);
    setPlayerTotals(game, { human: 12_000, ai: 11_000, "ai-2": 7_000 });
    applyAction(game, "human", { type: "call" });
    applyAction(game, "ai", { type: "call" });
    applyAction(game, "ai-2", { type: "raise", amount: 300 });
    applyAction(game, "human", { type: "call" });

    const context = deriveAIContext(game, "ai");
    expect(context.contextMetrics.lastAction).toMatchObject({ player: "human", action: "call" });
    expect(context).toMatchObject({
      amountToCall: 200,
      effectiveStack: 6_700,
      contextMetrics: {
        relevantAggressor: "ai-2",
        relevantAggressorStack: 6_700,
        relevantAggressorStreetBet: 300,
        relevantAggressorContribution: 300,
        relevantEffectiveStack: 7_000,
        relevantEffectiveStackBB: 70,
        playerStreetBet: 300,
      },
    });
  });

  it("keeps the relevant aggressor in a four-way context after a later fold", () => {
    const game = createGame({ ...config, opponentCount: 3 }, () => 0);
    setPlayerTotals(game, { human: 11_000, ai: 8_000, "ai-2": 14_000, "ai-3": 7_000 });
    applyAction(game, "ai-3", { type: "raise", amount: 400 });
    applyAction(game, "human", { type: "fold" });

    const context = deriveAIContext(game, "ai");
    expect(context.contextMetrics.lastAction).toMatchObject({ player: "human", action: "fold" });
    expect(context).toMatchObject({
      amountToCall: 350,
      effectiveStack: 6_600,
      contextMetrics: {
        relevantAggressor: "ai-3",
        relevantAggressorStack: 6_600,
        relevantAggressorStreetBet: 400,
        relevantAggressorContribution: 400,
        relevantEffectiveStack: 7_000,
        relevantEffectiveStackBB: 70,
      },
    });
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

function setPlayerTotals(game: ReturnType<typeof createGame>, totals: Partial<Record<PlayerId, number>>): void {
  for (const [id, total] of Object.entries(totals)) {
    const current = game.players[id]!;
    current.stack = total - current.totalContribution;
    current.allIn = current.stack === 0;
  }
}
