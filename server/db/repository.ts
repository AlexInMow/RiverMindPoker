import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import type { EngineState } from "../../poker-engine/game";
import type { Card, GameConfig, PlayerId, SettledPotResult } from "../../shared/types";
import type {
  HistoryExport, HistoryFilters, LifetimeStats, LocalPlayerProfile,
  StoredHandDetail, StoredHandSummary, StoredSessionSummary,
} from "../../shared/history";
import type { RawStatsSnapshot } from "../stats";
import { getBackupDirectory } from "./paths";

type Params = Array<string | number>;
const json = JSON.stringify;
const parse = <T>(value: string): T => JSON.parse(value) as T;
const now = () => new Date().toISOString();
const bool = (value: unknown) => Boolean(value);
const cleanName = (value: string): string => {
  const name = value.trim();
  if (!name || name.length > 40) throw new Error("Profile name must contain 1–40 characters");
  return name;
};

function profileRow(row: any): LocalPlayerProfile {
  return { id: row.id, displayName: row.display_name, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at };
}

function sessionRow(row: any): StoredSessionSummary {
  return {
    id: row.id, startedAt: row.started_at, endedAt: row.ended_at,
    opponentCount: row.opponent_count, strategy: row.strategy, difficulty: row.difficulty,
    startingStack: row.starting_stack, finalStack: row.final_stack, netChips: row.net_chips,
    handsPlayed: row.hands_played, bbPer100: row.bb_per_100,
  };
}

function handRow(row: any): StoredHandSummary {
  return {
    id: row.id, sessionId: row.session_id, handNumber: row.hand_number,
    completedAt: row.completed_at, humanNet: row.human_net, totalPot: row.total_pot,
    opponentCount: row.opponent_count, strategy: row.strategy,
    reachedShowdown: bool(row.reached_showdown), foldedStreet: row.folded_street,
    tags: parse(row.tags_json), isMarkedForReview: bool(row.is_marked_for_review),
    reviewNote: row.review_note,
  };
}

function filterSql(profileId: string, filters: HistoryFilters): { where: string; params: Params; limit: number; offset: number } {
  const clauses = ["s.profile_id = ?"];
  const params: Params = [profileId];
  if (filters.scope === "session" && filters.sessionId) { clauses.push("h.session_id = ?"); params.push(filters.sessionId); }
  if (filters.tableSize) { clauses.push("s.opponent_count = ?"); params.push(filters.tableSize - 1); }
  if (filters.strategy) { clauses.push("s.strategy = ?"); params.push(filters.strategy); }
  if (filters.showdown === "showdown") clauses.push("h.reached_showdown = 1");
  if (filters.showdown === "no-showdown") clauses.push("h.reached_showdown = 0");
  if (filters.result === "profitable") clauses.push("h.human_net > 0");
  if (filters.result === "losing") clauses.push("h.human_net < 0");
  if (filters.result === "neutral") clauses.push("h.human_net = 0");
  if (filters.marked) clauses.push("h.is_marked_for_review = 1");
  const scopeLimit = filters.scope === "last100" ? 100 : filters.scope === "last500" ? 500 : 50;
  return { where: clauses.join(" AND "), params, limit: Math.min(500, Math.max(1, filters.limit ?? scopeLimit)), offset: Math.max(0, filters.offset ?? 0) };
}

function difference(after: RawStatsSnapshot, before: RawStatsSnapshot): RawStatsSnapshot {
  return Object.fromEntries(Object.keys(after).map((key) => [key, after[key as keyof RawStatsSnapshot] - before[key as keyof RawStatsSnapshot]])) as unknown as RawStatsSnapshot;
}

export class PokerRepository {
  constructor(readonly db: Database.Database) {}

  listProfiles(includeDeleted = false): LocalPlayerProfile[] {
    const rows = this.db.prepare(`SELECT * FROM profiles ${includeDeleted ? "" : "WHERE deleted_at IS NULL"} ORDER BY updated_at DESC`).all();
    return rows.map(profileRow);
  }

  getProfile(id: string, includeDeleted = false): LocalPlayerProfile {
    const row = this.db.prepare(`SELECT * FROM profiles WHERE id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`).get(id);
    if (!row) throw new Error("Profile not found");
    return profileRow(row);
  }

