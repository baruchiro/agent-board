# agent-board

A kanban board for AI coding agents that **report in**, wherever they run —
local CLI, desktop app, remote control, or cloud.

Every other agent board owns the agents it shows: a card exists because the
board launched a process in a worktree it created. That model can't represent a
[claude.ai](https://claude.ai/code) cloud session, which no self-hosted server
can own — only hear from. agent-board inverts it. Sessions report their
lifecycle over an HTTP hook, and the board assembles cards from what arrives.
Nothing is launched to be seen.

Self-hosted, single container, SQLite. No build step, no framework.

> **Status: early.** Ingest, the task/session model and the live board work and
> are tested. Spawning agents and answering permission prompts from the board
> are designed but not built — see the roadmap below.

## How it works

```
   local CLI ─┐
   desktop  ──┤  http hooks          ┌──────────────────────────┐
   remote ctl ┤   (Authorization:    │  POST /ingest            │
   cloud/web ─┘    Bearer <token>) ─▶│  task + session + events │
                                     │  GET /stream  (SSE)      │
                                     │  the board               │
                                     └──────────────────────────┘
```

A **card is a task**; sessions attach to it, so a card survives `SessionEnd`,
resume and retry. A session the board has never seen creates its own card —
that is what makes unsolicited reports work.

Columns follow hook events, not drag-and-drop:

| Column | Entered on |
|---|---|
| Backlog | created by API with no session yet *(not built)* |
| In progress | `SessionStart`, `UserPromptSubmit`, `PreCompact`, `SubagentStart` |
| Waiting on me | `PermissionRequest`, permission-shaped `Notification` |
| Idle | `Stop` — unless `stop_hook_active`, which is a stop-hook loop, not idleness |
| Done | `SessionEnd` |

## Quick start

```sh
bun install
bun run src/cli.ts add laptop local    # prints this host's token, once
bun run dev                            # http://localhost:4100
```

Or run the published image:

```sh
docker run -d -p 4100:4100 -v agent-board-data:/data ghcr.io/baruchiro/agent-board:latest
```

`docker compose up -d --build` builds it from source instead. Every push to
`main` publishes `:latest` and `:sha-<commit>` for `linux/amd64` and
`linux/arm64`; tags `vX.Y.Z` publish the matching semver tags.

### Make a host report

1. Provision it: `bun run src/cli.ts add <name> <local|desktop|remote|cloud>`.
2. Put the printed token in that host's environment as `AGENT_BOARD_TOKEN`
   (for a cloud environment, in its environment-variable settings).
3. Copy [`hooks.example.json`](hooks.example.json) into the repo's
   `.claude/settings.json` — repo-local, so it travels to cloud sessions via
   the clone — or `~/.claude/settings.json` for every project.

The hook config is **identical on every host**. Only the environment variable
differs, so nothing secret is committed:

```json
{ "type": "http",
  "url": "https://agents.example.com/ingest",
  "headers": { "Authorization": "Bearer $AGENT_BOARD_TOKEN" },
  "allowedEnvVars": ["AGENT_BOARD_TOKEN"] }
```

A host that was never provisioned sends `Bearer ` — an unset variable
interpolates to an empty string rather than failing — and its reports are filed
under `unidentified` instead of dropped. A machine that quietly stopped
reporting properly stays visible.

Cloud sessions additionally need the ingest host in their environment's
**Custom** network allowlist. That is per-environment, with no org-wide list.

### Putting it behind Cloudflare Access

The board is a window onto everything your agents are doing, so a public
hostname needs a gate — but agents have no human to complete a browser login.
Cloudflare Access splits that cleanly, with two applications on one hostname
(the more specific path wins):

| Access application | Policy | Who gets in |
|---|---|---|
| `agents.example.com/ingest` | **Service Auth** | agents, via a service token |
| `agents.example.com` | Allow, your identity | you |

A [service token](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
is a static `CF-Access-Client-Id` / `CF-Access-Client-Secret` pair. Access
validates it instead of redirecting to an identity provider — which is exactly
the no-human-in-the-middle case. `hooks.example.json` already sends both
headers; put the pair in each reporting host's environment next to
`AGENT_BOARD_TOKEN` and they interpolate the same way.

The two credentials do different jobs and neither replaces the other: the
service token proves *some* machine of yours is calling, and `AGENT_BOARD_TOKEN`
says *which* machine it is.

The policy action must be **Service Auth** — any other action makes Access
prompt for a login the agent cannot complete.

## HTTP surface

| Route | |
|---|---|
| `POST /ingest` | the one mandatory endpoint. `Authorization: Bearer <token>`, body = the raw hook JSON |
| `GET /api/board` | all cards with column, host and latest activity |
| `GET /api/tasks/:id` | one card and its sessions |
| `GET /api/sessions/:id/events` | event history (`?limit=`, default 200) |
| `GET /stream` | SSE; a frame per ingested event |
| `GET /` | the board |
| `GET /healthz` | |

`/ingest` always answers `{}`. Until approvals land, the board cannot block or
alter a running session.

## Privacy

Hook payloads carry full prompt text and literal shell command lines.

- Structured fields and a short summary are always stored; prompts and commands
  are truncated to `REDACT_KEEP` (200) characters plus a hash of the full value,
  so long values stay comparable without being retained.
- Raw payloads are stored **only** for hosts created with `--retain-raw`.
- `transcript_path` is recorded as a reference; the transcript is never fetched.
- Summaries are computed locally — no LLM call on the path an agent waits on.

## Roadmap

| | |
|---|---|
| ✅ | ingest, task/session model, live board |
| | per-host token rotation, retention sweep |
| | create a card by API — GitHub issue → card |
| | start a cloud session from a card |
| | answer a permission prompt from the board |

Approvals will ride the **response** to a report, never a callback: the agent is
already waiting on it synchronously, and cloud sandboxes and NAT'd laptops
accept no inbound connections.

## Design

[`docs/design.md`](docs/design.md) is the full record: why no existing tool fits
(a survey of ~200 orchestrators), the feasibility tests that had to pass first,
a teardown of the closest prior art
([disler's observability server](https://github.com/disler/claude-code-hooks-multi-agent-observability)),
and the v1 design.

## Contributing

`STORIES.md` is the source of truth for behavior and is approval-gated; every
story needs a test tagged `// @story: <ID>`, enforced by
`node scripts/check-stories.mjs`. Run `bun run check` before pushing. See
[`CLAUDE.md`](CLAUDE.md).

## License

MIT
