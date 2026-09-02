import { describe, expect, it } from "vitest";
import { applyAction, getLegalActions, startNextHand } from "../poker-engine/game";
import type { AIVisibleGameState, AdaptiveHandSummary, Card, PlayerProfile, RepeatedPlayerPattern } from "../shared/types";
import { buildAdaptiveHandSummary, findRepeatedPlayerPatterns } from "../server/adaptiveHistory";
import { deriveAdaptivePolicy } from "../server/ai/adaptivePolicy";
import { calibrateAdaptiveDecision } from "../server/ai/adaptiveGuard";
import { dummyDecision } from "../server/ai/dummyBot";
import { SessionStore } from "../server/session";

const config = {
  language: "en" as const, startingStack: 10_000, smallBlind: 50, bigBlind: 100,
  strategy: "adaptive" as const, difficulty: "expert" as const, tableTalk: false, coachMode: false, debugMode: false,
};
const baseProfile = new SessionStore().create(config, () => 0).tracker.profile();
const profile = (overrides: Partial<PlayerProfile>): PlayerProfile => ({
  ...baseProfile,
  hands: 40,
  foldOpportunities: 24,
  wentToShowdownOpportunities: 18,
  wonAtShowdownOpportunities: 10,
  ...overrides,
});
const neutral = profile({ vpip: 32, pfr: 23, threeBet: 8, foldFrequency: 45, wentToShowdown: 34, wonAtShowdown: 50 });
const aggressive = profile({
  vpip: 62, pfr: 52, threeBet: 24, foldFrequency: 24,
  flopCBet: 82, flopCBetOpportunities: 18, turnBarrel: 76, turnBarrelOpportunities: 12,
  riverAggression: 70, riverOpportunities: 10, checkRaise: 30, checkRaiseOpportunities: 10,
});

const fixedRandom = (fraction: number) => (upperExclusive: number) => Math.min(upperExclusive - 1, Math.floor(fraction * upperExclusive));
const seeded = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
};

function reachableFacingState(raiseTo: number, randomFraction: number, playerProfile: PlayerProfile, patterns: RepeatedPlayerPattern[] = []): AIVisibleGameState {
  const store = new SessionStore();
  const session = store.create(config, fixedRandom(randomFraction));
  applyAction(session.state, "human", { type: "raise", amount: raiseTo });
  const visible = store.aiVisibleState(session);
  expect(visible.legalActions).toEqual(getLegalActions(session.state, "ai"));
  return {
    ...visible,
    playerProfile,
    repeatedPlayerPatterns: patterns,
    counterStrategy: deriveAdaptivePolicy(playerProfile, patterns),
  };
}

function frequencies(state: AIVisibleGameState, trials = 4_000): Record<string, number> {
  const random = seeded(0x5eed);
  const counts: Record<string, number> = { fold: 0, call: 0, raise: 0, "all-in": 0 };
  for (let index = 0; index < trials; index += 1) {
    const action = dummyDecision(state, "adaptive", false, "en", random).action;
    counts[action] = (counts[action] ?? 0) + 1;
  }
  return counts;
}

function realAggressiveHistories(count: number): AdaptiveHandSummary[] {
  const store = new SessionStore();
  const session = store.create(config, fixedRandom(0.4));
  const summaries: AdaptiveHandSummary[] = [];
  for (let hand = 0; hand < count; hand += 1) {
    if (session.state.actor === "ai") applyAction(session.state, "ai", { type: "call" });
    const humanRaise = getLegalActions(session.state, "human").find((action) => action.type === "raise")!;
    applyAction(session.state, "human", { type: "raise", amount: humanRaise.min });
    applyAction(session.state, "ai", { type: "fold" });
    summaries.unshift(buildAdaptiveHandSummary(session.state));
    if (hand + 1 < count) startNextHand(session.state, fixedRandom(0.4 + hand / 100));
  }
  return summaries;
}

describe("Adaptive over-fold regressions using reachable engine states", () => {
  it("builds confidence progressively over eight real repeated preflop pressure lines", () => {
    const histories = realAggressiveHistories(8);
    const confidence = Array.from({ length: 8 }, (_, index) => {
      const hands = histories.slice(8 - index - 1);
      const measured = profile({ hands: index + 1, vpip: 100, pfr: 100, foldOpportunities: 0 });
      return deriveAdaptivePolicy(measured, findRepeatedPlayerPatterns(hands)).confidence;
    });
    expect(confidence[0]).toBeLessThan(0.1);
    for (let index = 1; index < confidence.length; index += 1) expect(confidence[index]).toBeGreaterThan(confidence[index - 1]);
    expect(confidence.at(-1)).toBeGreaterThan(0.65);
  });

  it.each([200, 600, 3_000])("defends wider against confirmed aggression for a reachable raise to %i", (raiseTo) => {
    const patterns = findRepeatedPlayerPatterns(realAggressiveHistories(8));
    const neutralResult = frequencies(reachableFacingState(raiseTo, 0.8, neutral));
    const adaptedResult = frequencies(reachableFacingState(raiseTo, 0.8, aggressive, patterns));
    expect(adaptedResult.fold).toBeLessThan(neutralResult.fold);
    expect(adaptedResult.call + adaptedResult.raise + adaptedResult["all-in"]).toBeGreaterThan(
      neutralResult.call + neutralResult.raise + neutralResult["all-in"],
    );
  });

  it("almost never folds a premium reachable hand and counter-raises or shoves", () => {
    const normal = frequencies(reachableFacingState(600, 0.5, aggressive)); // deterministic A♥ K♥
    const huge = frequencies(reachableFacingState(9_000, 0.5, aggressive));
    expect(normal.fold).toBe(0);
    expect(normal.raise).toBe(4_000);
    expect(huge.fold).toBe(0);
    expect(huge["all-in"]).toBe(4_000);
  });

  it("still folds genuine trash at a meaningful frequency against a large raise", () => {
    const result = frequencies(reachableFacingState(3_000, 0.8, aggressive)); // deterministic 3♣ 2♣
    expect(result.fold).toBeGreaterThan(1_000);
    expect(result.call + result.raise).toBeGreaterThan(0);
  });

  it("calibrates model folds by real raise size without making defense unconditional", () => {
    const modelFold = { action: "fold" as const, amount: 0, reasoning_summary: "Fold.", table_talk: "" };
    const small = reachableFacingState(200, 0.6, aggressive);
    const normal = reachableFacingState(600, 0.6, aggressive);
    const large = reachableFacingState(3_000, 0.6, aggressive);
    expect(calibrateAdaptiveDecision(modelFold, small, "adaptive").decision.action).toBe("call");
    expect(calibrateAdaptiveDecision(modelFold, normal, "adaptive").decision.action).toBe("call");
    expect(calibrateAdaptiveDecision(modelFold, large, "adaptive").decision.action).toBe("fold");

    for (const raiseTo of [200, 600, 3_000]) {
      const trash = reachableFacingState(raiseTo, 0.8, aggressive);
      expect(calibrateAdaptiveDecision(modelFold, trash, "adaptive").decision.action).toBe("fold");
    }
  });

  it("overrides a model fold with a re-raise or all-in for reachable premium states", () => {
    const modelFold = { action: "fold" as const, amount: 0, reasoning_summary: "Fold.", table_talk: "" };
    expect(calibrateAdaptiveDecision(modelFold, reachableFacingState(600, 0.5, aggressive), "adaptive").decision.action).toBe("raise");
    expect(calibrateAdaptiveDecision(modelFold, reachableFacingState(9_000, 0.5, aggressive), "adaptive").decision.action).toBe("all-in");
  });
});
