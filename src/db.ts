import { Database } from "bun:sqlite";

export const COLUMNS = [
  "backlog",
  "in_progress",
  "waiting",
  "idle",
  "done",
] as const;
export type Column = (typeof COLUMNS)[number];

export const HOST_KINDS = [
  "local",
  "desktop",
  "remote",
  "cloud",
  "unknown",
] as const;
export type HostKind = (typeof HOST_KINDS)[number];

export interface Host {
  id: number;
  name: string;
  kind: HostKind;
  retain_raw: number;
  created_at: number;
  last_seen_at: number | null;
}

const dbPath = process.env.DB_PATH ?? "./agent-board.sqlite";
export const db = new Database(dbPath, { create: true });

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// `column` is a reserved word in SQL, hence `board_column`.
db.exec(`
  CREATE TABLE IF NOT EXISTS host (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    kind        TEXT    NOT NULL,
    token_hash  TEXT    NOT NULL UNIQUE,
    retain_raw  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    last_seen_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS task (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    board_column TEXT    NOT NULL,
    repo         TEXT,
    branch       TEXT,
    external_ref TEXT,
    created_by   TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session (
    id              TEXT    PRIMARY KEY,
    task_id         INTEGER NOT NULL REFERENCES task(id),
    host_id         INTEGER NOT NULL REFERENCES host(id),
    cwd             TEXT,
    model           TEXT,
    transcript_path TEXT,
    state           TEXT    NOT NULL,
    started_at      INTEGER NOT NULL,
    last_event_at   INTEGER NOT NULL,
    ended_at        INTEGER,
    end_reason      TEXT
  );

  -- F4: everything the board filters by is a real column, not JSON in a blob.
  CREATE TABLE IF NOT EXISTS event (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT    NOT NULL,
    host_id      INTEGER NOT NULL REFERENCES host(id),
    type         TEXT    NOT NULL,
    tool_name    TEXT,
    tool_use_id  TEXT,
    agent_id     TEXT,
    agent_type   TEXT,
    summary      TEXT,
    payload_json TEXT,
    ts           INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS event_session_ts ON event(session_id, ts);
  CREATE INDEX IF NOT EXISTS event_ts         ON event(ts);
  CREATE INDEX IF NOT EXISTS session_task     ON session(task_id);
  CREATE INDEX IF NOT EXISTS task_column      ON task(board_column, updated_at);
`);

export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export function hostByToken(token: string): Host | null {
  if (!token) return null;
  return db
    .query("SELECT id, name, kind, retain_raw, created_at, last_seen_at FROM host WHERE token_hash = ?")
    .get(hashToken(token)) as Host | null;
}

export function hostByName(name: string): Host | null {
  return db
    .query("SELECT id, name, kind, retain_raw, created_at, last_seen_at FROM host WHERE name = ?")
    .get(name) as Host | null;
}

export function createHost(name: string, kind: HostKind, retainRaw = false): { host: Host; token: string } {
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  db.run(
    "INSERT INTO host (name, kind, token_hash, retain_raw, created_at) VALUES (?, ?, ?, ?, ?)",
    [name, kind, hashToken(token), retainRaw ? 1 : 0, Date.now()],
  );
  return { host: hostByName(name)!, token };
}

/**
 * The bucket for reports that arrive with no usable token.
 *
 * §10.2: an unset AGENT_BOARD_TOKEN interpolates to an empty string rather
 * than failing, so an unprovisioned host reports as `Bearer `. Filing those
 * under a real host makes that visible on the board instead of dropping them,
 * which is the detectable failure mode R2 was missing.
 */
export function unidentifiedHost(): Host {
  const existing = hostByName("unidentified");
  if (existing) return existing;
  db.run(
    "INSERT INTO host (name, kind, token_hash, retain_raw, created_at) VALUES (?, ?, ?, ?, ?)",
    ["unidentified", "unknown", hashToken(`sentinel:${crypto.randomUUID()}`), 0, Date.now()],
  );
  return hostByName("unidentified")!;
}

export function touchHost(hostId: number, ts: number): void {
  db.run("UPDATE host SET last_seen_at = ? WHERE id = ?", [ts, hostId]);
}
