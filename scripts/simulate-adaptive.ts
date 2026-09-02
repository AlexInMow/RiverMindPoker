import { applyAction } from "../poker-engine/game";
import type { AIVisibleGameState, PlayerProfile } from "../shared/types";
import { deriveAdaptivePolicy } from "../server/ai/adaptivePolicy";
import { dummyDecision } from "../server/ai/dummyBot";
import { SessionStore } from "../server/session";

const trials = 10_000;
const config = {
  language: "en" as const, startingStack: 10_000, smallBlind: 50, bigBlind: 100,
  strategy: "adaptive" as const, difficulty: "expert" as const, tableTalk: false, coachMode: false, debugMode: false,
};
const fixedRandom = (fraction: number) => (upperExclusive: number) => Math.min(upperExclusive - 1, Math.floor(fraction * upperExclusive));
const store = new SessionStore();
const session = store.create(config, fixedRandom(0.6)); // deterministic 6d 5d marginal suited connector for the AI
applyAction(session.state, "human", { type: "raise", amount: 600 });
const reachableState = store.aiVisibleState(session);
const base = reachableState.playerProfile;

const profile = (overrides: Partial<PlayerProfile>): PlayerProfile => ({
  ...base,
  hands: 50,
  foldOpportunities: 30,
  wentToShowdownOpportunities: 20,
  wonAtShowdownOpportunities: 12,
  ...overrides,
});
const profiles: Record<string, PlayerProfile> = {
  neutral: profile({ vpip: 32, pfr: 23, threeBet: 8, foldFrequency: 45, wentToShowdown: 34, wonAtShowdown: 50 }),
  aggressive: profile({
    vpip: 62, pfr: 52, threeBet: 24, foldFrequency: 24,
    flopCBet: 82, flopCBetOpportunities: 22, turnBarrel: 76, turnBarrelOpportunities: 16,
    riverAggression: 70, riverOpportunities: 14, checkRaise: 28, checkRaiseOpportunities: 14,
  }),
  nit: profile({
    vpip: 16, pfr: 10, threeBet: 3, foldFrequency: 76,
    foldToThreeBet: 78, foldToThreeBetOpportunities: 12, foldToCBet: 81, foldToCBetOpportunities: 18,
  }),
  "calling-station": profile({ vpip: 64, pfr: 9, threeBet: 2, foldFrequency: 17, wentToShowdown: 61, wonAtShowdown: 39 }),
};

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function simulate(playerProfile: PlayerProfile): Record<string, string | number> {
  const state: AIVisibleGameState = {
    ...reachableState,
    playerProfile,
    counterStrategy: deriveAdaptivePolicy(playerProfile, reachableState.repeatedPlayerPatterns),
  };
  const counts: Record<string, number> = { fold: 0, call: 0, raise: 0, "all-in": 0 };
  const random = seeded(0xa11ce);
  for (let index = 0; index < trials; index += 1) {
    const action = dummyDecision(state, "adaptive", false, "en", random).action;
    counts[action] = (counts[action] ?? 0) + 1;
  }
  const percent = (action: string) => `${(counts[action] / trials * 100).toFixed(1)}%`;
  return {
    classification: state.counterStrategy.opponentType,
    confidence: state.counterStrategy.confidence.toFixed(3),
    fold: percent("fold"),
    call: percent("call"),
    raise: percent("raise"),
    "all-in": percent("all-in"),
  };
}

console.log(`Adaptive response simulation: ${trials.toLocaleString()} decisions per profile; reachable preflop raise to 600; AI hand 6d 5d`);
console.table(Object.fromEntries(Object.entries(profiles).map(([name, value]) => [name, simulate(value)])));
