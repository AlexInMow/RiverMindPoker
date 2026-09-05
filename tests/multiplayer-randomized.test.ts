import { describe, expect, it } from "vitest";
import { applyAction, assertCardIntegrity, assertChipAccounting, createGame, getLegalActions } from "../poker-engine/game";
import type { GameConfig, OpponentCount } from "../shared/types";

const seeded = (seed: number) => {
  let value = seed >>> 0;
  return () => (value = (value * 1_664_525 + 1_013_904_223) >>> 0) / 0x1_0000_0000;
};
const config = (opponentCount: OpponentCount): GameConfig => ({
  language: "en", startingStack: 2_000, smallBlind: 25, bigBlind: 50, opponentCount,
  strategy: "balanced", difficulty: "strong", tableTalk: false, coachMode: false, debugMode: false,
});

function completeRandomHand(opponentCount: OpponentCount, seed: number, allInHeavy: boolean): void {
  const random = seeded(seed);
  const randomIndex = (upperExclusive: number) => Math.floor(random() * upperExclusive);
  const state = createGame(config(opponentCount), randomIndex);
  let steps = 0;
  while (state.street !== "complete") {
    expect(state.actor).not.toBeNull();
    const actor = state.actor!;
    const legal = getLegalActions(state, actor);
    expect(legal.length).toBeGreaterThan(0);
    let action = allInHeavy && random() < .65 ? legal.find((candidate) => candidate.type === "all-in") : undefined;
    action ??= legal[Math.floor(random() * legal.length)];
    const amount = action.type === "bet" || action.type === "raise"
      ? Math.round(action.min! + Math.floor(random() * (action.max! - action.min! + 1)))
      : action.amount;
    applyAction(state, actor, { type: action.type, amount });
    for (const player of Object.values(state.players)) if (player) expect(player.stack).toBeGreaterThanOrEqual(0);
    expect(state.pot).toBeGreaterThanOrEqual(0);
    assertChipAccounting(state, `random action ${steps}`);
    assertCardIntegrity(state, `random action ${steps}`);
    if (++steps > 250) throw new Error("Random hand did not terminate");
  }
  expect(Object.values(state.players).reduce((sum, player) => sum + (player?.stack ?? 0), 0)).toBe(state.expectedTotalChips);
}

describe("randomized complete multiplayer hands", () => {
  it.each([1, 2, 3] as OpponentCount[])("completes 500 legal random hands with %i opponents", (opponents) => {
    for (let hand = 0; hand < 500; hand += 1) completeRandomHand(opponents, opponents * 100_000 + hand, false);
  });

  it.each([1, 2, 3] as OpponentCount[])("completes 200 all-in-heavy hands with %i opponents", (opponents) => {
    for (let hand = 0; hand < 200; hand += 1) completeRandomHand(opponents, opponents * 900_000 + hand, true);
  });
});
