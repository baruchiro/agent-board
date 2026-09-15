import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// db.ts opens its SQLite file at import time, so the path has to be set before
// anything imports it. Hence the dynamic imports below.
const PORT = 4000 + Math.floor(Math.random() * 1000);
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "agent-board-")), "test.sqlite");
process.env.PORT = String(PORT);

type Mod = {
  db: typeof import("../src/db");
  ingest: typeof import("../src/ingest");
};
let m: Mod;
const base = `http://127.0.0.1:${PORT}`;

let laptop: { host: import("../src/db").Host; token: string };
let archivist: { host: import("../src/db").Host; token: string };

beforeAll(async () => {
  m = {
    db: await import("../src/db"),
    ingest: await import("../src/ingest"),
  };
  await import("../src/index");
  laptop = m.db.createHost("laptop", "local");
  archivist = m.db.createHost("archivist", "cloud", true); // retain_raw
});

/** Post a hook payload the way Claude Code would. */
async function report(token: string | null, payload: Record<string, unknown>) {
  return fetch(`${base}/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(payload),
  });
}

async function boardCards() {
  const res = await fetch(`${base}/api/board`);
  return (await res.json()).tasks as Array<Record<string, any>>;
}

const cardFor = async (title: string) =>
  (await boardCards()).find((t) => t.title === title);

describe("reporting in", () => {
  // @story: INGEST-1, INGEST-2, HOST-1

  test("a session the board never launched creates its own card, attributed to its host", async () => {
    await report(laptop.token, {
      hook_event_name: "SessionStart",
      session_id: "s-newcomer",
      cwd: "/home/me/code/widgets",
      model: "claude-opus-5",
    });

    const card = await cardFor("widgets");
    expect(card).toBeDefined();
    expect(card!.host).toBe("laptop");
    expect(card!.host_kind).toBe("local");
    expect(card!.board_column).toBe("in_progress");
  });

  test("the first real prompt replaces the directory name as the card title", async () => {
    await report(laptop.token, {
      hook_event_name: "UserPromptSubmit",
      session_id: "s-newcomer",
      cwd: "/home/me/code/widgets",
      prompt: "make the widget spin",
    });

    expect(await cardFor("widgets")).toBeUndefined();
    expect(await cardFor("make the widget spin")).toBeDefined();
  });
});

describe("never blocking the agent", () => {
  // @story: INGEST-3

  test("ingest answers an empty decision, carrying nothing that could steer a session", async () => {
    const res = await report(laptop.token, {
      hook_event_name: "PreToolUse",
      session_id: "s-newcomer",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  test("a payload with no session_id is accepted rather than erroring at the agent", async () => {
    const res = await report(laptop.token, { hook_event_name: "Stop" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });
});

describe("columns follow events", () => {
  // @story: BOARD-1, BOARD-2, BOARD-3

  test("a permission prompt moves the card to Waiting", async () => {
    await report(laptop.token, {
      hook_event_name: "Notification",
      session_id: "s-newcomer",
      notification_type: "permission_prompt",
      message: "Claude needs permission to run git push",
    });

    expect((await cardFor("make the widget spin"))!.board_column).toBe("waiting");
  });

  test("a Stop from a stop-hook loop leaves the column alone", async () => {
    await report(laptop.token, {
      hook_event_name: "Stop",
      session_id: "s-newcomer",
      stop_hook_active: true,
    });

    expect((await cardFor("make the widget spin"))!.board_column).toBe("waiting");
  });

  test("an ordinary Stop moves the card to Idle", async () => {
    await report(laptop.token, { hook_event_name: "Stop", session_id: "s-newcomer" });
    expect((await cardFor("make the widget spin"))!.board_column).toBe("idle");
  });

  test("the card survives SessionEnd and keeps its session attached", async () => {
    await report(laptop.token, {
      hook_event_name: "SessionEnd",
      session_id: "s-newcomer",
      reason: "clear",
    });

    const card = (await cardFor("make the widget spin"))!;
    expect(card.board_column).toBe("done");

    const detail = await (await fetch(`${base}/api/tasks/${card.id}`)).json();
    expect(detail.sessions).toHaveLength(1);
    expect(detail.sessions[0].id).toBe("s-newcomer");
    expect(detail.sessions[0].end_reason).toBe("clear");
  });

});

describe("live updates", () => {
  // @story: BOARD-4

  test("an ingested event is pushed to an open stream", async () => {
    const res = await fetch(`${base}/stream`);
    const reader = res.body!.getReader();
    await reader.read(); // the ": connected" preamble

    await report(laptop.token, {
      hook_event_name: "UserPromptSubmit",
      session_id: "s-stream",
      cwd: "/home/me/code/streamy",
      prompt: "hello",
    });

    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toStartWith("data: ");
    const event = JSON.parse(frame.slice("data: ".length));
    expect(event.session_id).toBe("s-stream");
    expect(event.type).toBe("UserPromptSubmit");
    await reader.cancel();
  });
});

describe("host identity", () => {
  // @story: HOST-2

  test("an empty bearer — what an unset env var produces — is filed, not dropped", async () => {
    await report("", {
      hook_event_name: "SessionStart",
      session_id: "s-ghost",
      cwd: "/somewhere/unprovisioned",
    });

    const card = await cardFor("unprovisioned");
    expect(card).toBeDefined();
    expect(card!.host).toBe("unidentified");
    expect(card!.host_kind).toBe("unknown");
  });

  test("a report with no Authorization header at all is also filed", async () => {
    await report(null, {
      hook_event_name: "SessionStart",
      session_id: "s-headerless",
      cwd: "/somewhere/headerless",
    });

    expect((await cardFor("headerless"))!.host).toBe("unidentified");
  });

  test("an unrecognised token does not silently masquerade as a known host", async () => {
    await report("not-a-real-token", {
      hook_event_name: "SessionStart",
      session_id: "s-bogus",
      cwd: "/somewhere/bogus",
    });

    expect((await cardFor("bogus"))!.host).toBe("unidentified");
  });
});

describe("privacy", () => {
  // @story: PRIVACY-1, PRIVACY-2

  const longCommand = `rm -rf ${"nested/".repeat(120)}thing`;

  test("a long shell command is truncated to a bounded prefix plus a hash", async () => {
    await report(laptop.token, {
      hook_event_name: "PreToolUse",
      session_id: "s-newcomer",
      tool_name: "Bash",
      tool_input: { command: longCommand },
    });

    const summary = m.db.db
      .query("SELECT summary FROM event WHERE session_id = ? ORDER BY id DESC LIMIT 1")
      .get("s-newcomer") as { summary: string };

    expect(summary.summary.length).toBeLessThan(longCommand.length);
    expect(summary.summary).toContain("[+");
    expect(summary.summary).toContain("sha256:");
    expect(summary.summary).not.toContain(longCommand);
  });

  test("a short command is kept verbatim — truncation is not mangling", async () => {
    await report(laptop.token, {
      hook_event_name: "PreToolUse",
      session_id: "s-newcomer",
      tool_name: "Bash",
      tool_input: { command: "git status" },
    });

    const row = m.db.db
      .query("SELECT summary FROM event WHERE session_id = ? ORDER BY id DESC LIMIT 1")
      .get("s-newcomer") as { summary: string };

    expect(row.summary).toBe("Bash: git status");
  });

  test("the raw payload is discarded for an ordinary host", async () => {
    const row = m.db.db
      .query("SELECT payload_json FROM event WHERE session_id = ? ORDER BY id DESC LIMIT 1")
      .get("s-newcomer") as { payload_json: string | null };

    expect(row.payload_json).toBeNull();
  });

  test("the raw payload is kept only for a host created with retain-raw", async () => {
    await report(archivist.token, {
      hook_event_name: "PreToolUse",
      session_id: "s-archived",
      cwd: "/home/me/code/archive",
      tool_name: "Bash",
      tool_input: { command: "git status" },
    });

    const row = m.db.db
      .query("SELECT payload_json FROM event WHERE session_id = ? ORDER BY id DESC LIMIT 1")
      .get("s-archived") as { payload_json: string | null };

    expect(row.payload_json).not.toBeNull();
    expect(JSON.parse(row.payload_json!).tool_input.command).toBe("git status");
  });
});

describe("edge authentication", () => {
  // @story: AUTH-2

  test("the shipped hook config carries static credentials for a non-human client", async () => {
    const config = await Bun.file("hooks.example.json").json();
    const hooks = Object.values(config.hooks).flatMap((entries: any) =>
      entries.flatMap((entry: any) => entry.hooks),
    );

    expect(hooks.length).toBeGreaterThan(0);
    for (const hook of hooks as Array<Record<string, any>>) {
      // Cloudflare Access service-token pair — authenticates with no browser
      // login, so a hook keeps working where nobody can complete an IdP flow.
      expect(hook.headers["CF-Access-Client-Id"]).toBe("$CF_ACCESS_CLIENT_ID");
      expect(hook.headers["CF-Access-Client-Secret"]).toBe("$CF_ACCESS_CLIENT_SECRET");

      // Interpolation only happens for variables named here.
      expect(hook.allowedEnvVars).toContain("CF_ACCESS_CLIENT_ID");
      expect(hook.allowedEnvVars).toContain("CF_ACCESS_CLIENT_SECRET");
      expect(hook.allowedEnvVars).toContain("AGENT_BOARD_TOKEN");
    }
  });
});
