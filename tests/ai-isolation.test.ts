import { describe, expect, it, vi } from "vitest";
import type { GameConfig } from "../shared/types";
import { SessionStore } from "../server/session";
import { validateAndNormalizeDecision } from "../server/ai/validation";
import { applyAction } from "../poker-engine/game";
import { createDeck } from "../poker-engine/cards";

const config: GameConfig = {
  language: "ru", startingStack: 10000, smallBlind: 50, bigBlind: 100, strategy: "adaptive", difficulty: "expert", tableTalk: true, coachMode: false, debugMode: true,
};

describe("AI boundary", () => {
  it("constructs an explicit visible state with no human hole-card field", () => {
    const store = new SessionStore();
    const session = store.create(config);
    const visible = store.aiVisibleState(session);
    const serialized = JSON.stringify(visible);
    for (const card of session.state.players.human.cards) expect(serialized).not.toContain(`"${card}"`);
    expect(Object.keys(visible)).not.toContain("humanHoleCards");
    expect(Object.keys(visible)).not.toContain("players");
    expect(Object.keys(visible)).not.toContain("deck");
    expect(Object.keys(visible)).not.toContain("burnCards");
    expect(Object.keys(visible)).not.toContain("initialHoleCards");
    expect(visible.aiHoleCards).toEqual(session.state.players.ai.cards);
    expect(visible).toHaveProperty("amountToCall");
    expect(visible).toHaveProperty("potOdds");
    expect(visible).toHaveProperty("effectiveStack");
    expect(visible).toHaveProperty("spr");
    expect(visible).toHaveProperty("boardMetrics");
    expect(visible).toHaveProperty("counterStrategy.metricConfidence");
    expect(visible).toHaveProperty("counterStrategy.frequencyAdjustments.defend");

    store.act(session, { type: "fold" });
    const withHistory = JSON.stringify(store.aiVisibleState(session));
    for (const card of session.state.players.human.cards) expect(withHistory).not.toContain(`"${card}"`);
    expect(session.adaptiveHands).toHaveLength(1);
  });

  it("isolates every AI from all other hole cards at a four-player table", () => {
    const store = new SessionStore();
    const session = store.create({ ...config, opponentCount: 3 });
    for (const viewer of ["ai", "ai-2", "ai-3"] as const) {
      const visible = store.aiVisibleState(session, viewer);
      const serialized = JSON.stringify(visible);
      expect(visible.playerId).toBe(viewer);
      expect(visible.aiHoleCards).toEqual(session.state.players[viewer]!.cards);
      expect(visible.publicPlayers.every((player) => player.cards === null)).toBe(true);
      for (const hiddenId of ["human", "ai", "ai-2", "ai-3"] as const) {
        if (hiddenId === viewer) continue;
        for (const card of session.state.players[hiddenId]!.cards) expect(serialized).not.toContain(`"${card}"`);
      }
      expect(Object.keys(visible)).not.toContain("deck");
      expect(Object.keys(visible)).not.toContain("burnCards");
    }
  });

  it("clamps an out-of-range model raise", () => {
    const legal = [{ type: "raise" as const, min: 300, max: 1200, label: "RAISE TO 300" }];
    const result = validateAndNormalizeDecision({ action: "raise", amount: 99999, reasoning_summary: "Pressure.", table_talk: "" }, legal);
    expect(result.decision.amount).toBe(1200);
    expect(result.validation).toContain("clamped");
  });

  it("replaces an illegal model action with a legal fallback", () => {
    const legal = [{ type: "check" as const, label: "CHECK" }];
    const result = validateAndNormalizeDecision({ action: "fold", amount: 0, reasoning_summary: "No.", table_talk: "" }, legal);
    expect(result.decision.action).toBe("check");
  });

  it("keeps AI cards hidden after a fold and reveals them only at showdown", () => {
    const store = new SessionStore();
    const folded = store.create(config);
    applyAction(folded.state, "human", { type: "fold" });
    expect(store.publicState(folded).players.ai.cards).toBeNull();

    const showdown = store.create(config);
    applyAction(showdown.state, "human", { type: "call" });
    applyAction(showdown.state, "ai", { type: "check" });
    for (let street = 0; street < 3; street += 1) {
      applyAction(showdown.state, "ai", { type: "check" });
      applyAction(showdown.state, "human", { type: "check" });
    }
    expect(store.publicState(showdown).players.ai.cards).toHaveLength(2);
  });

  it("lets the AI act again when its preflop check makes it first on the flop", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const store = new SessionStore();
    const session = store.create({ ...config, strategy: "nit" });
    const humanCards = new Set(session.state.players.human.cards);
    const weakCards = (["2c", "7d", "3c", "8d"] as const).filter((card) => !humanCards.has(card)).slice(0, 2);
    session.state.players.ai.cards = [...weakCards];
    session.state.initialHoleCards.ai = [...weakCards];
    session.state.deck = createDeck().filter((card) => !humanCards.has(card) && !weakCards.includes(card as typeof weakCards[number]));
    session.state.cardsDrawn = 4;
    session.state.validatedCardsDrawn = 4;
    applyAction(session.state, "human", { type: "call" });
    await store.runAI(session);
    expect(session.state.street).toBe("flop");
    expect(session.state.actor).toBe("human");
    const aiActions = session.state.actions.filter((action) => action.player === "ai" && ["check", "bet", "raise", "all-in"].includes(action.action));
    expect(aiActions).toHaveLength(2);
    expect(aiActions[0]).toMatchObject({ street: "preflop", action: "check" });
    expect(aiActions[1].street).toBe("flop");
    expect(session.lastTrace?.localDecisionTrace).toBeDefined();
    const trace = JSON.stringify(store.publicState(session).debug?.lastAITrace);
    for (const card of session.state.players.human.cards) expect(trace).not.toContain(`"${card}"`);
    random.mockRestore();
  });
});
