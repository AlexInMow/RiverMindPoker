import { describe, expect, it } from "vitest";
import type { AIVisibleGameState, Card, PlayerProfile } from "../shared/types";
import { SessionStore } from "../server/session";
import { deriveAdaptivePolicy, dummyDecision } from "../server/ai/dummyBot";
import { decisionInstructions } from "../server/ai/prompts";

const store = new SessionStore();
const config = {
  language: "en" as const, startingStack: 10_000, smallBlind: 50, bigBlind: 100,
  strategy: "adaptive" as const, difficulty: "expert" as const, tableTalk: false, coachMode: false, debugMode: false,
};
const emptyProfile = store.create(config).tracker.profile();

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

function visible(profileValue: PlayerProfile, cards: Card[], facing = true): AIVisibleGameState {
  const state = store.aiVisibleState(store.create(config));
  return {
    ...state,
    aiHoleCards: cards,
    amountToCall: facing ? 100 : 0,
    potOdds: facing ? 0.3333 : 0,
    contextMetrics: { ...state.contextMetrics, facingAggression: facing },
    playerProfile: profileValue,
    legalActions: facing
      ? [
        { type: "fold", label: "FOLD" },
        { type: "call", amount: 100, label: "CALL 100" },
        { type: "raise", min: 300, max: 2_000, label: "RAISE TO 300" },
      ]
      : [
        { type: "check", label: "CHECK" },
        { type: "bet", min: 100, max: 2_000, label: "BET 100" },
      ],
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
    expect(deriveAdaptivePolicy(callingStationProfile).confidence).toBe(1);
  });

  it("uses repeated pressure lines when aggregate rates alone look balanced", () => {
    const balanced = profile({ vpip: 31, pfr: 23, threeBet: 8, foldFrequency: 45 });
    const policy = deriveAdaptivePolicy(balanced, [{
      pattern: "preflop-aggression+flop-pressure", occurrences: 4, handNumbers: [9, 7, 5, 2],
    }]);
    expect(policy.opponentType).toBe("aggressive");
  });

  it("defends materially wider against repeated aggressive pressure than against a nit", () => {
    const versusAggressive = simulate(visible(aggressiveProfile, ["7c", "2d"]));
    const versusNit = simulate(visible(nitProfile, ["7c", "2d"]));
    expect(versusAggressive.call).toBeGreaterThan(versusNit.call * 3);
    expect(versusAggressive.fold).toBeLessThan(versusNit.fold / 3);
  });

  it("value-bets a calling station more often when checked to", () => {
    const versusStation = simulate(visible(callingStationProfile, ["Qs", "8d"], false));
    const versusAggressive = simulate(visible(aggressiveProfile, ["Qs", "8d"], false));
    expect(versusStation.bet).toBeGreaterThan(versusAggressive.bet * 2);
  });

  it("does not let playerProfile alter non-adaptive strategies", () => {
    const left = dummyDecision(visible(aggressiveProfile, ["7c", "2d"]), "balanced", false, "en", seeded(42));
    const right = dummyDecision(visible(nitProfile, ["7c", "2d"]), "balanced", false, "en", seeded(42));
    expect(left).toEqual(right);
  });

  it("can use an all-in as the only available aggressive action", () => {
    const state = visible(callingStationProfile, ["As", "Ad"], false);
    state.legalActions = [
      { type: "check", label: "CHECK" },
      { type: "all-in", amount: 1_000, label: "ALL-IN 1000" },
    ];
    expect(dummyDecision(state, "adaptive", false, "en", seeded(1)).action).toBe("all-in");
  });

  it("tells the OpenAI adaptive strategy to use opportunities and structured history", () => {
    const instructions = decisionInstructions("adaptive", "expert", false, "en");
    expect(instructions).toContain("opportunity-based player profile");
    expect(instructions).toContain("structured recentHands");
    expect(instructions).toContain("defend/call/raise/fold frequencies");
  });
});
