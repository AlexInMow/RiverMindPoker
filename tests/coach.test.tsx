import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { analyzeSituation } from "../server/coach/analyzer";
import { captureCoachSnapshot } from "../server/coach/report";
import { createDeck } from "../poker-engine/cards";
import { evaluateHand } from "../poker-engine/evaluator";
import { applyAction, assertCardIntegrity, assertChipAccounting, getLegalActions, type EngineAction } from "../poker-engine/game";
import { SessionStore } from "../server/session";
import type { Card, GameConfig } from "../shared/types";
import { CoachPanel } from "../client/components/CoachPanel";
import { PokerTable } from "../client/components/PokerTable";

const cfg: GameConfig = { language: "ru", startingStack: 1000, smallBlind: 50, bigBlind: 100, opponentCount: 1, strategy: "balanced", difficulty: "strong", tableTalk: false, coachMode: true, debugMode: false };
const analyze = (hole: Card[], board: Card[]) => analyzeSituation(hole, board, "ru");

describe("coach evaluator and potential outs", () => {
  it.each([
    [["As", "Kd"], ["2c", "5h", "8d", "9s", "Jh"], 0],
    [["9s", "9h"], ["Qc", "Td", "8d"], 1],
    [["As", "Td"], ["Ac", "Th", "8d"], 2],
    [["9s", "9h"], ["9c", "Td", "8d"], 3],
    [["As", "2d"], ["3c", "4h", "5d"], 4],
    [["Ks", "2s"], ["3s", "8s", "Ts"], 5],
    [["9s", "9h"], ["9c", "Td", "Th"], 6],
    [["9s", "9h"], ["9c", "9d", "Th"], 7],
    [["9s", "8s"], ["7s", "6s", "5s"], 8],
  ] as [Card[], Card[], number][]) ("uses the existing evaluator for %s on %s", (hole, board, category) => {
    const expected = evaluateHand([...hole, ...board]);
    expect(expected.category).toBe(category);
    const result = analyze(hole, board);
    expect(result.bestFiveCards).toEqual(expected.bestFive);
    expect(result.madeHand).not.toContain("undefined");
  });
  it("finds nine potential flush outs", () => {
    const result = analyze(["Ah", "8h"], ["2h", "Kh", "6c"]);
    expect(result.draws.find((d) => d.kind === "flush")?.potentialOuts).toHaveLength(9);
  });
  it("finds OESD eight outs and gutshot four outs", () => {
    expect(analyze(["8s", "9h"], ["6c", "7d", "Kh"]).draws.find((d) => d.kind === "oesd")?.potentialOuts).toHaveLength(8);
    expect(analyze(["8s", "9h"], ["6c", "Td", "Kh"]).draws.find((d) => d.kind === "gutshot")?.potentialOuts).toHaveLength(4);
  });
  it("recognizes double gutshot and the one-ended ace boundary", () => {
    expect(analyze(["8s", "Th"], ["Jc", "Qd", "Ah"]).draws.find((d) => d.kind === "double-gutshot")?.potentialOuts).toHaveLength(8);
    expect(analyze(["As", "2h"], ["3c", "4d", "Kh"]).draws.find((d) => d.kind === "gutshot")?.potentialOuts).toHaveLength(4);
  });
  it("does not double count overlapping combo outs", () => {
    const r = analyze(["8h", "9h"], ["6h", "7c", "Kh"]);
    expect(r.draws.find((d) => d.kind === "combo")?.potentialOuts).toHaveLength(15);
    expect(new Set(r.outs).size).toBe(r.outs.length);
  });
  it("does not invent front-door draws on dry boards, river or made straights", () => {
    expect(analyze(["2s", "7d"], ["Kc", "9h", "4s"]).draws).toHaveLength(0);
    expect(analyze(["8s", "9h"], ["6c", "7d", "Kh", "As", "2c"]).draws).toHaveLength(0);
    expect(analyze(["8s", "9h"], ["6c", "7d", "Th"]).draws.some((d) => d.kind === "oesd")).toBe(false);
  });
  it("finds overcards, pair, two-pair and set improvements", () => {
    for (const [hole, board] of [
      [["As", "Kh"], ["2c", "7d", "9h"]], [["9s", "9h"], ["Qc", "7d", "2h"]],
      [["9s", "Qh"], ["Qc", "9d", "2h"]], [["9s", "9h"], ["9c", "7d", "2h"]],
    ] as [Card[], Card[]][]) expect(analyze(hole, board).draws.find((d) => d.kind === "improvement")?.potentialOuts.length).toBeGreaterThan(0);
  });
  it("handles shared trips AAA47 without pretending the player has a private set", () => {
    const r = analyze(["Ks", "Qh"], ["As", "Ah", "Ad", "4c", "7d"]);
    expect(r.madeHand).toBe("Тройка тузов"); expect(r.bestFiveCards).toEqual(["As", "Ah", "Ad", "Ks", "Qh"]);
    expect(r.boardTexture.metrics.trips).toBe(true); expect(r.warnings.join(" ")).toContain("Доска");
  });
  it("uses board best five when the board plays", () => {
    const board: Card[] = ["As", "Ks", "Qs", "Js", "Ts"];
    expect(analyze(["2c", "3d"], board).bestFiveCards).toEqual(board);
  });
  it("calculates pot odds separately from strength", () => {
    const r = analyzeSituation(["As", "Kd"], ["2c", "5h", "8d"], "ru", { pot: 800, call: 200, contestablePotAfter: 1000 });
    expect(r.potOdds?.requiredEquity).toBe(.2); expect(r.potOdds?.potAfter).toBe(1000);
    expect(r).not.toHaveProperty("equity");
  });
  it("explains monotone and connected board facts", () => {
    const r = analyze(["As", "2d"], ["8h", "9h", "Jh"]);
    expect(r.boardTexture.metrics.monotone).toBe(true);
    expect(r.boardTexture.reasons).toHaveLength(2);
  });
});

