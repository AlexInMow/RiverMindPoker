import { describe, expect, it } from "vitest";
import { actionAnnouncement, handDescription, resultText, translateLog, translateTendency } from "../client/i18n";
import type { EvaluatedHandSummary, HandResult } from "../shared/types";

describe("Russian localization", () => {
  it("translates engine-generated action history", () => {
    expect(translateLog("You raises to 1200", "ru")).toBe("Вы повышаете до 1200");
    expect(translateLog("Flop: J♥ 7♥ 2♣", "ru")).toBe("Флоп: J♥ 7♥ 2♣");
    expect(translateLog("AI wins 600 (opponent folded)", "ru")).toContain("соперник сбросил карты");
    expect(translateLog("Uncalled 700 returned to You", "ru")).toBe("Непокрытая ставка 700 возвращена: Вы");
  });

  it("localizes structured showdown results", () => {
    expect(resultText({ winners: ["human"], pot: 2600, summary: "You wins", humanHand: "Two pair", aiHand: "One pair", payouts: { human: 2600, ai: 0 } }, "ru"))
      .toBe("Вы выигрываете 2 600: две пары");
  });

  it("names the exact kicker position that decides equal pairs", () => {
    const result: HandResult = {
      winners: ["human" as const], pot: 19500, summary: "You win", humanHand: "One pair", aiHand: "One pair",
      humanScore: { category: 1, name: "One pair", rankValues: [14, 11, 9, 8], bestFive: ["As", "Ad", "Jd", "9c", "8h"] },
      aiScore: { category: 1, name: "One pair", rankValues: [14, 11, 9, 7], bestFive: ["As", "Ad", "Jh", "9c", "7c"] },
      showdownDetail: { reason: "kicker" as const, category: 1, decisiveIndex: 3, decisiveRank: 8, winningRank: 8, losingRank: 7 },
      payouts: { human: 19500, ai: 0 },
    };
    expect(resultText(result, "ru")).toBe("Вы выигрываете 19 500: Пара тузов — 3-й кикер: 8 > 7");
    expect(resultText(result, "en")).toBe("You win 19,500: Pair of aces — 3rd kicker: 8 > 7");
    expect(resultText(result, "ru")).not.toContain("старший кикер 8");
  });

  it("explicitly identifies an identical best five in a split pot", () => {
    const score: EvaluatedHandSummary = { category: 4, name: "Straight", rankValues: [9], bestFive: ["9s", "8d", "7c", "6h", "5s"] };
    const result: HandResult = { winners: ["human", "ai"], pot: 150, summary: "Split", humanHand: "Straight", aiHand: "Straight", humanScore: score, aiScore: score, payouts: { human: 75, ai: 75 } };
    expect(resultText(result, "ru")).toBe("Банк 150 разделён: одинаковая лучшая пятёрка — Стрит до девятки");
  });

  it.each([
    [0, [14], "Старшая карта: A"],
    [1, [14, 13, 12, 9], "Пара тузов"],
    [2, [14, 13, 12], "Две пары: тузы и короли"],
    [3, [14, 13, 12], "Тройка тузов"],
    [4, [5], "Стрит до пятёрки"],
    [5, [14, 11, 9, 7, 3], "Флеш до туза"],
    [6, [10, 7], "Фулл-хаус: десятки фулл семёрок"],
    [7, [12, 14], "Каре дам"],
    [8, [14], "Роял-флеш"],
  ])("uses precise Russian terminology for category %i", (category, rankValues, expected) => {
    const score: EvaluatedHandSummary = { category, name: "", rankValues, bestFive: ["As", "Kd", "Qc", "Jh", "9s"] };
    expect(handDescription(score, undefined, "ru")).toBe(expected);
  });

  it("names the exact decisive card within a flush", () => {
    const result: HandResult = {
      winners: ["human"], pot: 800, summary: "You win", humanHand: "Flush", aiHand: "Flush",
      humanScore: { category: 5, name: "Flush", rankValues: [14, 13, 9, 7, 5], bestFive: ["Ah", "Kh", "9h", "7h", "5h"] },
      aiScore: { category: 5, name: "Flush", rankValues: [14, 13, 8, 7, 5], bestFive: ["Ad", "Kd", "8d", "7d", "5d"] },
      showdownDetail: { reason: "higher-flush", category: 5, decisiveIndex: 2, decisiveRank: 9, winningRank: 9, losingRank: 8 },
      payouts: { human: 800, ai: 0 },
    };
    expect(resultText(result, "ru")).toBe("Вы выигрываете 800: Флеш до туза — 3-я карта: 9 > 8");
  });

  it("translates aggregate player tendencies", () => {
    expect(translateTendency("folds often when facing pressure", "ru")).toBe("часто сдаётся под давлением");
  });

  it("builds a prominent localized AI action label", () => {
    const action = { player: "ai" as const, street: "flop" as const, action: "raise" as const, amount: 1200, at: 1 };
    expect(actionAnnouncement(action, "ru")).toBe("РЕЙЗ ДО 1200");
    expect(actionAnnouncement(action, "en")).toBe("RAISE TO 1200");
  });
});
