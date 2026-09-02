import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "../poker-engine/game";
import type { AdaptiveHandSummary, GameConfig } from "../shared/types";
import { buildAdaptiveHandSummary, findRepeatedPlayerPatterns } from "../server/adaptiveHistory";

const config: GameConfig = {
  language: "ru", startingStack: 10_000, smallBlind: 50, bigBlind: 100,
  strategy: "adaptive", difficulty: "strong", tableTalk: false, coachMode: false, debugMode: false,
};

describe("Adaptive hand memory", () => {
  it("stores a compact public action history and tags repeated pressure lines", () => {
    const game = createGame(config, () => 0);
    applyAction(game, "human", { type: "raise", amount: 300 });
    applyAction(game, "ai", { type: "call" });
    applyAction(game, "ai", { type: "check" });
    applyAction(game, "human", { type: "bet", amount: 200 });
    applyAction(game, "ai", { type: "fold" });

    const summary = buildAdaptiveHandSummary(game);
    expect(summary.actions).toHaveLength(5);
    expect(JSON.stringify(summary)).not.toContain(game.players.human.cards[0]);
    expect(summary.playerLineTags).toEqual(expect.arrayContaining([
      "preflop-aggression",
      "flop-pressure",
      "preflop-aggression+flop-pressure",
      "flop-cbet",
    ]));
  });

  it("detects recurring patterns across the bounded recent sample", () => {
    const hand = (handNumber: number, tags: string[]): AdaptiveHandSummary => ({
      handNumber, button: "human", pot: 600, winner: "human", reachedShowdown: false, actions: [], playerLineTags: tags,
    });
    const repeated = findRepeatedPlayerPatterns([
      hand(4, ["preflop-aggression+flop-pressure"]),
      hand(3, ["fold-to-3bet"]),
      hand(2, ["preflop-aggression+flop-pressure"]),
      hand(1, ["preflop-aggression+flop-pressure", "fold-to-3bet"]),
    ]);
    expect(repeated).toEqual([
      { pattern: "preflop-aggression+flop-pressure", occurrences: 3, handNumbers: [4, 2, 1] },
      { pattern: "fold-to-3bet", occurrences: 2, handNumbers: [3, 1] },
    ]);
  });
});