describe("coach action-time context and privacy", () => {
  it.each([1, 2, 3] as const)("keeps reports read-only and private through %i-opponent all-in hands", (opponentCount) => {
    const store = new SessionStore(); const s = store.create({ ...cfg, opponentCount }, () => 0);
    let n = 0;
    while (s.state.actor) {
      const id = s.state.actor;
      const snapshot = captureCoachSnapshot(s.state, id);
      const legal = getLegalActions(s.state, id);
      const a = legal.find((a) => a.type === "all-in") ?? legal.find((a) => a.type === "call") ?? legal[0];
      applyAction(s.state, id, { type: a.type, amount: a.min }); s.coachSnapshots.push(snapshot);
      const before = JSON.stringify(s.state);
      const report = store.coach(s);
      for (const d of report.decisions) if (d.player !== "human" && !s.state.players[d.player]!.showCards) {
        expect(d.analysis).toBeUndefined(); expect(d.technicalData).toBeUndefined();
      }
      expect(JSON.stringify(report)).not.toMatch(/randomRoll|initialHoleCards|burnCards|rawResponse|aiHoleCards/);
      expect(JSON.stringify(s.state)).toBe(before);
      assertChipAccounting(s.state); assertCardIntegrity(s.state);
      if (++n > 30) throw new Error("Non-terminating all-in hand");
    }
    expect(store.coach(s).showdown).toHaveLength(opponentCount + 1);
  });
  it("reports committed actions only and hides internal AI metadata even after a fold", () => {
    const store = new SessionStore(); const s = store.create(cfg, () => 0);
    expect(store.coach(s).decisions).toHaveLength(0);
    applyAction(s.state, "human", { type: "call" });
    const snap = captureCoachSnapshot(s.state, "ai");
    snap.decision = { coachIntent: "value", postflopStrength: .999, raiseThreshold: .9 };
    applyAction(s.state, "ai", { type: "raise", amount: 300 }); s.coachSnapshots.push(snap);
    const active = store.coach(s);
    expect(active.decisions[0].analysis).toBeUndefined(); expect(active.decisions[0].technicalData).toBeUndefined();
    applyAction(s.state, "human", { type: "fold" });
    const complete = store.coach(s);
    expect(complete.decisions[0].technicalData).toBeUndefined(); expect(complete.showdown).toEqual([]);
    // Even changing hidden cards / metadata cannot change the coach response.
    s.state.players.ai.cards = ["As", "Ks"]; snap.decision.coachIntent = "pressure";
    expect(store.coach(s)).toEqual(complete);
  });
  it("uses action-time board and pot instead of the river result", () => {
    const store = new SessionStore(); const s = store.create(cfg, () => 0);
    const snap = captureCoachSnapshot(s.state, "human");
    applyAction(s.state, "human", { type: "call" }); s.coachSnapshots.push(snap);
    while (s.state.actor) { const a = getLegalActions(s.state, s.state.actor).find((a) => a.type === "check" || a.type === "call")!; applyAction(s.state, s.state.actor, { type: a.type }); }
    const r = store.coach(s);
    expect(r.decisions[0].board).toEqual([]); expect(r.decisions[0].analysis?.potOdds?.call).toBe(50);
    expect(r.decisions[0].analysis?.bestFiveCards).toEqual([]); expect(r.current.bestFiveCards).toHaveLength(5);
  });
  it("explains an actual pressure branch after river showdown", () => {
    const store = new SessionStore(); const s = store.create(cfg, () => 0);
    const hole: Card[] = ["9h", "9s", "Kc", "5d"];
    s.state.players.human.cards = hole.slice(0, 2); s.state.players.ai.cards = hole.slice(2);
    s.state.initialHoleCards = { human: hole.slice(0, 2), ai: hole.slice(2) };
    const runout: Card[] = ["2h", "Qd", "8c", "3s", "4h", "Td", "6h", "2c"];
    s.state.deck = [...createDeck().filter((c) => ![...hole, ...runout].includes(c)), ...runout.reverse()];
    while (s.state.street !== "river") { const a = getLegalActions(s.state, s.state.actor!).find((a) => a.type === "check" || a.type === "call")!; applyAction(s.state, s.state.actor!, { type: a.type }); }
    const snap = captureCoachSnapshot(s.state, "ai"); snap.decision = { coachIntent: "pressure", postflopStrength: .289, raiseThreshold: .7 };
    applyAction(s.state, "ai", { type: "bet", amount: 100 }); s.coachSnapshots.push(snap);
    applyAction(s.state, "human", { type: "call" });
    const d = store.coach(s).decisions[0];
    expect(d.actionCategory).toContain("Блеф"); expect(d.explanation).toContain("Старшая карта K"); expect(d.explanation).toContain("требовался фолд");
    expect(d.technicalData?.strength).toBe(.289);
  });
  it("caps call odds to the short stack's contestable pot in multiway", () => {
    const store = new SessionStore(); const s = store.create({ ...cfg, opponentCount: 2 }, () => 0);
    s.state.players.human.stack = 100; s.state.players.ai.stack += 900;
    applyAction(s.state, "human", { type: "call" });
    // Human is all-in; no current call recommendation should appear.
    expect(store.coach(s).current.potOdds).toBeUndefined();
    assertChipAccounting(s.state); assertCardIntegrity(s.state);
    const store2 = new SessionStore(); const s2 = store2.create({ ...cfg, opponentCount: 2 }, () => 0);
    applyAction(s2.state, "human", { type: "raise", amount: 400 });
    s2.state.players.ai.stack = 50; s2.state.players["ai-2"]!.stack += 900;
    const snapshot = captureCoachSnapshot(s2.state, "ai");
    expect(snapshot.call).toBe(50); expect(snapshot.contestablePotAfter).toBe(300);
    assertChipAccounting(s2.state);
  });
  it("records real session actions, renders coach cards, and resets on the next hand", () => {
    const rng = vi.spyOn(Math, "random").mockReturnValue(.99);
    try {
      const store = new SessionStore(); const s = store.create(cfg, () => 0);
      let guard = 0;
      while (s.state.street !== "complete") {
        const legal = getLegalActions(s.state, "human"); const choice = legal.find((a) => a.type === "call" || a.type === "check")!;
        store.act(s, { type: choice.type } as EngineAction); if (++guard > 80) throw new Error("Non-terminating hand");
      }
      const r = store.coach(s); expect(r.decisions.length).toBeGreaterThan(3);
      const markup = renderToStaticMarkup(<CoachPanel report={r} language="ru" onClose={() => {}} />);
      expect(markup).toContain("Лучшие 5 карт"); expect(markup).not.toContain("card-back");
      const table = store.publicState(s);
      expect(renderToStaticMarkup(<PokerTable game={table} language="ru" coach={r.current} />)).toContain("coach-made");
      expect(renderToStaticMarkup(<PokerTable game={table} language="ru" />)).not.toContain("coach-made");
      // Use a small check-through hand for next-hand reset; the bot hand above may end the match.
      const reset = store.create(cfg, () => 0);
      while (reset.state.actor) {
        const id = reset.state.actor;
        const snapshot = captureCoachSnapshot(reset.state, id);
        const choice = getLegalActions(reset.state, id).find((a) => a.type === "call" || a.type === "check")!;
        applyAction(reset.state, id, { type: choice.type }); reset.coachSnapshots.push(snapshot);
      }
      const oldId = reset.state.handId;
      store.next(reset); expect(store.coach(reset).handId).not.toBe(oldId);
      expect(store.coach(reset).decisions.every((d) => d.street === "preflop")).toBe(true);
    } finally { rng.mockRestore(); }
  });
});