  createProfile(displayName: string): LocalPlayerProfile {
    displayName = cleanName(displayName);
    const timestamp = now();
    const id = randomUUID();
    this.db.prepare("INSERT INTO profiles(id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, displayName, timestamp, timestamp);
    return this.getProfile(id);
  }

  renameProfile(id: string, displayName: string): LocalPlayerProfile {
    displayName = cleanName(displayName);
    const result = this.db.prepare("UPDATE profiles SET display_name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(displayName, now(), id);
    if (!result.changes) throw new Error("Profile not found");
    return this.getProfile(id);
  }

  deleteProfile(id: string): void {
    const result = this.db.prepare("UPDATE profiles SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(now(), now(), id);
    if (!result.changes) throw new Error("Profile not found");
  }

  createSession(id: string, profileId: string, config: GameConfig): void {
    this.getProfile(profileId);
    this.db.prepare(`INSERT INTO sessions(id, profile_id, started_at, opponent_count, strategy, difficulty, starting_stack, small_blind, big_blind, language)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, profileId, now(), config.opponentCount ?? 1, config.strategy, config.difficulty, config.startingStack, config.smallBlind, config.bigBlind, config.language);
  }

  finishSession(id: string, finalStack: number | undefined, handsPlayed: number, bigBlind: number): void {
    const row = this.db.prepare("SELECT starting_stack, final_stack FROM sessions WHERE id = ?").get(id) as { starting_stack: number; final_stack: number | null } | undefined;
    if (!row) return;
    const settledFinalStack = finalStack ?? row.final_stack ?? row.starting_stack;
    const net = settledFinalStack - row.starting_stack;
    const bbPer100 = handsPlayed ? Number((net / bigBlind / handsPlayed * 100).toFixed(1)) : 0;
    this.db.prepare("UPDATE sessions SET ended_at = COALESCE(ended_at, ?), final_stack = ?, net_chips = ?, hands_played = ?, bb_per_100 = ? WHERE id = ?")
      .run(now(), settledFinalStack, net, handsPlayed, bbPer100, id);
  }

  persistCompletedHand(input: {
    profileId: string; sessionId: string; state: EngineState; startedAt: string;
    statsBefore: RawStatsSnapshot; statsAfter: RawStatsSnapshot;
  }): boolean {
    const { state } = input;
    if (!state.result) throw new Error("Cannot persist an incomplete hand");
    const completedAt = now();
    const result = state.result;
    const contributions = result.contributions ?? {};
    const humanContribution = contributions.human ?? 0;
    const humanPayout = result.payouts.human ?? 0;
    const humanNet = humanPayout - humanContribution;
    const reachedShowdown = result.endReason === "showdown" || Boolean(result.evaluatedHands);
    const humanFold = [...state.actions].reverse().find((action) => action.player === "human" && action.action === "fold");
    const tags = this.tagsFor(state, reachedShowdown);
    const metrics = difference(input.statsAfter, input.statsBefore);
    const insert = this.db.transaction(() => {
      const added = this.db.prepare(`INSERT OR IGNORE INTO hands(
        id, session_id, hand_number, engine_hand_id, started_at, completed_at, button,
        small_blind_player, big_blind_player, board_json, positions_json, seats_json,
        result_json, metrics_json, human_contribution, human_payout, human_net,
        reached_showdown, won_without_showdown, folded_street, total_pot, tags_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        state.handId, input.sessionId, state.handNumber, state.handId, input.startedAt, completedAt,
        state.button, state.smallBlindPlayer, state.bigBlindPlayer, json(state.board), json(state.positions),
        json(state.seats), json(result), json(metrics), humanContribution, humanPayout, humanNet,
        reachedShowdown ? 1 : 0, !reachedShowdown && humanPayout > 0 ? 1 : 0,
        humanFold?.street ?? null, result.pot, json(tags),
      );
      if (!added.changes) return false;
      const actionStatement = this.db.prepare(`INSERT INTO hand_actions(hand_id, sequence, player_id, street, action, amount, effective_amount, aggressive, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      state.actions.forEach((action, sequence) => actionStatement.run(state.handId, sequence, action.player, action.street, action.action, action.amount ?? null, action.effectiveAmount ?? null, action.aggressive === undefined ? null : Number(action.aggressive), new Date(action.at).toISOString()));
      const playerStatement = this.db.prepare(`INSERT INTO hand_players(hand_id, player_id, player_kind, seat_index, position, starting_stack, ending_stack, contribution, payout, folded, all_in, eliminated, hole_cards_json, revealed_at_showdown)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const seat of state.seats) {
        const current = state.players[seat.playerId]!;
        const contribution = contributions[seat.playerId] ?? 0;
        const payout = result.payouts[seat.playerId] ?? 0;
        const revealed = seat.playerId === "human" || current.showCards;
        const wasAllIn = state.actions.some((action) => action.player === seat.playerId && action.action === "all-in");
        playerStatement.run(state.handId, seat.playerId, seat.kind, seat.seatIndex, state.positions[seat.playerId] ?? "", current.stack - payout + contribution, current.stack, contribution, payout, Number(current.folded), Number(wasAllIn), Number(current.eliminated), revealed ? json(current.cards) : null, Number(revealed && seat.playerId !== "human"));
      }
      const potStatement = this.db.prepare("INSERT INTO hand_pots(hand_id, pot_index, amount, eligible_json, winners_json, payouts_json) VALUES (?, ?, ?, ?, ?, ?)");
      for (const pot of result.pots ?? []) potStatement.run(state.handId, pot.index, pot.amount, json(pot.eligible), json(pot.winners), json(pot.payouts));
      const handsPlayed = input.statsAfter.completed;
      const net = state.players.human.stack - state.config.startingStack;
      const bbPer100 = handsPlayed ? Number((net / state.config.bigBlind / handsPlayed * 100).toFixed(1)) : 0;
      this.db.prepare("UPDATE sessions SET final_stack = ?, net_chips = ?, hands_played = ?, bb_per_100 = ?, ended_at = CASE WHEN ? THEN ? ELSE ended_at END WHERE id = ?")
        .run(state.players.human.stack, net, handsPlayed, bbPer100, Number(state.matchOver), completedAt, input.sessionId);
      return true;
    });
    return insert();
  }

  private tagsFor(state: EngineState, showdown: boolean): string[] {
    const tags: string[] = [];
    if (state.result!.pot >= state.config.bigBlind * 40) tags.push("big-pot");
    if (state.actions.some((action) => action.action === "all-in")) tags.push("all-in");
    if (state.actions.some((action) => action.street === "preflop" && action.action === "all-in")) tags.push("preflop-all-in");
    if (showdown) tags.push("showdown");
    if ((state.result!.pots?.length ?? 0) > 1) tags.push("side-pot");
    if (state.seats.length > 2) tags.push("multiway");
    if (state.actions.some((action) => action.player === "human" && action.street === "river" && ["call", "bet", "raise", "all-in", "fold"].includes(action.action))) tags.push("river-decision");
    if (showdown && (state.result!.payouts.human ?? 0) === 0 && state.actions.some((action) => action.player === "human" && action.aggressive)) tags.push("bluff-candidate");
    return tags;
  }

  listSessions(profileId: string, limit = 50, offset = 0): StoredSessionSummary[] {
    this.getProfile(profileId, true);
    return this.db.prepare("SELECT * FROM sessions WHERE profile_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?").all(profileId, Math.min(500, limit), offset).map(sessionRow);
  }

  listHands(profileId: string, filters: HistoryFilters = {}): StoredHandSummary[] {
    this.getProfile(profileId, true);
    const query = filterSql(profileId, filters);
    const rows = this.db.prepare(`SELECT h.*, s.opponent_count, s.strategy FROM hands h JOIN sessions s ON s.id = h.session_id WHERE ${query.where} ORDER BY h.completed_at DESC LIMIT ? OFFSET ?`)
      .all(...query.params, query.limit, query.offset);
    return rows.map(handRow);
  }

  getHand(id: string): StoredHandDetail {
    const row = this.db.prepare(`SELECT h.*, s.opponent_count, s.strategy, s.small_blind, s.big_blind FROM hands h JOIN sessions s ON s.id = h.session_id WHERE h.id = ?`).get(id) as any;
    if (!row) throw new Error("Hand not found");
    const actions = (this.db.prepare("SELECT * FROM hand_actions WHERE hand_id = ? ORDER BY sequence").all(id) as any[]).map((action) => ({ player: action.player_id, street: action.street, action: action.action, amount: action.amount ?? undefined, effectiveAmount: action.effective_amount ?? undefined, aggressive: action.aggressive === null ? undefined : bool(action.aggressive), at: Date.parse(action.created_at) }));
    const players = (this.db.prepare("SELECT * FROM hand_players WHERE hand_id = ? ORDER BY seat_index").all(id) as any[]).map((player) => ({ playerId: player.player_id, playerKind: player.player_kind, seatIndex: player.seat_index, position: player.position, startingStack: player.starting_stack, endingStack: player.ending_stack, contribution: player.contribution, payout: player.payout, folded: bool(player.folded), allIn: bool(player.all_in), eliminated: bool(player.eliminated), holeCards: player.hole_cards_json ? parse<Card[]>(player.hole_cards_json) : null, revealedAtShowdown: bool(player.revealed_at_showdown) }));
    const pots: SettledPotResult[] = (this.db.prepare("SELECT * FROM hand_pots WHERE hand_id = ? ORDER BY pot_index").all(id) as any[]).map((pot) => ({ index: pot.pot_index, amount: pot.amount, eligible: parse<PlayerId[]>(pot.eligible_json), winners: parse<PlayerId[]>(pot.winners_json), payouts: parse<Record<string, number>>(pot.payouts_json) }));
    return { ...handRow(row), engineHandId: row.engine_hand_id, startedAt: row.started_at, button: row.button, smallBlindPlayer: row.small_blind_player, bigBlindPlayer: row.big_blind_player, smallBlind: row.small_blind, bigBlind: row.big_blind, board: parse(row.board_json), positions: parse(row.positions_json), seats: parse(row.seats_json), actions, players, pots, result: parse(row.result_json), humanContribution: row.human_contribution, humanPayout: row.human_payout };
  }

  updateReview(id: string, marked: boolean, note: string): StoredHandDetail {
    const result = this.db.prepare("UPDATE hands SET is_marked_for_review = ?, review_note = ? WHERE id = ?").run(Number(marked), note, id);
    if (!result.changes) throw new Error("Hand not found");
    return this.getHand(id);
  }

  lifetimeStats(profileId: string, filters: HistoryFilters = {}): LifetimeStats {
    this.getProfile(profileId, true);
    const query = filterSql(profileId, filters);
    const scopeLimit = filters.scope === "last100" ? 100 : filters.scope === "last500" ? 500 : null;
    const detailedRows = this.db.prepare(`SELECT h.*, s.opponent_count, s.strategy, s.big_blind FROM hands h JOIN sessions s ON s.id=h.session_id WHERE ${query.where} ORDER BY h.completed_at DESC ${scopeLimit ? "LIMIT ?" : ""}`)
      .all(...query.params, ...(scopeLimit ? [scopeLimit] : [])) as any[];
    const hands = detailedRows.map(handRow);
    const sum = (key: keyof RawStatsSnapshot) => detailedRows.reduce((total, row) => total + (parse<RawStatsSnapshot>(row.metrics_json)[key] ?? 0), 0);
    const pct = (value: number, denominator: number) => denominator ? Math.round(value / denominator * 100) : 0;
    const foldOpp = sum("foldOpportunities"), fold3Opp = sum("foldToThreeBetOpportunities"), foldCBetOpp = sum("foldToCBetOpportunities");
    const flopOpp = sum("flopCBetOpportunities"), turnOpp = sum("turnBarrelOpportunities"), riverOpp = sum("riverOpportunities"), checkOpp = sum("checkRaiseOpportunities");
    const sawFlop = sum("sawFlopHands"), showdowns = sum("showdowns");
    const net = hands.reduce((total, hand) => total + hand.humanNet, 0);
    const sessions = new Set(hands.map((hand) => hand.sessionId)).size;
    const netBigBlinds = detailedRows.reduce((total, row) => total + row.human_net / row.big_blind, 0);
    const biggestWin = [...hands].filter((hand) => hand.humanNet > 0).sort((a, b) => b.humanNet - a.humanNet)[0] ?? null;
    const biggestLoss = [...hands].filter((hand) => hand.humanNet < 0).sort((a, b) => a.humanNet - b.humanNet)[0] ?? null;
    const potsWon = detailedRows.reduce((total, row) => total + (parse<any>(row.result_json).pots ?? []).filter((pot: any) => (pot.payouts?.human ?? 0) > 0).length, 0);
    return {
      sessions, hands: hands.length, netChips: net, bbPer100: hands.length ? Number((netBigBlinds / hands.length * 100).toFixed(1)) : 0,
      profitableHands: hands.filter((hand) => hand.humanNet > 0).length,
      handsWithPayout: detailedRows.filter((row) => row.human_payout > 0).length, potsWon,
      showdowns, showdownsWithPayout: detailedRows.filter((row) => row.reached_showdown && row.human_payout > 0).length,
      vpip: pct(sum("vpipHands"), hands.length), pfr: pct(sum("pfrHands"), hands.length), threeBet: pct(sum("threeBetHands"), hands.length),
      foldFrequency: pct(sum("foldsFacingBet"), foldOpp), foldOpportunities: foldOpp,
      foldToThreeBet: pct(sum("foldsToThreeBet"), fold3Opp), foldToThreeBetOpportunities: fold3Opp,
      foldToCBet: pct(sum("foldsToCBet"), foldCBetOpp), foldToCBetOpportunities: foldCBetOpp,
      flopCBet: pct(sum("flopCBets"), flopOpp), flopCBetOpportunities: flopOpp,
      turnBarrel: pct(sum("turnBarrels"), turnOpp), turnBarrelOpportunities: turnOpp,
      riverAggression: pct(sum("riverAggressiveHands"), riverOpp), riverOpportunities: riverOpp,
      checkRaise: pct(sum("checkRaises"), checkOpp), checkRaiseOpportunities: checkOpp,
      wentToShowdown: pct(showdowns, sawFlop), wonAtShowdown: pct(sum("showdownWon"), showdowns),
      biggestPot: hands.reduce((max, hand) => Math.max(max, hand.totalPot), 0), averagePot: hands.length ? Math.round(hands.reduce((total, hand) => total + hand.totalPot, 0) / hands.length) : 0,
      biggestWinningHand: biggestWin, biggestLosingHand: biggestLoss,
      profitHistory: [...hands].reverse().reduce<Array<{ hand: number; completedAt: string; cumulativeNet: number }>>((points, hand, index) => {
        points.push({ hand: index + 1, completedAt: hand.completedAt, cumulativeNet: (points.at(-1)?.cumulativeNet ?? 0) + hand.humanNet });
        return points;
      }, []),
    };
  }

  exportProfile(profileId: string, filters: HistoryFilters = {}): HistoryExport {
    const summaries: StoredHandSummary[] = [];
    const maximum = filters.scope === "last100" ? 100 : filters.scope === "last500" ? 500 : Number.POSITIVE_INFINITY;
    for (let offset = 0; offset < maximum; offset += 500) {
      const page = this.listHands(profileId, { ...filters, limit: Math.min(500, maximum - offset), offset });
      summaries.push(...page);
      if (page.length < 500 || summaries.length >= maximum) break;
    }
    return { format: "rivermind-history", version: 1, exportedAt: now(), profile: this.getProfile(profileId, true), filters, lifetimeStats: this.lifetimeStats(profileId, filters), sessions: this.listSessions(profileId, 500), hands: summaries.map((hand) => this.getHand(hand.id)) };
  }

  async backup(): Promise<string> {
    const stamp = new Date().toISOString().replaceAll(":", "-").replace("T", "-").slice(0, 19);
    const target = resolve(getBackupDirectory(), `rivermind-${stamp}.sqlite`);
    if (this.db.name === ":memory:") throw new Error("In-memory databases cannot be backed up");
    await this.db.backup(target);
    return target;
  }
}
