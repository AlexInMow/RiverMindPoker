import { describe, expect, it } from "vitest";
import { createDeck } from "../poker-engine/cards";
import { applyAction, assertCardIntegrity, createGame, getLegalActions, type EngineState } from "../poker-engine/game";
import type { Card, GameConfig, Strategy } from "../shared/types";
import { classifyPreflopHand } from "../server/ai/preflop";
import { dummyDecision, dummyDecisionWithTrace } from "../server/ai/dummyBot";
import { SessionStore } from "../server/session";

const config: GameConfig = {
  language: "en", startingStack: 1_000, smallBlind: 5, bigBlind: 10,
  strategy: "balanced", difficulty: "strong", tableTalk: false, coachMode: false, debugMode: true,
};
const hands: Record<string, Card[]> = {
  AA: ["As", "Ah"], KK: ["Ks", "Kh"], QQ: ["Qs", "Qh"], AKs: ["As", "Ks"],
  AKo: ["As", "Kh"], JJ: ["Js", "Jh"], TT: ["Ts", "Th"], AQs: ["As", "Qs"],
  AQo: ["As", "Qh"], AJs: ["As", "Js"], KQs: ["Ks", "Qs"], JTs: ["Js", "Ts"],
  "99": ["9s", "9h"], "76s": ["7s", "6s"], A5s: ["As", "5s"], K6o: ["Ks", "6h"],
  K2o: ["Ks", "2h"], "72o": ["7s", "2h"],
};
const strategies: Strategy[] = ["balanced", "tag", "lag", "nit", "calling-station", "maniac", "tricky", "adaptive"];

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => (value = (value * 1_664_525 + 1_013_904_223) >>> 0) / 0x1_0000_0000;
}

function rigAIHand(game: EngineState, aiCards: Card[]): void {
  const humanCards = createDeck().filter((card) => !aiCards.includes(card)).slice(0, 2);
  const used = new Set([...humanCards, ...aiCards]);
  game.players.human.cards = [...humanCards];
  game.players.ai.cards = [...aiCards];
  game.initialHoleCards = { human: [...humanCards], ai: [...aiCards] };
  game.deck = createDeck().filter((card) => !used.has(card));
  game.cardsDrawn = 4;
  game.validatedCardsDrawn = 4;
  assertCardIntegrity(game, "rigged LocalBot test hand");
}

function firstFacingOpen(hand: Card[], strategy: Strategy): ReturnType<SessionStore["aiVisibleState"]> {
  const store = new SessionStore();
  const session = store.create({ ...config, strategy }, () => 0);
  rigAIHand(session.state, hand);
  applyAction(session.state, "human", { type: "raise", amount: 20 });
  return store.aiVisibleState(session);
}

function repeatedRaiseWar(hand: Card[], strategy: Strategy, random: () => number): { stackOff: boolean; levels: number } {
  const store = new SessionStore();
  const session = store.create({ ...config, strategy }, () => 0);
  const game = session.state;
  rigAIHand(game, hand);
  applyAction(game, "human", { type: "raise", amount: 20 });
  let levels = 2;
  for (let actionCount = 0; game.street === "preflop" && actionCount < 40; actionCount += 1) {
    if (game.actor === "ai") {
      const decision = dummyDecision(store.aiVisibleState(session), strategy, false, "en", random);
      applyAction(game, "ai", { type: decision.action, amount: decision.amount });
      if (decision.action === "all-in" || game.players.ai.totalContribution >= 800) return { stackOff: true, levels };
      if (decision.action !== "raise") return { stackOff: false, levels };
      levels += 1;
    } else {
      const raise = getLegalActions(game, "human").find((action) => action.type === "raise");
      if (raise) applyAction(game, "human", { type: "raise", amount: raise.min });
      else {
        const shove = getLegalActions(game, "human").find((action) => action.type === "all-in" && (action.amount ?? 0) > game.currentBet);
        if (!shove) return { stackOff: game.players.ai.totalContribution >= 800, levels };
        applyAction(game, "human", { type: "all-in" });
      }
      levels += 1;
    }
  }
  return { stackOff: game.players.ai.totalContribution >= 800, levels };
}

function stackOffRate(hand: Card[], strategy: Strategy, trials: number): number {
  const random = seeded(0x51ac0ff);
  let stackOffs = 0;
  for (let trial = 0; trial < trials; trial += 1) stackOffs += Number(repeatedRaiseWar(hand, strategy, random).stackOff);
  return stackOffs / trials;
}

