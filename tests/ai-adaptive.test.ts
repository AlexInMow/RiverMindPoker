import { describe, expect, it } from "vitest";
import type { AIVisibleGameState, PlayerProfile } from "../shared/types";
import { applyAction } from "../poker-engine/game";
import { SessionStore } from "../server/session";
import { dummyDecision } from "../server/ai/dummyBot";
import { deriveAdaptivePolicy } from "../server/ai/adaptivePolicy";
import { decisionInstructions } from "../server/ai/prompts";

const store = new SessionStore();
const config = {
  language: "en" as const, startingStack: 10_000, smallBlind: 50, bigBlind: 100,
  strategy: "adaptive" as const, difficulty: "expert" as const, tableTalk: false, coachMode: false, debugMode: false,
};
const emptyProfile = store.create(config, () => 0).tracker.profile();

function profile(overrides: Partial<PlayerProfile>): PlayerProfile {
  return { ...emptyProfile, hands: 50, foldOpportunities: 30, ...overrides };
}

const aggressiveProfile = profile({
  vpip: 58, pfr: 43, threeBet: 24, foldFrequency: 24, flopCBet: 82,
  flopCBetOpportunities: 22, riverAggression: 72, riverOpportunities: 12, wentToShowdown: 32,
});
const nitProfile = profile({
  vpip: 16, pfr: 10, threeBet: 3, foldFrequency: 76, foldToThreeBet: 78,
  foldToThreeBetOpportunities: 9, foldToCBet: 81, foldToCBetOpportunities: 16, wentToShowdown: 20,
});
const callingStationProfile = profile({
  vpip: 64, pfr: 9, threeBet: 2, foldFrequency: 17, wentToShowdown: 61, wonAtShowdown: 39,
});

const fixedRandom = (fraction: number) => (upperExclusive: number) => Math.min(upperExclusive - 1, Math.floor(fraction * upperExclusive));

function visible(profileValue: PlayerProfile, randomFraction = 0.8, facing = true, raiseTo = 600): AIVisibleGameState {
  const localStore = new SessionStore();
  const session = localStore.create(config, fixedRandom(randomFraction));
  if (facing) applyAction(session.state, "human", { type: "raise", amount: raiseTo });
  else {
    applyAction(session.state, "human", { type: "call" });
    applyAction(session.state, "ai", { type: "check" });
  }
  const state = localStore.aiVisibleState(session);
  return {
    ...state,
    playerProfile: profileValue,
    counterStrategy: deriveAdaptivePolicy(profileValue, state.repeatedPlayerPatterns),
  };
}

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function simulate(state: AIVisibleGameState, trials = 2_000): Record<string, number> {
  const random = seeded(0xc0ffee);
  const counts: Record<string, number> = { fold: 0, call: 0, raise: 0, check: 0, bet: 0 };
  for (let trial = 0; trial < trials; trial += 1) {
    const decision = dummyDecision(state, "adaptive", false, "en", random);
    counts[decision.action] = (counts[decision.action] ?? 0) + 1;
  }
  return counts;
}

