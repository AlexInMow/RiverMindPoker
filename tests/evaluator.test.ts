import { describe, expect, it } from "vitest";
import type { Card } from "../shared/types";
import { createDeck } from "../poker-engine/cards";
import { compareScores, evaluateHand, getShowdownDetail } from "../poker-engine/evaluator";

const cards = (...values: Card[]) => values;

function compare(winner: Card[], loser: Card[]) {
  const winningScore = evaluateHand(winner);
  const losingScore = evaluateHand(loser);
  expect(compareScores(winningScore, losingScore)).toBe(1);
  expect(compareScores(losingScore, winningScore)).toBe(-1);
  return getShowdownDetail(winningScore, losingScore);
}

describe("hand evaluator categories and best five", () => {
  it("recognizes a royal straight flush and orders its best five", () => {
    const score = evaluateHand(cards("As", "Ks", "Qs", "Js", "Ts", "2d", "3c"));
    expect(score.category).toBe(8);
    expect(score.rankValues).toEqual([14]);
    expect(score.bestFive).toEqual(["As", "Ks", "Qs", "Js", "Ts"]);
  });

  it("ranks every category in standard order", () => {
    const hands = [
      cards("As", "Kd", "Qc", "Jh", "9s"),
      cards("As", "Ad", "Kc", "Qh", "9s"),
      cards("As", "Ad", "Kc", "Kh", "9s"),
      cards("As", "Ad", "Ac", "Kh", "9s"),
      cards("9s", "8d", "7c", "6h", "5s"),
      cards("As", "Js", "8s", "5s", "2s"),
      cards("As", "Ad", "Ac", "Kh", "Ks"),
      cards("As", "Ad", "Ac", "Ah", "Ks"),
      cards("9s", "8s", "7s", "6s", "5s"),
    ];
    hands.forEach((hand, category) => expect(evaluateHand(hand).category).toBe(category));
    for (let index = 1; index < hands.length; index += 1) {
      expect(compareScores(evaluateHand(hands[index]), evaluateHand(hands[index - 1]))).toBe(1);
    }
  });

  it("handles the ace-low wheel and places ace last", () => {
    const wheel = evaluateHand(cards("As", "2d", "3c", "4h", "5s", "Kh", "Qd"));
    const sixHigh = evaluateHand(cards("2s", "3d", "4c", "5h", "6s", "Kh", "Qd"));
    expect(wheel.category).toBe(4);
    expect(wheel.rankValues).toEqual([5]);
    expect(wheel.bestFive.map((card) => card[0])).toEqual(["5", "4", "3", "2", "A"]);
    expect(compareScores(sixHigh, wheel)).toBe(1);
  });

  it("selects the best five cards out of seven", () => {
    const score = evaluateHand(cards("Ah", "Ad", "Ac", "Ks", "Kd", "Kc", "2s"));
    expect(score.name).toBe("Full house");
    expect(score.rankValues).toEqual([14, 13]);
    expect(score.bestFive).toHaveLength(5);
    expect(score.bestFive.map((card) => card[0]).sort()).toEqual(["A", "A", "A", "K", "K"].sort());
  });

  it("rejects duplicate and malformed cards", () => {
    expect(() => evaluateHand(cards("As", "As", "Kd", "Qh", "Jc"))).toThrow(/Duplicate/);
    expect(() => evaluateHand(["Xs", "As", "Kd", "Qh", "Jc"] as Card[])).toThrow(/Invalid/);
  });
});

describe("complete tie-break vectors", () => {
  it("compares high-card hands from top to bottom", () => {
    const detail = compare(cards("As", "Kd", "Qc", "Jh", "9s"), cards("Ah", "Kc", "Qd", "Js", "8h"));
    expect(detail).toMatchObject({ category: 0, decisiveIndex: 4, winningRank: 9, losingRank: 8, reason: "higher-card" });
  });

  it.each([
    ["first", cards("As", "Ad", "Kc", "Qh", "9s"), cards("Ah", "Ac", "Jd", "Th", "9c"), 1, 13, 11],
    ["second", cards("As", "Ad", "Kc", "Qh", "9s"), cards("Ah", "Ac", "Kd", "Jh", "9c"), 2, 12, 11],
    ["third", cards("As", "Ad", "Kc", "Qh", "9s"), cards("Ah", "Ac", "Kd", "Qd", "8c"), 3, 9, 8],
  ])("compares the %s kicker after an equal pair", (_label, winner, loser, decisiveIndex, winningRank, losingRank) => {
    expect(compare(winner, loser)).toMatchObject({ category: 1, reason: "kicker", decisiveIndex, winningRank, losingRank });
  });

  it("compares the kicker after identical two pair", () => {
    expect(compare(cards("As", "Ad", "Kc", "Kh", "Qs"), cards("Ah", "Ac", "Kd", "Ks", "Jh")))
      .toMatchObject({ category: 2, reason: "kicker", decisiveIndex: 2, winningRank: 12, losingRank: 11 });
  });

  it("compares both kickers after identical trips", () => {
    expect(compare(cards("As", "Ad", "Ac", "Kh", "9s"), cards("Ah", "Ac", "As", "Kd", "8h")))
      .toMatchObject({ category: 3, reason: "kicker", decisiveIndex: 2, winningRank: 9, losingRank: 8 });
  });

  it("ties identical straights regardless of unused cards", () => {
    const a = evaluateHand(cards("9s", "8d", "7c", "6h", "5s", "As", "2c"));
    const b = evaluateHand(cards("9h", "8c", "7d", "6s", "5h", "Ks", "Qc"));
    expect(compareScores(a, b)).toBe(0);
  });

  it.each([
    [1, cards("Ah", "Kh", "9h", "6h", "3h"), cards("Ad", "Qd", "9d", "6d", "3d")],
    [2, cards("Ah", "Kh", "Jh", "6h", "3h"), cards("Ad", "Kd", "Td", "6d", "3d")],
    [3, cards("Ah", "Kh", "Jh", "8h", "3h"), cards("Ad", "Kd", "Jd", "7d", "3d")],
    [4, cards("Ah", "Kh", "Jh", "8h", "5h"), cards("Ad", "Kd", "Jd", "8d", "4d")],
  ])("compares a flush at rank-vector index %i", (decisiveIndex, winner, loser) => {
    expect(compare(winner, loser)).toMatchObject({ category: 5, reason: "higher-flush", decisiveIndex });
  });

  it("compares full houses by trips and then pair", () => {
    expect(compare(cards("As", "Ad", "Ac", "Kh", "Ks"), cards("Ah", "Ac", "As", "Qd", "Qs")))
      .toMatchObject({ category: 6, decisiveIndex: 1, winningRank: 13, losingRank: 12 });
    expect(compare(cards("As", "Ad", "Ac", "Kh", "Ks"), cards("Kc", "Kd", "Kh", "Ah", "As")))
      .toMatchObject({ category: 6, decisiveIndex: 0, winningRank: 14, losingRank: 13 });
  });

  it("compares quads by rank and then the sole kicker", () => {
    expect(compare(cards("As", "Ad", "Ac", "Ah", "Ks"), cards("Kc", "Kd", "Kh", "Ks", "Ah")))
      .toMatchObject({ category: 7, decisiveIndex: 0 });
    expect(compare(cards("Qs", "Qd", "Qc", "Qh", "As"), cards("Qs", "Qd", "Qc", "Qh", "Ks")))
      .toMatchObject({ category: 7, reason: "kicker", decisiveIndex: 1, winningRank: 14, losingRank: 13 });
  });
});