describe("LocalBot preflop fundamentals", () => {
  it("classifies the requested representative starting hands", () => {
    expect(classifyPreflopHand(hands.AA).handClass).toBe("premium");
    expect(classifyPreflopHand(hands.JJ).handClass).toBe("strong");
    expect(classifyPreflopHand(hands.JTs).handClass).toBe("medium");
    expect(classifyPreflopHand(hands["76s"]).handClass).toBe("speculative");
    expect(classifyPreflopHand(hands.K6o)).toMatchObject({ handClass: "weak", label: "K6o" });
    expect(classifyPreflopHand(hands.K2o)).toMatchObject({ handClass: "weak", label: "K2o" });
  });

  it("uses the balanced baseline for Adaptive on hand one with no evidence", () => {
    const balanced = firstFacingOpen(hands.JTs, "balanced");
    const adaptive = firstFacingOpen(hands.JTs, "adaptive");
    expect(adaptive.handNumber).toBe(1);
    expect(adaptive.playerProfile.hands).toBe(0);
    expect(adaptive.repeatedPlayerPatterns).toEqual([]);
    expect(adaptive.counterStrategy.confidence).toBe(0);
    expect(dummyDecision(adaptive, "adaptive", false, "en", seeded(42)))
      .toEqual(dummyDecision(balanced, "balanced", false, "en", seeded(42)));
  });

  it("emits a safe detailed local trace without human hole cards", () => {
    const state = firstFacingOpen(hands.K6o, "balanced");
    const result = dummyDecisionWithTrace(state, "balanced", false, "en", seeded(7));
    expect(result.trace).toMatchObject({
      handClass: "weak", handLabel: "K6o", preflopBetLevel: 2, effectiveStackBB: 100,
      amountToCallBB: 1, strategy: "balanced", adaptiveConfidence: 0,
    });
    expect(result.trace.candidateActions.length).toBeGreaterThan(1);
    expect(JSON.stringify(result.trace)).not.toContain(state.playerStack === 0 ? "impossible" : '"humanCards"');
  });

  it("keeps the three reported first-hand weak/medium stack-offs rare across 5,000 wars each", () => {
    expect(stackOffRate(hands.K6o, "balanced", 5_000)).toBeLessThan(0.005);
    expect(stackOffRate(hands.K2o, "adaptive", 5_000)).toBeLessThan(0.005);
    expect(stackOffRate(hands.JTs, "adaptive", 5_000)).toBeLessThan(0.02);
  });

  it("preserves premium stack-offs and monotonic hand ordering", () => {
    const rates = Object.fromEntries(["AA", "KK", "QQ", "AKo", "JJ", "JTs", "K2o", "72o"]
      .map((name) => [name, stackOffRate(hands[name], "balanced", 1_000)]));
    expect(rates.AA).toBeGreaterThan(0.45);
    expect(rates.KK).toBeGreaterThan(0.35);
    expect(rates.AA).toBeGreaterThan(rates.KK);
    expect(rates.KK).toBeGreaterThan(rates.QQ);
    expect(rates.QQ).toBeGreaterThan(rates.JJ);
    expect(rates.JJ).toBeGreaterThan(rates.JTs);
    expect(rates.JTs).toBeGreaterThanOrEqual(rates.K2o);
    expect(rates.K2o).toBeLessThan(0.005);
    expect(rates["72o"]).toBeLessThan(0.005);
  });

  it("checks every LocalBot strategy against weak and premium repeated raise wars", () => {
    for (const strategy of strategies) {
      const matrix = Object.fromEntries(["K2o", "K6o", "JTs", "AQo", "JJ", "KK", "AA"]
        .map((name) => [name, stackOffRate(hands[name], strategy, 250)]));
      const weak = matrix.K2o;
      const premium = matrix.AA;
      expect(weak, `${strategy} K2o`).toBeLessThan(strategy === "maniac" ? 0.04 : 0.015);
      expect(premium, `${strategy} AA`).toBeGreaterThan(0.15);
      expect(matrix.K6o, `${strategy} K6o`).toBeLessThan(strategy === "maniac" ? 0.04 : 0.015);
      expect(matrix.JTs, `${strategy} JTs`).toBeLessThan(0.05);
      expect(matrix.KK, `${strategy} KK`).toBeGreaterThan(matrix.JJ);
      expect(matrix.JJ, `${strategy} JJ`).toBeGreaterThanOrEqual(matrix.JTs);
    }
  });

  it("keeps ordinary postflop aggression on the separate postflop path", () => {
    const store = new SessionStore();
    const session = store.create(config, () => 0);
    applyAction(session.state, "human", { type: "call" });
    applyAction(session.state, "ai", { type: "check" });
    const state = store.aiVisibleState(session);
    expect(state.street).toBe("flop");
    for (const strategy of strategies) {
      const result = dummyDecisionWithTrace(state, strategy, false, "en", () => 0);
      expect(state.legalActions.map((action) => action.type)).toContain(result.decision.action);
      expect(result.trace.handClass).toBeUndefined();
      expect(result.trace.reasonSummary).toContain("Postflop");
    }
  });
});
