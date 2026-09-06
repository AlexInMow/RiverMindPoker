import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { applyAction, createGame } from "../poker-engine/game";
import type { GameConfig } from "../shared/types";
import { openDatabase } from "../server/db/database";
import { PokerRepository } from "../server/db/repository";
import { SessionStore } from "../server/session";
import type { RawStatsSnapshot } from "../server/stats";

const config: GameConfig = { language: "ru", startingStack: 2_000, smallBlind: 25, bigBlind: 50, opponentCount: 1, strategy: "adaptive", difficulty: "strong", tableTalk: false, coachMode: false, debugMode: false };
const fixed = () => 0;

const zeroStats = (): RawStatsSnapshot => ({ completed: 0, vpipHands: 0, pfrHands: 0, threeBetHands: 0, sawFlopHands: 0, showdowns: 0, showdownWon: 0, foldOpportunities: 0, foldsFacingBet: 0, foldToThreeBetOpportunities: 0, foldsToThreeBet: 0, foldToCBetOpportunities: 0, foldsToCBet: 0, flopCBetOpportunities: 0, flopCBets: 0, turnBarrelOpportunities: 0, turnBarrels: 0, riverOpportunities: 0, riverAggressiveHands: 0, checkRaiseOpportunities: 0, checkRaises: 0, calls: 0, aggressiveActions: 0, betTotal: 0, betCount: 0 });

