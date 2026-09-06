import Database from "better-sqlite3";
import { getDatabasePath } from "./paths";

const migration1 = `
CREATE TABLE profiles (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id),
  started_at TEXT NOT NULL, ended_at TEXT, opponent_count INTEGER NOT NULL,
  strategy TEXT NOT NULL, difficulty TEXT NOT NULL, starting_stack INTEGER NOT NULL,
  small_blind INTEGER NOT NULL, big_blind INTEGER NOT NULL, language TEXT NOT NULL,
  final_stack INTEGER, net_chips INTEGER, hands_played INTEGER NOT NULL DEFAULT 0,
  bb_per_100 REAL NOT NULL DEFAULT 0
);
CREATE INDEX sessions_profile_idx ON sessions(profile_id, started_at DESC);
CREATE TABLE hands (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  hand_number INTEGER NOT NULL, engine_hand_id TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL, completed_at TEXT NOT NULL, button TEXT NOT NULL,
  small_blind_player TEXT NOT NULL, big_blind_player TEXT NOT NULL,
  board_json TEXT NOT NULL, positions_json TEXT NOT NULL, seats_json TEXT NOT NULL,
  result_json TEXT NOT NULL, metrics_json TEXT NOT NULL, human_contribution INTEGER NOT NULL,
  human_payout INTEGER NOT NULL, human_net INTEGER NOT NULL, reached_showdown INTEGER NOT NULL,
  won_without_showdown INTEGER NOT NULL, folded_street TEXT, total_pot INTEGER NOT NULL,
  tags_json TEXT NOT NULL, is_marked_for_review INTEGER NOT NULL DEFAULT 0,
  review_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX hands_session_idx ON hands(session_id, hand_number DESC);
CREATE INDEX hands_completed_idx ON hands(completed_at DESC);
CREATE TABLE hand_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, hand_id TEXT NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL, player_id TEXT NOT NULL, street TEXT NOT NULL, action TEXT NOT NULL,
  amount INTEGER, effective_amount INTEGER, aggressive INTEGER, created_at TEXT NOT NULL,
  UNIQUE(hand_id, sequence)
);
CREATE TABLE hand_players (
  hand_id TEXT NOT NULL REFERENCES hands(id) ON DELETE CASCADE, player_id TEXT NOT NULL,
  player_kind TEXT NOT NULL, seat_index INTEGER NOT NULL, position TEXT NOT NULL,
  starting_stack INTEGER NOT NULL, ending_stack INTEGER NOT NULL, contribution INTEGER NOT NULL,
  payout INTEGER NOT NULL, folded INTEGER NOT NULL, all_in INTEGER NOT NULL,
  eliminated INTEGER NOT NULL, hole_cards_json TEXT, revealed_at_showdown INTEGER NOT NULL,
  PRIMARY KEY(hand_id, player_id)
);
CREATE TABLE hand_pots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, hand_id TEXT NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
  pot_index INTEGER NOT NULL, amount INTEGER NOT NULL, eligible_json TEXT NOT NULL,
  winners_json TEXT NOT NULL, payouts_json TEXT NOT NULL, UNIQUE(hand_id, pot_index)
);
`;

export function openDatabase(path = getDatabasePath()): Database.Database {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const version = (db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number }).version;
  if (version < 1) db.transaction(() => {
    db.exec(migration1);
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)").run(new Date().toISOString());
  })();
  return db;
}
