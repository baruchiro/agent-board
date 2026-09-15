# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

Process comes from [`baruchiro/vibe-coding-template`](https://github.com/baruchiro/vibe-coding-template).
The design this project implements is [`docs/design.md`](docs/design.md).

---

## How we work (portable defaults)

These are the process rules that make a project safe to hand to an AI agent
end-to-end. They don't depend on the stack — keep them as-is unless you have a
concrete reason to change them.

### Stories workflow (most important — read first)

`STORIES.md` at the repo root is the **source of truth for product behavior**.
It is **approval-gated**: every add, edit, or delete of a story requires
explicit approval from the repository owner *before* the file is touched.
Propose the exact text in chat, wait for "approved", then write.

Coverage is enforced automatically:

- Each test that exercises a story declares it via a comment header near the
  top of the test file:
  ```ts
  // @story: CORE-1, CORE-2
  ```
- `scripts/check-stories.mjs` parses `STORIES.md` for story IDs, scans your test
  files for `@story:` annotations, and fails if:
  - any story has zero covering tests, or
  - a test references a story ID that no longer exists in `STORIES.md`.
- Wire the script into your pre-push gate and CI (see
  [After any code change](#after-any-code-change) and `.github/workflows/ci.yml`).

The check verifies that *a test exists tagged with the story's ID*, not that the
test actually proves the story. Honest tagging is on us — writing tests
test-first keeps it honest.

When implementing or changing a story: write the test(s) first, tag them, then
write the code. When deleting a story: remove or retag its tests in the **same**
commit.

**Story IDs** are `PREFIX-N` (e.g. `CORE-1`, `AUTH-3`). Group by feature area;
the prefix is yours to choose.

**Unimplemented stories.** A story can be recorded ahead of its implementation
(e.g. a roadmap commitment) without a vacuous placeholder test by adding an
`<!-- @unimplemented -->` marker line inside its section in `STORIES.md`. The
coverage gate then exempts that story (and reports it as exempt) instead of
failing. This is the *only* sanctioned way to land a story with no covering
tests — remove the marker in the same change that adds the real tagged tests.
The marker is an HTML comment, so it doesn't render in the published file.

### After any code change

Run your project's full local gate — **typecheck + lint + story-coverage +
tests** — and fix everything before declaring the change done. No "looks done
but doesn't compile" / "looks done but tests fail" / "looks done but a story is
uncovered" claims.

The `/ship` command (`.claude/commands/ship.md`) runs this sequence. Adjust the
concrete commands in that file to match your stack; keep the story-coverage step
(`node scripts/check-stories.mjs`) in the sequence.

### Verifying your change

Passing the gate is necessary, not sufficient. Before claiming a task done,
actually exercise the behavior:

- **UI changes** (pages, components, styling, routing, client state): drive the
  change in a real browser — the `playwright-cli` skill (preferred; cheaper in
  context than the Playwright MCP), **mobile-first** at `375×667`. Snapshot the accessibility tree, exercise the golden path plus 1–2
  adjacent flows that could have regressed, and watch the console/network for
  silent failures. If the UI is broken at 375px, the design is broken.
- **Backend-only changes** (APIs, schema, library code with no rendered
  surface): the typecheck + unit tests are the verification. Say so and skip the
  browser rather than theater-testing a landing page.

Honest caveats — state these explicitly rather than faking success: auth-gated
routes may need a real sign-in you can't complete headless; a change you can't
reach without seeded data or tokens can't be claimed as "tested" if you only
loaded the landing page.

### Opening a PR

Use the `/open-pr` skill (`.claude/skills/open-pr/SKILL.md`). It runs the local
gate, pushes the branch, and opens the PR. **Do not create a PR unless asked**
(or unless working a GitHub issue — see below, where every issue gets a PR).

For UI changes, include a screenshot of the change in the PR body. For
backend-only changes, note "no UI surface changed" instead.

### GitHub issue workflow

When picking up a GitHub issue, do these **before writing any code**:

1. **Assign** the issue to the repo owner via `mcp__github__issue_write`
   (`method: update`, `assignees: ["<owner>"]`).
2. **Comment** on the issue with the current session link:
   > Picking this up. Session: https://claude.ai/code/session_<id>
3. **Branch name** — create a branch named `{issue-number}-{short-slug}`
   (e.g. `18-mobile-row`). GitHub links branches whose name starts with the
   issue number to that issue's development section. Use
   `mcp__github__create_branch`, then `git fetch` + `git checkout`.
4. **Open a PR** after the first push via `/open-pr`. The PR body must end with a
   closing keyword on its own line so the issue auto-closes on merge:
   ```
   Closes #{issue-number}
   ```
   Also include the session link. Every issue gets a PR — features, bugs,
   polish, infra alike.

### Working style

- **Plan first** before any non-trivial change. Course-correct in English, not
  in diffs.
- **Vertical slices**: a feature means "this behavior visible end-to-end", not
  "all the plumbing first, then the UI."
- **@-mention paths** when referencing files (e.g. `@src/index.ts`) — don't make
  the reader guess.
- **Subagents** (e.g. `general-purpose` for research, `Explore` for read-only
  code search) keep the main context clean on big jobs.
- **Superpowers skills** are vendored in `.claude/skills/` — invoke them by name
  (`test-driven-development`, `systematic-debugging`,
  `verification-before-completion`, `requesting-code-review`, …) instead of
  reinventing the process. `README.md` lists the full set.

---

## Project-specific

### Project purpose

`agent-board` is a **report-ingesting** control plane for AI coding agents. It
shows every Claude Code session as a card on a kanban board — local CLI,
desktop app, remote control, or cloud — because each session *reports in* over
an HTTP hook.

It deliberately does **not** launch or own agents. Every comparable tool
(vibe-kanban, Kanban Code, Conductor, Fusion, kandev, …) is authoritative over
the agent lifecycle: a card exists because the board started a process in a
worktree it created. That model cannot represent a claude.ai cloud session,
which no self-hosted server can own — only hear from. Ingesting reports is the
one thing nothing else does, and it is the reason this project exists.
See [`docs/design.md`](docs/design.md) §2 for the full survey and §9 for the
teardown of the closest prior art.

Self-hosted is a hard requirement, not a preference.

### Stack (locked)

| Layer | Choice |
|---|---|
| Runtime | Bun 1.x (`bun:sqlite`, `Bun.serve`) |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` |
| Data | SQLite, single file on a volume |
| UI | One server-rendered page + SSE. **No build step, no framework.** |
| Tests | `bun test` |
| Container | `oven/bun:1-alpine`, one service |

Versions are pinned — do not introduce parallel libraries. Specifically: no
frontend framework, no bundler, no ORM, and no second HTTP or date library.
The whole point is that this stays small enough to read in one sitting.

**No LLM calls on the ingest path.** Event summaries are computed locally.
The path an agent blocks on must never cost money or latency.

### File layout

```
src/
  index.ts     HTTP surface: /ingest, /api/*, /stream, the board page
  ingest.ts    hook payload -> task/session/event, column transitions, redaction
  db.ts        schema, host identity, token hashing
  board.ts     the board page (HTML/CSS/JS as one string)
  cli.ts       host provisioning: `bun run src/cli.ts add <name> <kind>`
docs/design.md the design doc: research, decision, v1 design
tests/         bun tests, each tagged `// @story: <ID>`
```

### Commands

| Purpose | Command |
|---|---|
| Dev server | `bun run dev` |
| Typecheck | `bun run typecheck` |
| Tests | `bun test` |
| Story coverage | `node scripts/check-stories.mjs` |
| Full gate | `bun run check` |
| Provision a host | `bun run src/cli.ts add <name> <local\|desktop\|remote\|cloud>` |
| Container | `docker compose up -d --build` |

There is no lint or build step: no bundler, and `tsc --noEmit` plus `bun test`
are the gate. Do not add one without a concrete reason.

### Environment variables

Defined in `.env.example` (committed); `.env` is gitignored.

| Variable | Meaning |
|---|---|
| `PORT` | listen port (default 4100) |
| `DB_PATH` | SQLite file (default `./agent-board.sqlite`) |
| `REDACT_KEEP` | characters of prompt/command text kept before truncation (default 200) |

`AGENT_BOARD_TOKEN` is **not** read by this server — it lives in the
environment of each *reporting host* and arrives as a bearer token.

### First-time setup (fresh checkout)

```sh
bun install
bun run src/cli.ts add laptop local   # prints that host's token, once
bun run dev                           # http://localhost:4100
```

### Things that look like bugs but are not

- **`Stop` with `stop_hook_active` does not move a card to Idle.** That is a
  stop-hook loop, not a session going idle.
- **`unidentified` is a real host row.** An unset `AGENT_BOARD_TOKEN`
  interpolates to an empty string rather than erroring, so unprovisioned hosts
  report as `Bearer `. Filing them makes a silently-misconfigured machine
  visible; dropping them would not.
- **`/ingest` always answers `{}`.** Until the approvals milestone, the board
  must never be able to block or alter a session.
- **Approvals must ride the hook *response*, never a callback.** The agent is
  already waiting on it synchronously. A reverse channel to the agent's machine
  cannot work: cloud sandboxes and NAT'd laptops accept no inbound connections.