describe("SQLite player profiles and poker history", () => {
  let directory: string;
  let path: string;
  let db: Database.Database;
  let repository: PokerRepository;

  beforeEach(() => {
    directory = mkdtempSync(resolve(tmpdir(), "rivermind-test-"));
    path = resolve(directory, "test.sqlite");
    db = openDatabase(path);
    repository = new PokerRepository(db);
  });
  afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

  it("creates, renames and soft-deletes stable UUID profiles while allowing duplicate names", () => {
    const first = repository.createProfile("Александр");
    const second = repository.createProfile("Александр");
    expect(first.id).not.toBe(second.id);
    expect(repository.renameProfile(first.id, " Алекс ").displayName).toBe("Алекс");
    repository.deleteProfile(first.id);
    expect(repository.listProfiles().map((profile) => profile.id)).toEqual([second.id]);
    expect(repository.getProfile(first.id, true).deletedAt).not.toBeNull();
    expect(() => repository.createSession("deleted-profile-session", first.id, config)).toThrow(/not found/i);
  });

  it("persists a completed hand exactly once with ordered actions and no folded AI cards", () => {
    const profile = repository.createProfile("Hero");
    const other = repository.createProfile("Other");
    const store = new SessionStore(repository);
    const session = store.create(config, fixed, profile.id);
    store.act(session, { type: "fold" });
    const hands = repository.listHands(profile.id);
    expect(hands).toHaveLength(1);
    const hand = repository.getHand(hands[0].id);
    expect(hand.actions.map((action) => action.action)).toEqual(["small-blind", "big-blind", "fold", "wins"]);
    expect(hand.players.find((player) => player.playerId === "human")?.holeCards).toHaveLength(2);
    expect(hand.players.find((player) => player.playerId === "ai")?.holeCards).toBeNull();
    expect(hand.humanNet).toBe(-25);
    const current = session.tracker.rawSnapshot();
    expect(repository.persistCompletedHand({ profileId: profile.id, sessionId: session.id, state: session.state, startedAt: session.handStartedAt, statsBefore: current, statsAfter: current })).toBe(false);
    expect(repository.listHands(profile.id)).toHaveLength(1);
    expect(repository.listSessions(profile.id)).toHaveLength(1);
    expect(repository.listSessions(other.id)).toHaveLength(0);
  });

  it("persists revealed showdown cards but never exports unknown cards", () => {
    const profile = repository.createProfile("Hero");
    const state = createGame(config, fixed);
    repository.createSession("showdown-session", profile.id, config);
    applyAction(state, "human", { type: "call" }); applyAction(state, "ai", { type: "check" });
    for (let street = 0; street < 3; street += 1) { applyAction(state, "ai", { type: "check" }); applyAction(state, "human", { type: "check" }); }
    const after = { ...zeroStats(), completed: 1, vpipHands: 1, sawFlopHands: 1, showdowns: 1, showdownWon: state.result!.payouts.human! > 0 ? 1 : 0 };
    repository.persistCompletedHand({ profileId: profile.id, sessionId: "showdown-session", state, startedAt: new Date().toISOString(), statsBefore: zeroStats(), statsAfter: after });
    const detail = repository.getHand(state.handId);
    expect(detail.players.find((player) => player.playerId === "ai")?.holeCards).toHaveLength(2);
    const exported = repository.exportProfile(profile.id);
    expect(exported).toMatchObject({ format: "rivermind-history", version: 1, profile: { id: profile.id } });
    expect(exported.hands[0].actions.length).toBeGreaterThan(0);
  });

  it("records a losing partial side-pot payout as negative net and preserves both pots", () => {
    const profile = repository.createProfile("Hero");
    const state = createGame({ ...config, opponentCount: 2 }, fixed);
    repository.createSession("side-session", profile.id, { ...config, opponentCount: 2 });
    state.result = { winners: ["ai-2", "human"], pot: 2_700, summary: "pots", contributions: { human: 1_000, ai: 1_000, "ai-2": 700 }, payouts: { human: 600, ai: 0, "ai-2": 2_100 }, pots: [
      { index: 0, amount: 2_100, eligible: ["human", "ai", "ai-2"], winners: ["ai-2"], payouts: { human: 0, ai: 0, "ai-2": 2_100 } },
      { index: 1, amount: 600, eligible: ["human", "ai"], winners: ["human"], payouts: { human: 600, ai: 0, "ai-2": 0 } },
    ] };
    repository.persistCompletedHand({ profileId: profile.id, sessionId: "side-session", state, startedAt: new Date().toISOString(), statsBefore: zeroStats(), statsAfter: { ...zeroStats(), completed: 1 } });
    const hand = repository.getHand(state.handId);
    expect(hand).toMatchObject({ humanContribution: 1_000, humanPayout: 600, humanNet: -400 });
    expect(hand.pots).toHaveLength(2);
    expect(repository.lifetimeStats(profile.id)).toMatchObject({ profitableHands: 0, handsWithPayout: 1, potsWon: 1, biggestLosingHand: { humanNet: -400 } });
  });

  it("aggregates lifetime stats across sessions and survives reopening the database", () => {
    const profile = repository.createProfile("Persistent");
    for (let index = 0; index < 2; index += 1) {
      const sessionId = `session-${index}`;
      const state = createGame(config, fixed);
      repository.createSession(sessionId, profile.id, config);
      applyAction(state, "human", { type: "fold" });
      const after = { ...zeroStats(), completed: 1, vpipHands: index, pfrHands: index };
      repository.persistCompletedHand({ profileId: profile.id, sessionId, state, startedAt: new Date().toISOString(), statsBefore: zeroStats(), statsAfter: after });
    }
    expect(repository.lifetimeStats(profile.id)).toMatchObject({ sessions: 2, hands: 2, vpip: 50, pfr: 50 });
    db.close();
    db = openDatabase(path); repository = new PokerRepository(db);
    expect(repository.listProfiles()[0]).toMatchObject({ id: profile.id, displayName: "Persistent" });
    expect(repository.listHands(profile.id)).toHaveLength(2);
  });

  it("stores review marks and notes in the versioned export", () => {
    const profile = repository.createProfile("Reviewer");
    const store = new SessionStore(repository); const session = store.create(config, fixed, profile.id); store.act(session, { type: "fold" });
    const id = repository.listHands(profile.id)[0].id;
    repository.updateReview(id, true, "Не уверен насчёт решения");
    const exported = repository.exportProfile(profile.id, { marked: true });
    expect(exported.hands).toHaveLength(1);
    expect(exported.hands[0]).toMatchObject({ isMarkedForReview: true, reviewNote: "Не уверен насчёт решения" });
    expect(JSON.stringify(exported)).not.toContain(session.state.players.ai.cards[0]);
  });

  it("separates profitable, neutral and losing hands and reports biggest results", () => {
    const profile = repository.createProfile("Results");
    const nets = [100, 0, -400];
    for (const [index, net] of nets.entries()) {
      const state = createGame(config, fixed);
      const sessionId = `result-session-${index}`;
      repository.createSession(sessionId, profile.id, config);
      const contribution = 500;
      state.result = { winners: net < 0 ? ["ai"] : ["human"], pot: 1_000, summary: "result", contributions: { human: contribution, ai: 500 }, payouts: { human: contribution + net, ai: 500 - net }, pots: [] };
      repository.persistCompletedHand({ profileId: profile.id, sessionId, state, startedAt: new Date().toISOString(), statsBefore: zeroStats(), statsAfter: { ...zeroStats(), completed: 1 } });
    }
    const stats = repository.lifetimeStats(profile.id);
    expect(stats).toMatchObject({ hands: 3, profitableHands: 1, biggestWinningHand: { humanNet: 100 }, biggestLosingHand: { humanNet: -400 } });
    expect(repository.listHands(profile.id, { result: "profitable" })).toHaveLength(1);
    expect(repository.listHands(profile.id, { result: "neutral" })).toHaveLength(1);
    expect(repository.listHands(profile.id, { result: "losing" })).toHaveLength(1);
  });
});
