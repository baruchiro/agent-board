import { db, touchHost, type Column, type Host } from "./db";

const REDACT_KEEP = Number(process.env.REDACT_KEEP ?? 200);

export interface HookPayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  model?: string;
  [k: string]: unknown;
}

/**
 * Which column an event moves its task into. `null` means "leave the column
 * alone" — the event is activity, not a transition.
 *
 * Derived from Kanban Code's hook-driven columns (§6), which are already
 * proven against real sessions.
 */
function columnFor(type: string, payload: HookPayload): Column | null {
  switch (type) {
    case "SessionStart":
    case "UserPromptSubmit":
    case "PreCompact":
    case "SubagentStart":
      return "in_progress";

    case "PermissionRequest":
      return "waiting";

    case "Notification":
      // Only permission-shaped notifications block on a human.
      return String(payload.notification_type ?? "").includes("permission")
        ? "waiting"
        : null;

    case "Stop":
      // A Stop fired by a stop-hook loop is not the session going idle.
      return payload.stop_hook_active ? null : "idle";

    case "SessionEnd":
      return "done";

    // PreToolUse / PostToolUse / PostToolUseFailure / SubagentStop are
    // activity: they keep the session warm without changing the column.
    default:
      return null;
  }
}

/** Keep a bounded prefix plus a hash, so long values stay comparable. §10.4 */
function redact(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.length <= REDACT_KEEP) return value;
  const digest = new Bun.CryptoHasher("sha256").update(value).digest("hex").slice(0, 12);
  return `${value.slice(0, REDACT_KEEP)}… [+${value.length - REDACT_KEEP} chars, sha256:${digest}]`;
}

/**
 * A short, human-readable line for the card. Deliberately computed locally —
 * disler's server calls an LLM per event, which costs money and latency on a
 * path that must never delay the agent.
 */
function summarize(type: string, payload: HookPayload): string | null {
  const tool = payload.tool_name as string | undefined;
  const input = (payload.tool_input ?? {}) as Record<string, unknown>;

  switch (type) {
    case "UserPromptSubmit":
      return redact(payload.prompt);
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure": {
      const detail =
        redact(input.command) ??
        (typeof input.file_path === "string" ? input.file_path : null) ??
        redact(input.pattern) ??
        redact(input.description);
      return detail ? `${tool}: ${detail}` : (tool ?? null);
    }
    case "Notification":
      return redact(payload.message) ?? (payload.notification_type as string) ?? null;
    case "SessionEnd":
      return (payload.reason as string) ?? null;
    default:
      return redact(payload.error) ?? null;
  }
}

function titleFromCwd(cwd: string | undefined): string {
  if (!cwd) return "untitled session";
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

export interface IngestResult {
  session_id: string;
  task_id: number;
  column: Column;
}

export function ingest(host: Host, payload: HookPayload): IngestResult | null {
  const type = payload.hook_event_name;
  const sessionId = payload.session_id;
  if (!type || !sessionId) return null;

  const now = Date.now();
  const transition = columnFor(type, payload);

  const existing = db
    .query("SELECT id, task_id FROM session WHERE id = ?")
    .get(sessionId) as { id: string; task_id: number } | null;

  let taskId: number;

  if (existing) {
    taskId = existing.task_id;
    db.run(
      `UPDATE session
          SET last_event_at = ?,
              state         = ?,
              cwd           = COALESCE(?, cwd),
              model         = COALESCE(?, model),
              transcript_path = COALESCE(?, transcript_path)
        WHERE id = ?`,
      [now, type, payload.cwd ?? null, payload.model ?? null, payload.transcript_path ?? null, sessionId],
    );
  } else {
    // A session we have never heard of creates its own card. This is what
    // makes unsolicited reports work: the board never had to launch it.
    const title = titleFromCwd(payload.cwd);
    db.run(
      `INSERT INTO task (title, board_column, created_by, created_at, updated_at)
       VALUES (?, ?, 'auto', ?, ?)`,
      [title, transition ?? "in_progress", now, now],
    );
    taskId = (db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id;

    db.run(
      `INSERT INTO session (id, task_id, host_id, cwd, model, transcript_path, state, started_at, last_event_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        taskId,
        host.id,
        payload.cwd ?? null,
        payload.model ?? null,
        payload.transcript_path ?? null,
        type,
        now,
        now,
      ],
    );
  }

  if (type === "SessionEnd") {
    db.run("UPDATE session SET ended_at = ?, end_reason = ? WHERE id = ?", [
      now,
      (payload.reason as string) ?? null,
      sessionId,
    ]);
  }

  const summary = summarize(type, payload);

  db.run(
    `INSERT INTO event (session_id, host_id, type, tool_name, tool_use_id, agent_id, agent_type, summary, payload_json, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      host.id,
      type,
      (payload.tool_name as string) ?? null,
      (payload.tool_use_id as string) ?? null,
      (payload.agent_id as string) ?? null,
      (payload.agent_type as string) ?? null,
      summary,
      host.retain_raw ? JSON.stringify(payload) : null,
      now,
    ],
  );

  // The first real prompt is a far better card title than the directory name.
  if (type === "UserPromptSubmit" && summary) {
    const task = db
      .query("SELECT title, created_by FROM task WHERE id = ?")
      .get(taskId) as { title: string; created_by: string };
    if (task.created_by === "auto" && task.title === titleFromCwd(payload.cwd)) {
      db.run("UPDATE task SET title = ?, updated_at = ? WHERE id = ?", [
        summary.split("\n")[0]!.slice(0, 120),
        now,
        taskId,
      ]);
    }
  }

  if (transition) {
    db.run("UPDATE task SET board_column = ?, updated_at = ? WHERE id = ?", [transition, now, taskId]);
  } else {
    db.run("UPDATE task SET updated_at = ? WHERE id = ?", [now, taskId]);
  }

  touchHost(host.id, now);

  const column = (db.query("SELECT board_column FROM task WHERE id = ?").get(taskId) as { board_column: Column }).board_column;
  return { session_id: sessionId, task_id: taskId, column };
}
