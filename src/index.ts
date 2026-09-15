import { db, hostByToken, unidentifiedHost } from "./db";
import { ingest, type HookPayload } from "./ingest";
import { boardPage } from "./board";

const PORT = Number(process.env.PORT ?? 4100);

const subscribers = new Set<(data: string) => void>();

function broadcast(event: unknown): void {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const send of subscribers) {
    try {
      send(frame);
    } catch {
      subscribers.delete(send);
    }
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bearer(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.*)$/i);
  return (match?.[1] ?? "").trim();
}

export function board() {
  const tasks = db
    .query(
      `SELECT t.id, t.title, t.board_column, t.repo, t.branch, t.external_ref,
              t.created_by, t.updated_at,
              (SELECT COUNT(*) FROM session s WHERE s.task_id = t.id) AS sessions,
              (SELECT h.name FROM session s JOIN host h ON h.id = s.host_id
                WHERE s.task_id = t.id ORDER BY s.last_event_at DESC LIMIT 1) AS host,
              (SELECT h.kind FROM session s JOIN host h ON h.id = s.host_id
                WHERE s.task_id = t.id ORDER BY s.last_event_at DESC LIMIT 1) AS host_kind,
              (SELECT e.summary FROM session s JOIN event e ON e.session_id = s.id
                WHERE s.task_id = t.id AND e.summary IS NOT NULL
                ORDER BY e.ts DESC LIMIT 1) AS last_summary,
              (SELECT e.type FROM session s JOIN event e ON e.session_id = s.id
                WHERE s.task_id = t.id ORDER BY e.ts DESC LIMIT 1) AS last_event
         FROM task t
        ORDER BY t.updated_at DESC`,
    )
    .all();
  return { tasks, generated_at: Date.now() };
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // ---- the one mandatory endpoint (§10.3) --------------------------------
    if (path === "/ingest" && req.method === "POST") {
      let payload: HookPayload;
      try {
        payload = (await req.json()) as HookPayload;
      } catch {
        return json({ error: "invalid JSON" }, 400);
      }

      // An unprovisioned host sends `Bearer ` — file it, never drop it (§10.2).
      const host = hostByToken(bearer(req)) ?? unidentifiedHost();
      const result = ingest(host, payload);

      if (result) broadcast({ kind: "event", ...result, type: payload.hook_event_name });

      // Phase 1 is observe-only: always answer with an empty decision so the
      // agent is never blocked or altered by the board.
      return json({});
    }

    if (path === "/api/board" && req.method === "GET") return json(board());

    if (path.startsWith("/api/tasks/") && req.method === "GET") {
      const id = Number(path.split("/")[3]);
      const task = db.query("SELECT * FROM task WHERE id = ?").get(id);
      if (!task) return json({ error: "not found" }, 404);
      const sessions = db
        .query(
          `SELECT s.*, h.name AS host, h.kind AS host_kind
             FROM session s JOIN host h ON h.id = s.host_id
            WHERE s.task_id = ? ORDER BY s.started_at`,
        )
        .all(id);
      return json({ task, sessions });
    }

    if (path.startsWith("/api/sessions/") && path.endsWith("/events") && req.method === "GET") {
      const sessionId = decodeURIComponent(path.split("/")[3]!);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 1000);
      const events = db
        .query(
          `SELECT id, type, tool_name, agent_type, summary, ts
             FROM event WHERE session_id = ? ORDER BY ts DESC LIMIT ?`,
        )
        .all(sessionId, limit);
      return json({ session_id: sessionId, events });
    }

    if (path === "/stream") {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const send = (data: string) => controller.enqueue(encoder.encode(data));
          send(": connected\n\n");
          subscribers.add(send);
          const keepalive = setInterval(() => {
            try {
              send(": ping\n\n");
            } catch {
              clearInterval(keepalive);
            }
          }, 25_000);
          req.signal.addEventListener("abort", () => {
            clearInterval(keepalive);
            subscribers.delete(send);
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          });
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    if (path === "/healthz") return json({ ok: true });

    if (path === "/" || path === "/board") {
      return new Response(boardPage(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`agent-board listening on :${server.port}`);
