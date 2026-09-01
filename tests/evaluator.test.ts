import { describe, expect, it } from "vitest";
import type { Card } from "../shared/types";
import { compareScores, evaluateHand, getShowdownDetail } from "../poker-engine/evaluator";

const cards = (...values: Card[]) => values;

describe("hand evaluator", () => {
  it("recognizes a royal straight flush", () => {
    const score = evaluateHand(cards("As", "Ks", "Qs", "Js", "Ts", "2d", "3c"));
    expect(score.category).toBe(8);
    expect(score.kickers).toEqual([14]);
    expect(score.name).toBe("Straight flush");
  });

  it("ranks a straight flush above four of a kind", () => {
    const straightFlush = evaluateHand(cards("9h", "8h", "7h", "6h", "5h", "As", "Ac"));
    const quads = evaluateHand(cards("Ad", "Ah", "As", "Ac", "Kd", "Qh", "2s"));
    expect(compareScores(straightFlush, quads)).toBeGreaterThan(0);
  });

  it("handles the ace-low wheel", () => {
    const wheel = evaluateHand(cards("As", "2d", "3c", "4h", "5s", "Kh", "Qd"));
    const sixHigh = evaluateHand(cards("2s", "3d", "4c", "5h", "6s", "Kh", "Qd"));
    expect(wheel.category).toBe(4);
    expect(wheel.kickers).toEqual([5]);
    expect(compareScores(sixHigh, wheel)).toBeGreaterThan(0);
  });

  it("uses all kickers and detects exact ties", () => {
    const a = evaluateHand(cards("Ah", "Kd", "Qs", "Jc", "9d", "3h", "2c"));
    const b = evaluateHand(cards("As", "Kc", "Qd", "Jh", "9c", "4d", "2h"));
    expect(compareScores(a, b)).toBe(0);
  });

  it("selects the best five cards out of seven", () => {
    const score = evaluateHand(cards("Ah", "Ad", "Ac", "Ks", "Kd", "Kc", "2s"));
    expect(score.name).toBe("Full house");
    expect(score.kickers).toEqual([14, 13]);
  });

  it("identifies the kicker when both players share the same pair category", () => {
    const board = cards("Ad", "3s", "6h", "As", "Ts");
    const ai = evaluateHand([...cards("9s", "Kc"), ...board]);
    const human = evaluateHand([...cards("4c", "2d"), ...board]);
    expect(compareScores(ai, human)).toBeGreaterThan(0);
    expect(getShowdownDetail(ai, human)).toEqual({ reason: "kicker", decisiveRank: 13 });
  });
});