describe("board-only and shared-board cases", () => {
  it("handles a board pair where only the third kicker differs (regression)", () => {
    const board = cards("As", "6c", "9c", "7c", "Ad");
    const player = evaluateHand([...cards("Jd", "8h"), ...board]);
    const opponent = evaluateHand([...cards("Jh", "3d"), ...board]);
    expect(player.rankValues).toEqual([14, 11, 9, 8]);
    expect(opponent.rankValues).toEqual([14, 11, 9, 7]);
    expect(compareScores(player, opponent)).toBe(1);
    expect(getShowdownDetail(player, opponent)).toMatchObject({ reason: "kicker", category: 1, decisiveIndex: 3, winningRank: 8, losingRank: 7 });
  });

  it("handles board two pair with a hole-card kicker", () => {
    const board = cards("As", "Ad", "Ks", "Kd", "2c");
    expect(compare([...cards("Qh", "3d"), ...board], [...cards("Jh", "Td"), ...board]))
      .toMatchObject({ category: 2, decisiveIndex: 2, winningRank: 12, losingRank: 11 });
  });

  it.each([
    ["straight", cards("9s", "8d", "7c", "6h", "5s")],
    ["flush", cards("Ah", "Jh", "8h", "5h", "2h")],
    ["full house", cards("As", "Ad", "Ac", "Kh", "Ks")],
  ])("splits when both players play the board %s", (_name, board) => {
    const human = evaluateHand([...cards("2c", "3d"), ...board]);
    const ai = evaluateHand([...cards("4c", "3s"), ...board]);
    expect(compareScores(human, ai)).toBe(0);
  });

  it("uses a hole card to improve a board flush", () => {
    const board = cards("Kh", "Jh", "8h", "5h", "2h");
    expect(compare([...cards("Ah", "3c"), ...board], [...cards("Qh", "4c"), ...board]))
      .toMatchObject({ category: 5, decisiveIndex: 0, winningRank: 14, losingRank: 13 });
  });

  it("handles board quads and compares the one remaining kicker", () => {
    const board = cards("Qs", "Qh", "Qd", "Qc", "2s");
    expect(compare([...cards("Ah", "3d"), ...board], [...cards("Kh", "Jd"), ...board]))
      .toMatchObject({ category: 7, reason: "kicker", decisiveIndex: 1, winningRank: 14, losingRank: 13 });
  });
});

describe("randomized evaluator invariants", () => {
  it("preserves comparison symmetry, rank-vector ties and card uniqueness across 5000 deals", () => {
    let seed = 0x51f15e;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    for (let deal = 0; deal < 5000; deal += 1) {
      const deck = createDeck();
      for (let index = deck.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [deck[index], deck[swap]] = [deck[swap], deck[index]];
      }
      const dealt = deck.slice(0, 9);
      expect(new Set(dealt).size).toBe(9);
      const board = dealt.slice(4);
      const humanCards = [...dealt.slice(0, 2), ...board];
      const aiCards = [...dealt.slice(2, 4), ...board];
      const human = evaluateHand(humanCards);
      const ai = evaluateHand(aiCards);
      const comparison = compareScores(human, ai);
      expect(compareScores(ai, human)).toBe(comparison === 0 ? 0 : -comparison);
      expect(comparison === 0).toBe(human.category === ai.category && human.rankValues.join(",") === ai.rankValues.join(","));
      for (const [score, source] of [[human, humanCards], [ai, aiCards]] as const) {
        expect(score.bestFive).toHaveLength(5);
        expect(new Set(score.bestFive).size).toBe(5);
        expect(score.bestFive.every((card) => source.includes(card))).toBe(true);
        expect(score.category).toBeGreaterThanOrEqual(0);
        expect(score.category).toBeLessThanOrEqual(8);
      }
    }
  });
});
