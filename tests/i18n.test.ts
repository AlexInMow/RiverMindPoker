import { describe, expect, it } from "vitest";
import { actionAnnouncement, resultText, translateLog, translateTendency } from "../client/i18n";

describe("Russian localization", () => {
  it("translates engine-generated action history", () => {
    expect(translateLog("You raises to 1200", "ru")).toBe("Вы повышаете до 1200");
    expect(translateLog("Flop: J♥ 7♥ 2♣", "ru")).toBe("Флоп: J♥ 7♥ 2♣");
    expect(translateLog("AI wins 600 (opponent folded)", "ru")).toContain("соперник сбросил карты");
  });

  it("localizes structured showdown results", () => {
    expect(resultText({ winners: ["human"], pot: 2600, summary: "You wins", humanHand: "Two pair", aiHand: "One pair", payouts: { human: 2600, ai: 0 } }, "ru"))
      .toBe("Вы выигрываете 2 600: две пары");
  });

  it("explains when a kicker decides equal hand categories", () => {
    const result = { winners: ["ai" as const], pot: 19500, summary: "AI wins", humanHand: "One pair", aiHand: "One pair", showdownDetail: { reason: "kicker" as const, decisiveRank: 13 }, payouts: { human: 0, ai: 19500 } };
    expect(resultText(result, "ru")).toBe("AI выигрывает 19 500: пара, старший кикер K");
    expect(resultText(result, "en")).toBe("AI wins 19,500: One pair, K kicker");
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
