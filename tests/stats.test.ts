import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "../poker-engine/game";
import type { ActionType, GameConfig, PlayerId, Street } from "../shared/types";
import { StatsTracker } from "../server/stats";

const config: GameConfig = {
  language: "ru",
  startingStack: 10_000,
  smallBlind: 50,
  bigBlind: 100,
  strategy: "balanced",
  difficulty: "strong",
  tableTalk: false,
  coachMode: false,
  debugMode: false,
};

type TestAction = [player: PlayerId, action: ActionType, isAggressive: boolean, street?: Street];

function profileFor(actions: TestAction[]) {
  const tracker = new StatsTracker(config.startingStack, config.bigBlind);
  for (const [player, action, isAggressive, street = "preflop"] of actions) {
    tracker.observe({ player, action, street, isAggressive, amount: 200 });
  }
  const completedHand = createGame(config, () => 0);
  applyAction(completedHand, "human", { type: "fold" });
  tracker.finish(completedHand);
  return tracker.profile();
}

describe("player preflop statistics", () => {
  it.each<ActionType>(["call", "raise", "all-in"])("counts a voluntary preflop %s in VPIP", (action) => {
    const profile = profileFor([["human", action, action !== "call"]]);
    expect(profile.vpip).toBe(100);
  });

  it.each<ActionType>(["check", "fold"])("does not count preflop %s in VPIP", (action) => {
    expect(profileFor([["human", action, false]]).vpip).toBe(0);
  });

  it.each<ActionType>(["call", "bet", "raise", "all-in"])("does not count postflop %s in VPIP or PFR", (action) => {
    const profile = profileFor([["human", action, action !== "call", "flop"]]);
    expect(profile).toMatchObject({ vpip: 0, pfr: 0, threeBet: 0 });
  });

  it("counts an open raise as a 2-bet, not a 3-bet", () => {
    expect(profileFor([["human", "raise", true]])).toMatchObject({ vpip: 100, pfr: 100, threeBet: 0 });
  });

  it("counts a re-raise over an open raise as a 3-bet", () => {
    const profile = profileFor([
      ["ai", "raise", true],
      ["human", "raise", true],
    ]);
    expect(profile).toMatchObject({ vpip: 100, pfr: 100, threeBet: 100 });
  });

  it("counts the human's second raise as a 4-bet when the AI 3-bet", () => {
    const profile = profileFor([
      ["human", "raise", true],
      ["ai", "raise", true],
      ["human", "raise", true],
    ]);
    expect(profile).toMatchObject({ vpip: 100, pfr: 100, threeBet: 0 });
  });

  it("counts a limp in VPIP but not PFR", () => {
    expect(profileFor([["human", "call", false]])).toMatchObject({ vpip: 100, pfr: 0, threeBet: 0 });
  });

  it("recognizes a limp-raise as a 3-bet", () => {
    const profile = profileFor([
      ["human", "call", false],
      ["ai", "raise", true],
      ["human", "raise", true],
    ]);
    expect(profile).toMatchObject({ vpip: 100, pfr: 100, threeBet: 100 });
  });

  it("counts an all-in raise as the appropriate aggressive bet level", () => {
    const profile = profileFor([
      ["ai", "raise", true],
      ["human", "all-in", true],
    ]);
    expect(profile).toMatchObject({ vpip: 100, pfr: 100, threeBet: 100 });
  });

  it("counts a short all-in call in VPIP but not PFR or 3-bet", () => {
    const profile = profileFor([
      ["ai", "raise", true],
      ["human", "all-in", false],
    ]);
    expect(profile).toMatchObject({ vpip: 100, pfr: 0, threeBet: 0 });
    expect(profile.aggressionFactor).toBe(0);
  });
});
