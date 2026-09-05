import { describe, expect, it, vi } from "vitest";
import { assertCardIntegrity, assertChipAccounting, getLegalActions } from "../poker-engine/game";
import type { GameConfig } from "../shared/types";
import { SessionStore } from "../server/session";

const config: GameConfig = {
  language: "en", startingStack: 2_000, smallBlind: 25, bigBlind: 50, opponentCount: 3,
  strategy: "calling-station", difficulty: "strong", tableTalk: false, coachMode: false, debugMode: true,
};

describe("multi-AI session orchestration", () => {
  it("runs sequential AI chains against the latest engine state until the human acts", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const store = new SessionStore();
    const session = store.create(config, () => 0);
    expect(session.state.actor).toBe("human");
    const before = session.state.actions.length;
    const legal = getLegalActions(session.state, "human");
    const choice = legal.find((action) => action.type === "call") ?? legal.find((action) => action.type === "check")!;
    store.act(session, { type: choice.type, amount: choice.min });
    const aiActions = session.state.actions.slice(before).filter((action) => action.player !== "human");
    expect(new Set(aiActions.map((action) => action.player)).size).toBeGreaterThanOrEqual(2);
    expect(session.aiThinking).toBe(false);
    expect(session.state.actor === "human" || session.state.street === "complete").toBe(true);
    assertChipAccounting(session.state);
    assertCardIntegrity(session.state);
    random.mockRestore();
  });

  it("projects all four seats while keeping every unrevealed AI hand hidden", () => {
    const store = new SessionStore();
    const session = store.create(config, () => 0);
    const publicState = store.publicState(session);
    expect(publicState.seats.map((seat) => seat.playerId)).toEqual(["human", "ai", "ai-2", "ai-3"]);
    expect(publicState.config.opponentCount).toBe(3);
    for (const seat of publicState.seats.filter((candidate) => candidate.kind === "ai")) {
      expect(publicState.players[seat.playerId].cards).toBeNull();
    }
    expect(publicState.debug?.aiVisibleStates).toBeDefined();
    expect(publicState.debug?.totalChipInvariant?.valid).toBe(true);
  });
});
