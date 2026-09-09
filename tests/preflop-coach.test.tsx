import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getStartingHandClass, STARTING_HANDS } from "../server/coach/startingHands";
import { analyzePreflop } from "../server/coach/preflop";
import { captureCoachSnapshot } from "../server/coach/report";
import { PreflopCoach } from "../client/components/PreflopCoach";
import { createDeck } from "../poker-engine/cards";
import { createGame, applyAction } from "../poker-engine/game";
import { SessionStore } from "../server/session";
import type { Card, GameConfig, PlayerAction } from "../shared/types";
import type { PreflopContext } from "../shared/preflopCoach";

const cfg: GameConfig = { language: "ru", startingStack: 10000, smallBlind: 50, bigBlind: 100, strategy: "balanced", difficulty: "strong", tableTalk: false, coachMode: true, debugMode: false, opponentCount: 2 };
const context = (overrides: Partial<PreflopContext> = {}): PreflopContext => ({ position: "BTN", playerCount: 4, playersInHand: 4, bigBlind: 100, effectiveStackBb: 100, actions: [], amountToCall: 100, currentBet: 100, canAct: true, legalActions: [{ type: "fold", label: "FOLD" }, { type: "call", label: "CALL", amount: 100 }, { type: "raise", label: "RAISE", min: 200, max: 10000 }], ...overrides });
const action = (aggressive: boolean, kind: PlayerAction["action"] = "raise"): PlayerAction => ({ player: "ai", street: "preflop", action: kind, aggressive, amount: aggressive ? 300 : 100, at: 0 });
const analyze = (cards: [Card, Card], ctx = context()) => analyzePreflop(cards, ctx, "ru");

describe("169 starting hand classes", () => {
  it.each([["As", "Ah", "AA"], ["Ks", "As", "AKs"], ["Kd", "As", "AKo"], ["6h", "7h", "76s"], ["2d", "7c", "72o"]] as [Card, Card, string][])("normalizes %s %s to %s", (a, b, result) => {
    expect(getStartingHandClass(a, b)).toBe(result); expect(getStartingHandClass(b, a)).toBe(result);
  });
  it("covers all 1326 physical combinations with exactly 169 classes", () => {
    const deck = createDeck(), counts = new Map<string, number>();
    for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) { const key = getStartingHandClass(deck[i], deck[j]); counts.set(key, (counts.get(key) ?? 0) + 1); expect(STARTING_HANDS[key]).toBeDefined(); }
    expect(counts.size).toBe(169); expect(Object.keys(STARTING_HANDS)).toHaveLength(169);
    expect([...counts].filter(([k]) => k.length === 2)).toHaveLength(13);
    expect([...counts].filter(([k]) => k.endsWith("s"))).toHaveLength(78);
    expect([...counts].filter(([k]) => k.endsWith("o"))).toHaveLength(78);
    for (const [key, n] of counts) expect(n).toBe(key.length === 2 ? 6 : key.endsWith("s") ? 4 : 12);
  });
  it("rejects invalid and duplicated physical cards", () => {
    expect(() => getStartingHandClass("As", "As")).toThrow();
    expect(() => getStartingHandClass("1s" as Card, "As")).toThrow();
    expect(getStartingHandClass("As", "Ah")).not.toContain("s");
  });
  it("keeps the documented rating ordering without claiming equity", () => {
    const p = STARTING_HANDS;
    expect(p.AA.rating).toBe(100); expect(p.AA.rating).toBeGreaterThan(p.KK.rating); expect(p.KK.rating).toBeGreaterThan(p.QQ.rating);
    expect(p.AKs.rating).toBeGreaterThan(p.AKo.rating); expect(p["76s"].rating).toBeGreaterThan(p["72o"].rating);
    expect(p["72o"].rating).toBe(Math.min(...Object.values(p).map((v) => v.rating)));
    expect(analyze(["As", "Ah"]).equity).toBeUndefined();
  });
  it.each([["AKs", ["broadway", "suited", "nut-flush"]], ["76s", ["suited", "connector"]], ["A5s", ["suited-ace", "wheel-ace"]], ["77", ["pair", "set-mining"]], ["KJo", ["broadway", "offsuit"]]])("recognizes %s traits", (key, traits) => {
    expect(STARTING_HANDS[key as string].traits).toEqual(expect.arrayContaining(traits as string[]));
  });
});