describe("Adaptive local bot", () => {
  it("classifies aggressive, nit, and calling-station samples with full confidence", () => {
    expect(deriveAdaptivePolicy(aggressiveProfile).opponentType).toBe("aggressive");
    expect(deriveAdaptivePolicy(nitProfile).opponentType).toBe("nit");
    expect(deriveAdaptivePolicy(callingStationProfile).opponentType).toBe("calling-station");
    expect(deriveAdaptivePolicy(callingStationProfile).confidence).toBeGreaterThan(0.45);
  });

  it("uses repeated pressure lines when aggregate rates alone look balanced", () => {
    const balanced = profile({ vpip: 31, pfr: 23, threeBet: 8, foldFrequency: 45 });
    const policy = deriveAdaptivePolicy(balanced, [{
      pattern: "preflop-aggression+flop-pressure", occurrences: 4, handNumbers: [9, 7, 5, 2],
    }]);
    expect(policy.opponentType).toBe("aggressive");
  });

  it("weights each metric by its own opportunities and grows confidence gradually", () => {
    const sparse = profile({ vpip: 31, pfr: 20, foldFrequency: 100, foldOpportunities: 2 });
    const medium = profile({ vpip: 31, pfr: 20, foldFrequency: 100, foldOpportunities: 8 });
    const established = profile({ vpip: 31, pfr: 20, foldFrequency: 100, foldOpportunities: 24 });
    const sparsePolicy = deriveAdaptivePolicy(sparse);
    const mediumPolicy = deriveAdaptivePolicy(medium);
    const establishedPolicy = deriveAdaptivePolicy(established);
    expect(sparsePolicy.opponentType).not.toBe("nit");
    expect(sparsePolicy.metricConfidence.facingBet).toBeLessThan(mediumPolicy.metricConfidence.facingBet);
    expect(mediumPolicy.metricConfidence.facingBet).toBeLessThan(establishedPolicy.metricConfidence.facingBet);
    expect(establishedPolicy.opponentType).toBe("nit");
  });

  it("does not trust one or two showdown opportunities as a calling-station sample", () => {
    const sparse = profile({
      vpip: 48, pfr: 18, foldFrequency: 0, foldOpportunities: 2,
      wentToShowdown: 100, wentToShowdownOpportunities: 2,
      wonAtShowdown: 0, wonAtShowdownOpportunities: 2,
    });
    const policy = deriveAdaptivePolicy(sparse);
    expect(policy.opponentType).not.toBe("calling-station");
    expect(policy.metricConfidence.wentToShowdown).toBeLessThan(0.15);
    expect(policy.metricConfidence.wonAtShowdown).toBeLessThan(0.16);
  });

  it.each([
    "preflop-aggression",
    "preflop-aggression+flop-pressure",
    "flop-cbet",
    "turn-barrel",
    "check-raise",
    "river-aggression",
  ])("widens defense for repeated aggressive pattern %s", (pattern) => {
    const balanced = profile({ vpip: 31, pfr: 23, threeBet: 8, foldFrequency: 45 });
    const policy = deriveAdaptivePolicy(balanced, [{ pattern, occurrences: 6, handNumbers: [9, 8, 7, 6, 5, 4] }]);
    expect(policy.frequencyAdjustments.defend).toBeGreaterThan(0);
    expect(policy.frequencyAdjustments.call).toBeGreaterThan(0);
    expect(policy.frequencyAdjustments.fold).toBeLessThan(0);
  });

  it("turns repeated fold-to-3bet into counter-pressure rather than wider defense", () => {
    const balanced = profile({ vpip: 31, pfr: 23, threeBet: 8, foldFrequency: 45 });
    const policy = deriveAdaptivePolicy(balanced, [{ pattern: "fold-to-3bet", occurrences: 6, handNumbers: [9, 8, 7, 6, 5, 4] }]);
    expect(policy.frequencyAdjustments.raise).toBeGreaterThan(0);
    expect(policy.frequencyAdjustments.bluff).toBeGreaterThan(0);
  });

  it("defends materially wider against repeated aggressive pressure than against a nit", () => {
    const versusAggressive = simulate(visible(aggressiveProfile));
    const versusNit = simulate(visible(nitProfile));
    expect(versusAggressive.call).toBeGreaterThan(versusNit.call);
    expect(versusAggressive.call + versusAggressive.raise).toBeGreaterThan(versusNit.call + versusNit.raise);
    expect(versusAggressive.fold).toBeLessThan(versusNit.fold);
  });

  it("value-bets a calling station more often when checked to", () => {
    const versusStation = simulate(visible(callingStationProfile, 0.47, false));
    const versusAggressive = simulate(visible(aggressiveProfile, 0.47, false));
    expect(versusStation.bet).toBeGreaterThan(versusAggressive.bet * 2);
  });

  it("does not let playerProfile alter non-adaptive strategies", () => {
    const left = dummyDecision(visible(aggressiveProfile), "balanced", false, "en", seeded(42));
    const right = dummyDecision(visible(nitProfile), "balanced", false, "en", seeded(42));
    expect(left).toEqual(right);
  });

  it("can use an all-in as the only available aggressive action", () => {
    const state = visible(callingStationProfile, 0.49, true, 9_000);
    expect(dummyDecision(state, "adaptive", false, "en", seeded(1)).action).toBe("all-in");
  });

  it("tells the OpenAI adaptive strategy to use opportunities and structured history", () => {
    const instructions = decisionInstructions("adaptive", "expert", false, "en");
    expect(instructions).toContain("server-computed counterStrategy");
    expect(instructions).toContain("metricConfidence");
    expect(instructions).toContain("defend/call/raise/fold/bluff/value frequencies");
  });
});