describe("context-aware preflop teaching", () => {
  it.each([
    [[], "unopened"], [[action(false, "call")], "limped"], [[action(true)], "open-raise"],
    [[action(true), action(false, "call")], "open-callers"], [[action(true), action(true)], "3bet"], [[action(true), action(true), action(true)], "4bet-plus"],
  ] as [PlayerAction[], string][])("classifies history %j as %s", (actions, expected) => expect(analyze(["As", "Kd"], context({ actions })).actionContext).toBe(expected));
  it("does not count a short all-in call as aggression", () => {
    const r = analyze(["As", "Kd"], context({ actions: [action(true), action(false, "all-in")] }));
    expect(r.betLevel).toBe(2); expect(r.actionContext).toBe("open-callers");
  });
  it("is wider on BTN than UTG without changing the hand rating", () => {
    const btn = analyze(["7s", "6s"]), utg = analyze(["7s", "6s"], context({ position: "UTG" }));
    expect(btn.rating).toBe(utg.rating); expect(btn.recommendedAction).toBe("raise"); expect(utg.recommendedAction).not.toBe("raise");
    expect(btn.playFrequency).not.toBe(utg.playFrequency);
  });
  it("changes marginal hands facing a large early-position raise", () => {
    const r = analyze(["7s", "6s"], context({ actions: [action(true)], aggressorPosition: "UTG", currentBet: 800 }));
    expect(r.recommendedAction).toBe("fold"); expect(r.explanation).not.toBe(analyze(["7s", "6s"]).explanation);
  });
  it.each([[], [action(true)], [action(true), action(true)], [action(true), action(true), action(true)]].map((actions) => ({ actions })))("never recommends folding AA in ordinary raising contexts $actions", ({ actions }) => {
    expect(analyze(["As", "Ah"], context({ actions })).recommendedAction).toBe("raise");
  });
  it("does not standard-open 72o UTG", () => expect(analyze(["7c", "2d"], context({ position: "UTG" })).recommendedAction).toBe("fold"));
  it("adapts speculative play to short stacks and more players", () => {
    expect(analyze(["7s", "6s"], context({ effectiveStackBb: 15, actions: [action(true)] })).playFrequency).not.toBe(analyze(["7s", "6s"], context({ effectiveStackBb: 150 })).playFrequency);
    expect(analyze(["As", "5s"], context({ playerCount: 2, position: "BTN / SB" })).playFrequency).not.toBe(analyze(["As", "5s"], context({ playerCount: 4, position: "UTG" })).playFrequency);
  });
  it("only recommends legal actions, including the BB option and locked raise", () => {
    expect(analyze(["As", "Ah"], context({ legalActions: [{ type: "call", amount: 50, label: "CALL" }, { type: "fold", label: "FOLD" }] })).recommendedAction).toBe("call");
    expect(analyze(["7c", "2d"], context({ position: "BB", actions: [action(false, "call")], amountToCall: 0, legalActions: [{ type: "check", label: "CHECK" }] })).recommendedAction).toBe("check");
    expect(analyze(["As", "Ah"], context({ canAct: false, legalActions: [] })).recommendedAction).toBeNull();
  });
  it("intersects example open sizing with engine legal bounds", () => {
    expect(analyze(["As", "Ah"]).openSizing).toEqual({ min: 200, max: 300, bigBlind: 100 });
    expect(analyze(["As", "Ah"], context({ legalActions: [{ type: "raise", min: 400, max: 900, label: "RAISE" }] })).openSizing).toBeUndefined();
    expect(analyze(["As", "Ah"], context({ actions: [action(true)] })).openSizing).toBeUndefined();
  });
  it("captures effective stack relative to the actual aggressor", () => {
    const state = createGame(cfg, () => 0);
    applyAction(state, "human", { type: "call" });
    state.players.ai.stack = 1950; state.players["ai-2"]!.stack += 8000;
    applyAction(state, "ai", { type: "raise", amount: 300 });
    applyAction(state, "ai-2", { type: "call" });
    const s = captureCoachSnapshot(state, "human");
    expect(s.preflop?.effectiveStackBb).toBe(20); expect(s.preflop?.aggressor).toBe("ai");
    expect(s.preflop?.aggressorPosition).toBe("SB");
  });
  it("keeps action-time positions, stacks and history after the hand finishes", () => {
    const store = new SessionStore(), s = store.create(cfg, () => 0);
    const before = captureCoachSnapshot(s.state, "human");
    applyAction(s.state, "human", { type: "fold" }); s.coachSnapshots.push(before);
    const review = store.coach(s).decisions[0];
    expect(review.analysis?.preflop?.position).toBe("BTN"); expect(review.analysis?.preflop?.actionContext).toBe("unopened");
    expect(review.analysis?.preflop?.effectiveStackBb).toBe(100);
    expect(store.coach(s).decisions.filter((d) => d.player !== "human").every((d) => !d.analysis)).toBe(true);
  });
  it.each([["As", "Ah"], ["As", "Ks"], ["As", "Kd"], ["7s", "7h"], ["As", "5s"], ["7s", "6s"], ["Kc", "Jd"], ["7c", "2d"]] as [Card, Card][])("renders %s %s with rating tooltip and collapsed details", (first, second) => {
    for (const position of ["BTN", "UTG"]) for (const actions of [[], [action(true)]]) {
      const result = analyze([first, second], context({ position, actions }));
      const html = renderToStaticMarkup(<PreflopCoach analysis={result} language="ru" />);
      expect(html).toContain("не вероятность победы"); expect(html).toContain("title=");
      expect(html).toContain("<details>"); expect(html).not.toContain("<details open"); expect(html).not.toContain("NaN");
    }
  });
});
