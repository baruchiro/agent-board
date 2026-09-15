# agent-board — design

*Research, decision and v1 design for a control plane that shows agents
across every environment they run in.*

Research + design notes for a system that shows every AI agent session I run
— wherever it runs — as a card on a kanban board, and can start new agents by
API (e.g. from a newly opened GitHub issue).

**Research pass §§1–7; decision and design §§8–10.** The build decision was
made on 2026-09-15 (§8): build thin and report-first, seeded by the
observability server teardown in §9. Design for v1 is §10. Questions that
remain open are listed at the end.

## Related

This document began as a research spec in a private home-server repo and moved
here when the project became its own thing. References to "the home server"
are the author's self-hosted deployment — the first target, not a requirement.

A companion note there (not public) records verified facts about how
remote-control sessions authenticate and where the always-on session lives.

---

## 1. The problem, as stated

Managing multiple AI agents on a kanban board. Even restricting to Claude Code
as the only agent, it runs in **many environments**:

| Environment | Where the process runs | Who owns it |
|---|---|---|
| Local CLI | my terminal, my machines | me |
| Desktop app | Claude Code desktop | me |
| Remote control | `claude-remote-control.service` on the home server | systemd |
| Cloud / web | Anthropic's infra, driven from claude.ai/code | Anthropic |

Because no single process owns all of them, the design instinct is:

> a general server that listens for **reports over HTTP** from any agent that
> wants to report, and every agent is *required* to report — via hook, for
> example.

Plus two stated constraints:

- **Phase 1 is one-way.** The server observes; it does not steer agents.
- **But** the server must be able to **create agents by API** early — e.g. an
  issue is opened in one of my open-source repos → an agent is prepared and
  run, automatically or on my click.

The user correctly noted these two pull against each other. See
[§5 One-way vs. interactive](#5-one-way-vs-interactive-the-tension-mostly-dissolves)
— the tension mostly dissolves once you look at how hooks actually work.

### Requirements, restated and numbered

Derived from the brief; the ones marked ⚠️ are **inferred, not stated** and
need confirmation. R9 was added explicitly after the first research pass and
is a hard filter — see [§2.4](#24-the-self-hosted-shortlist).

| # | Requirement | Phase |
|---|---|---|
| R1 | Agents report state to a central server over HTTP | 1 |
| R2 | Reporting is mandatory and automatic (hook-based, not opt-in per session) | 1 |
| R3 | Works for agents in **all four** environments above | 1 |
| R4 | Board view: each agent session ≈ a card, columns reflect real state | 1 |
| R5 | Create + start an agent via the server's API | 1 |
| R6 | Trigger source: GitHub issue opened → card created (auto or on click) | 1 |
| R7 | Server does not otherwise steer running agents | 1 (relaxed later) |
| R8 | ⚠️ Agent-agnostic in principle (Claude Code first, others later) | 2 |
| R9 | **Self-hosted** — runs on my own infrastructure (home server), reachable from the internet so cloud sessions can report in | 1 |
| R10 | ⚠️ Single user (me), not multi-tenant | 1 |
| R11 | ⚠️ Survives restarts; history is queryable after the fact | 1 |

---

## 2. Landscape — what already exists

The short version: **this space is extraordinarily crowded** (~200 projects
catalogued in [awesome-agent-orchestrators]), **and almost none of them have
the shape described above.**

### 2.1 The dominant shape: harness-owning boards

The overwhelming majority — vibe-kanban, Kanban Code, KanBots, Conductor,
Crystal/Nimbalyst, Claude Squad, OpenKanban, Emdash, dozens more — share one
architecture:

```
  board app  ──spawns──>  agent CLI in a git worktree (+ tmux/PTY)
      ▲                        │
      └──────reads state───────┘   (it owns the process, so it just knows)
```

They are **desktop apps or local daemons that launch and own the agent
process.** A card exists because the app started it. Consequences:

- They cannot see a session they didn't start — including every cloud session.
- They are per-machine. Two laptops = two disconnected boards.
- They are built around git worktrees, i.e. coding work in one repo at a time.

That is a real and useful product — it is just **not the problem stated
here.** My agents already run in four places, and the cloud ones can never be
"owned" by a local app.

### 2.2 Candidate deep dives

This first pass predates the self-hosted requirement, so it includes desktop
apps. They are kept because their *column semantics* and *schemas* are worth
copying even though R9 rules them out as the thing to run —
see [§2.3](#23-what-the-self-hosted-requirement-eliminates).

| Project | License | Shape | Ingests foreign agents? | Spawn API? | Verdict |
|---|---|---|---|---|---|
| [vibe-kanban] (BloopAI) | Apache-2.0 | Rust+React local server, worktree-per-task, MCP server in/out | No | MCP tools (create task, move card) | **Sunsetting**, community-maintained. Best board UX + closest to an API, wrong ownership model |
| [kanban-code] (langwatch) | Apache-2.0 | Native macOS/Windows app; cards auto-move from **Claude Code hooks** (Stop, UserPromptSubmit, SessionStart/End) | No — discovers only local `~/.claude/projects/` | CLI with JSON output, no HTTP | Best *column semantics* to copy. macOS 26 only |
| [Omnara] | Apache-2.0 | **Self-hostable server** (Go API + Postgres + React), agents defined as YAML profiles, agents can run on "sandboxes, your own machines, or both" | Partial — agent-side integration required, but multi-machine by design | **Yes**, REST `/api/v1` + TS SDK + CLI | ⭐ **Closest existing fit.** Worth a real evaluation |
| [Omnigent] (Databricks) | Apache-2.0 | Meta-harness: **server (state/policy/skills) split from runner (laptop/cloud sandbox)**; sessions portable across desktop/terminal/phone | Only its own runners | Yes | ⭐ Closest *architecture*; heavy, enterprise-oriented, wants to be the harness |
| [AgentAPI] (coder) | MIT | Wraps one agent in an in-memory terminal emulator, exposes `GET /messages`, `POST /message`, `GET /status`, `GET /events` (SSE) | No — it *is* the wrapper | Per-agent HTTP | Useful **building block** for the later interactive phase; one process per agent |
| [claude-code-hooks-multi-agent-observability] (disler) | MIT-ish | **Exactly the ingest half**: 12+ hook types → `POST /events` → Bun+SQLite → Vue timeline, WebSocket live | ✅ Yes — any agent configured to post | ❌ None; observability only | ⭐ Best **ingest reference**. No board, no spawn, no control |

Also noted, not yet evaluated: `codecast` (watches local sessions → triage
inbox), `Comet` (cross-device control plane, daemon + sync), `ai-maestro`
(dashboard spanning multiple machines), `herdr` (background runtime owning
agent terminals, socket API), `Ouijit` (kanban + terminals wired by lifecycle
hooks), `Open Session` (self-hosted server, Slack/Linear intake), `paperclip`
(self-hosted, agents claim tickets, budgets + approval gates), `cyrus` /
`Contrabass` / `sortie` (issue-tracker → agent session runners, i.e. R5/R6
in isolation).

### 2.3 What the self-hosted requirement eliminates

R9 is a **hard filter**, and it removes most of the field in one stroke: every
desktop-app board is out, because a Mac app is not a server — it cannot be
reached by a cloud session, cannot run headless on the home server, and dies
with the laptop lid.

Disqualified on R9 alone, despite otherwise being the best-built tools in the
category: **Kanban Code** (native macOS/Windows), **vibe-kanban** (local app,
also sunsetting), **Conductor** (see below), **nimbalyst/Crystal** (desktop),
**KanBots** (desktop), **Ouijit** (Electron; AGPL-3.0, local SQLite, and its
docs confirm the board tracks *only* sessions it launched), **dorothy**,
**Ghostex**, **octomux** (local dashboard), plus the whole TUI tier
(**openkanban**, **claude-squad**, **amux**, **dmux**).

#### Conductor (conductor.build) — checked separately

Worth its own note, because the one-line dismissal above undersells it and the
name collides with an unrelated project.

Conductor is **not** just a worktree app on a Mac any more. It now runs "a team
of coding agents in the cloud", drivable from a desktop app, mobile, or **its
own API**, supporting Claude Code, Codex, Cursor and OpenCode. On feature
surface it is one of the closest *product* analogues to what is wanted here.

It still fails R9, on two independent counts:

1. **The control plane is a macOS desktop app** — no Windows or Linux yet, so
   it cannot run headless on the home server.
2. **Its cloud workspaces run in Vercel sandboxes that Conductor provisions**,
   not on infrastructure I own. "In the cloud" here means *their* cloud.

And on R1/R3 it is the same ownership model as everything else: it ships
bundled installs of Claude Code and Codex "to ensure compatibility", i.e. it
launches and owns the agent. Nothing indicates it can display a session started
outside it.

It is also **proprietary** — free for now, with stated plans to charge for
collaboration features. Note the name collision that makes searching for this
misleading: **Conductor OSS** (Apache-2.0, self-hostable, `conductor-oss/conductor`)
is a *completely different product* — a durable workflow/agent orchestration
engine, unrelated to the coding-agent app at conductor.build. Do not read the
OSS project's license or self-hosting story as applying to conductor.build.

⚠️ **Confidence: medium.** Both `conductor.build` and `docs.conductor.build` are
blocked by this session's egress allowlist (§4.5 — the finding demonstrating
itself), so the above comes from search results rather than primary sources.
Verify from a normal browser before relying on it.

Note the distinction that matters: *"runs locally"* ≠ *"self-hosted"*. Several
tools run a local web server but are single-machine apps in practice. The test
applied below is: **can it run as a headless service on the home server,
survive reboots, and be reached over the network by agents and by me?**

### 2.4 The self-hosted shortlist

Ranked by fit against R1–R11. All are open source and genuinely deployable as
a service.

| Project | License | Stack / deploy | Board | Spawn API | Multi-machine | Ingests foreign agents? |
|---|---|---|---|---|---|---|
| ⭐ [Fusion] | MIT | Node + Postgres, Express + SSE dashboard | ✅ kanban | ✅ REST (`/api/tasks`, `/api/automations`, `/api/routines`) | ✅ **mesh — "laptop, Mac mini, Linux server, cloud VM, phone; every node is a peer"**, state synced | ❌ own nodes only |
| ⭐ [paperclip] | MIT | Node + Postgres + React | ✅ issues/tickets + inbox | ✅ | ✅ agents "wake on heartbeats" from anywhere | ⚠️ **closest** — agent types include **"HTTP/webhook bots"**; external adapters receive heartbeat invocations |
| ⭐ [Omnara] | Apache-2.0 | Go API + Postgres + React, Docker Compose | list/feed | ✅ REST `/api/v1` + TS SDK | ✅ "sandboxes, your own machines, or both" | ⚠️ agent-side integration required |
| [kandev] | AGPL-3.0 | Dockerfile; Tailscale / Cloudflare Tunnel for remote access | ✅ kanban, drag-drop, workflow automation | ⚠️ MCP over streamable HTTP/SSE, not REST | ✅ **four runtimes: local process, Docker, SSH remote, cloud executor** | ❌ |
| [Garcon] | GPL-3.0 | `docker compose up` | ✅ "chat board" — columns from filters | ⚠️ CLI against the running server | ✅ browser + mobile | ❌ |
| [OpenHands] | MIT | Docker | ❌ no board | ✅ **"Agent Server, a REST API for running multiple agents"** | ✅ | ❌ |
| [Open Session] | MIT | systemd / LaunchAgent, own box or sandboxes | ❌ | ⚠️ web UI + CLI | ✅ | ❌ |
| [intentic] | MIT | sandbox daemon on your host + **outbound-only Cloudflare tunnel** | ✅ fleet board (Attention / Active / Finished) | ✅ schedule, webhook, event triggers | ✅ | ❌ |
| [observability] | MIT | Bun + SQLite, one container | ❌ timeline only | ❌ | ✅ anything that can POST | ✅ **yes — the only one** |

Three of these are worth real hands-on time:

- **Fusion** is the closest thing to the *deployment* shape wanted. Its mesh
  model is the only one in the whole catalogue that treats "my agents run on
  five different machines, one board" as the core premise rather than an
  afterthought — and it imports GitHub issues into cards
  (`fn task import owner/repo`), which is R6 nearly verbatim. What it does not
  do is accept a session it didn't create; every task gets a Fusion worktree.
- **paperclip** is the only one whose *contract* resembles the design instinct
  here: it defines agents as things that report in — including plain
  **HTTP/webhook bots** — with governance (approval gates, budget hard-stops,
  pause/resume/terminate, audit log) built into the control plane rather than
  bolted on. Its model is **pull** (agents wake on a heartbeat and claim
  tickets) rather than **push** (agent reports unprompted via hook), which is a
  real mismatch, but possibly a bridgeable one.
- **intentic**'s transport is worth stealing regardless of the build decision:
  an **outbound-only Cloudflare tunnel**, no inbound firewall rule. The home
  server already fronts everything with Cloudflare → reverse proxy, so this is
  a known-good pattern here and it sidesteps exposing an ingest endpoint.

### 2.5 Conclusion of the survey

**No existing self-hosted tool does the thing.** The gap is specific and
consistent across all ~200 projects catalogued:

> Every board is **authoritative over the agent's lifecycle**. A card exists
> because the board started a process, in a worktree it created. None of them
> can represent an agent that already exists and merely *reports*.

That is precisely the inversion R1–R3 require, and the reason the four
environments cannot be unified by any of these tools: a claude.ai cloud session
can never be launched or owned by my server, only *heard from*.

The two halves do exist separately, both open source:

- **ingest half** → disler's observability server (proven, tiny, exactly the
  right contract, no board)
- **spawn half** → Fusion / OpenHands / paperclip, and Anthropic's own Routines
  API (§4.3)

So the live options are:

| Option | What it means | Cost |
|---|---|---|
| **A. Build thin, report-first** | Own the ingest + card model; delegate spawning to the Routines API and a small local runner | Most work, exact fit, no fighting someone's ownership model |
| **B. Fork Fusion** | Keep its mesh, board, REST API and GitHub import; add an ingest endpoint and let a card exist without a Fusion-owned worktree | Large MIT codebase to carry; fighting a core assumption |
| **C. Bend paperclip** | Register each Claude Code session as an HTTP/webhook agent; get governance, budgets and approval gates free | Pull-vs-push mismatch; heavier domain model (org charts, companies) than one person needs |
| **D. Board on top of the observability server** | Fork the ingest, add kanban semantics + a spawn endpoint | Effectively option A with a head start on the schema |

**Leaning A/D** (they converge), with **B and C as the two evaluations that
could change the answer.** Recommendation deliberately deferred — see
[Next research steps](#7-next-research-steps).

---

## 3. Why the "passive reporting server" instinct is right

Three independent reasons, beyond the four-environment argument:

1. **Hooks are already a first-class, mandatory-by-config mechanism.** Claude
   Code hooks can be declared in `~/.claude/settings.json` (all projects),
   in a repo's committed `.claude/settings.json` (travels to cloud sessions),
   or in managed policy settings (org-wide, not user-removable). That is
   exactly R2.
2. **Claude Code has a native `http` hook type** — no wrapper script needed:

   ```json
   { "type": "http",
     "url": "https://agents.<my-domain>/hooks/event",
     "timeout": 600,
     "headers": { "Authorization": "Bearer $AGENT_BOARD_TOKEN" },
     "allowedEnvVars": ["AGENT_BOARD_TOKEN"] }
   ```
3. **Push beats poll across trust boundaries.** A cloud session can reach my
   server; my server can never reach into a cloud session's process.

---

## 4. Technical findings per requirement

### 4.1 The hook surface (verified against current docs)

Hook events relevant to a board, grouped by what they'd drive:

| Board concern | Hook events |
|---|---|
| Card lifecycle | `SessionStart` (matchers: `startup` / `resume` / `clear`), `SessionEnd` |
| "Agent is working" | `UserPromptSubmit`, `Stop`, `StopFailure` |
| "Agent is **blocked on me**" | `Notification` (matcher `permission_prompt`), `PermissionRequest`, `Elicitation` |
| Activity detail / audit | `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch` |
| Sub-agent tree | `SubagentStart`, `SubagentStop` |
| Task/plan progress | `TaskCreated`, `TaskCompleted` |
| Health / cost signals | `PreCompact`, `PostCompact`, `PreModelSwitch`, `PostModelSwitch` |
| Idle team members | `TeammateIdle` |

Every hook receives on stdin (or as the HTTP body, for `http` hooks) a common
envelope:

```json
{ "session_id": "…", "prompt_id": "…", "transcript_path": "/…/transcript.jsonl",
  "cwd": "/home/user/home-server", "permission_mode": "default|plan|acceptEdits|auto|dontAsk|bypassPermissions",
  "effort": { "level": "medium" }, "hook_event_name": "PreToolUse",
  "agent_id": "…", "agent_type": "Explore|<custom>" }
```

plus event-specific fields (`tool_name`, `tool_input`, `tool_use_id`, …).

`session_id` is the natural card key. `cwd` + git remote gives the project.
`agent_id` / `agent_type` gives the sub-agent tree for free.

**Gaps to verify:** the envelope carries no stable *machine/environment*
identifier and no human-readable session title. Both probably have to be
injected — machine via `allowedEnvVars`/a per-host token, title derived from
the first `UserPromptSubmit` or the transcript.

### 4.2 Alternative/complementary ingest: native OpenTelemetry

Claude Code has built-in OTel support (`CLAUDE_CODE_ENABLE_TELEMETRY=1`),
exporting **metrics** (sessions, tokens, cost, lines changed, tool approvals),
**events** (each prompt, API request, API error, tool result) and **traces**
(beta; sub-agent spans nest under the parent).

Trade-off: OTel gives cost/token accounting essentially free, and the home
server already runs a monitoring stack (infra stack) — but it is
metrics-shaped, batched (60s default), and has **no request/response channel**,
so it cannot ever carry approvals. **Likely answer: both.** Hooks for card
state and control; OTel for cost/usage panels.

### 4.3 Spawning agents (R5/R6) per environment

| Environment | Can the server start one? | How |
|---|---|---|
| Cloud / web | ✅ | **Routines API** — `POST` to fire a routine, authenticated with a per-routine bearer token minted at `claude.ai/code/routines`; returns session id + URL. Each call creates a new session (no idempotency key); counts against a per-plan daily allowance; 429 + `Retry-After` on limit |
| Home server (remote control / headless) | ✅ | Spawn `claude -p …` / an Agent-SDK process locally, or a container per task |
| Local CLI on my laptop | ⚠️ | Requires an agent-side daemon that polls or holds a connection — the server can't reach in. Probably out of scope for v1 |
| Desktop app | ❌ | No known programmatic launch |

**This session is itself proof of concept:** it is a Claude Code Remote
session with MCP tools `create_session`, `send_message`, `list_sessions`,
`create_trigger` — i.e. a working spawn-and-steer API for cloud sessions
already exists and is reachable from an agent.

**GitHub issue → card (R6):** three viable intakes, in increasing coupling —
(a) GitHub webhook → my server → card in Backlog, spawn on click;
(b) an n8n workflow as the webhook receiver (the home server already does this
    pattern for everything else);
(c) `claude-code-action` / a routine, with the board only observing.
Option (b) is the cheapest to build here and keeps GitHub coupling **outside**
the board core, which matches the stated preference that the board owns its own
DB and GitHub lives outside it as a plugin/integration.

### 4.4 Environment coverage risks

- **Cloud sessions**: hooks come from the repo's committed
  `.claude/settings.json`, so ingest only works for *my* repos and only after
  that file is added. Requires the server to be publicly reachable (Cloudflare
  → reverse proxy, per the existing home-server pattern) with a bearer token.
  **Network feasibility: tested — see §4.5.**
- **Remote control**: it is a local CLI process under the hood → hooks work
  normally. Confirmed by the prior spec's findings.
- **Desktop app**: ⚠️ unverified that it honours the same settings files and
  the `http` hook type.
- **Local CLI**: trivial; `~/.claude/settings.json` covers every project.


### 4.5 Test: can a cloud session reach my server? — **conditionally yes**

Run from inside a Claude Code cloud session on 2026-09-11 (this session).

**Result: blocked by default, allowed by configuration.** Every outbound
request to an arbitrary host was refused at the egress proxy:

```
$ curl -X POST https://n8n.<my-domain>/webhook/... → curl: (56) CONNECT tunnel failed, response 403
$ curl        https://<my-domain>                  → curl: (56) CONNECT tunnel failed, response 403
$ curl -X POST https://postman-echo.com/post         → curl: (56) CONNECT tunnel failed, response 403

[agent-proxy] connect_rejected — the egress proxy denied the CONNECT (organization policy)
```

while `api.github.com` (200), `raw.githubusercontent.com` (301) and the package
registries succeeded. So it is an **allowlist, not a blanket block** — and the
allowlist is a per-environment setting I control.

Claude Code cloud environments take one of four **network access levels**:

| Level | Outbound connections |
|---|---|
| **None** | No outbound access through the session's network |
| **Trusted** (default) | Allowlisted domains only: package registries, GitHub, cloud SDKs |
| **Full** | Any domain |
| **Custom** | My own allowlist, optionally plus the defaults |

This session's environment is on **Trusted**, which is why the probe failed.

**⇒ The remedy is a configuration change, not an architecture change.** Set the
environment to **Custom** and put the ingest host in the **Allowed domains**
field (one domain per line; a leading `*.` matches all subdomains), with *"Also
include default list of common package managers"* checked so GitHub and the
registries keep working:

```text
agents.<my-domain>
```

Caveats worth recording:

- **Per-environment, no org-wide list.** Each environment carries its own
  allowlist and there is no organization-level allowlist an admin can push. So
  every environment I run cloud sessions in must be configured, or sessions
  from it report nothing — a real R2 ("reporting is mandatory") weakness.
- **All egress passes through a security proxy** that does content filtering,
  rate limiting and keeps a DNS-level audit trail of requested hostnames.
  Fine for this use, but the ingest endpoint is not a private channel.
- **A different route exists and bypasses the allowlist entirely: MCP
  connectors.** Connector traffic travels through Anthropic's servers rather
  than the session's network, so an ingest *MCP server* would need no
  allowlist entry at all. That is a genuinely different ingest design worth
  considering — though it inverts the "agent pushes by hook" model into
  "agent calls a tool", and an MCP tool call is a decision the model makes,
  not a guaranteed lifecycle event. Hooks stay the right primitive for R2;
  the connector path is the fallback if allowlisting proves unworkable.
- **`intentic`'s outbound-only Cloudflare tunnel does not help here.** The
  constraint is the *session's* egress policy, not my inbound firewall.

**Verdict on R3 for cloud sessions: feasible, with a per-environment setup
step.** It is no longer the project-killing unknown — but "every agent must
report" now depends on configuration I must remember to apply to each
environment, which belongs in the design as an explicit failure mode.


### 4.6 Test: do repo-committed `http` hooks fire in a cloud session? — **yes**

Method: committed a `.claude/settings.json` declaring a `SessionStart`
*command* hook (which starts a local HTTP sink on `127.0.0.1:8899`) plus
`UserPromptSubmit` and `PreToolUse` **`http`** hooks pointed at it, then
spawned a **fresh cloud session** on that branch and had it report the sink's
log. Testing against localhost deliberately separates *hook mechanics* from
*egress policy* (§4.5). Harness reverted afterwards.

**Result — all three fired, in order, with no approval prompt:**

```
15:18:02  SessionStart command hook ran
15:18:05  POST /user-prompt-submit   {"session_id":"d393175f-…","hook_event_name":"UserPromptSubmit", …}
15:18:08  POST /pre-tool-use         {"session_id":"d393175f-…","hook_event_name":"PreToolUse","tool_name":"Bash", …}
```

What this establishes:

1. **`http`-type hooks work in cloud sessions.** No wrapper script needed;
   R1+R2 are mechanically sound in the hardest environment.
2. **Repo-committed hooks load automatically and silently** — they ran before
   the session's first turn, with no trust prompt. Good for R2 ("mandatory"),
   and worth noting as a supply-chain consideration in any shared repo.
3. **A `SessionStart` command hook can run arbitrary setup**, which is how a
   local agent-side reporter/daemon could be installed per session.

Payload confirmations and surprises:

- The envelope matches the documented shape: `session_id`, `transcript_path`,
  `cwd`, `scratchpad_dir`, `prompt_id`, `permission_mode`, `hook_event_name`,
  plus `tool_name` / `tool_input` / `tool_use_id` on `PreToolUse`.
- `effort: {level: "high"}` appeared on `PreToolUse` but **not** on
  `UserPromptSubmit` — fields are event-dependent; the ingest schema must
  treat everything but the core four as optional.
- ⚠️ **No machine, host, or environment identifier anywhere in the payload**,
  and `session_id` is a bare UUID with no hint of which of the four
  environments produced it. Confirms §4.1's gap: the board cannot tell a cloud
  session from a laptop session without injecting that itself (per-host bearer
  token, or an env var via `allowedEnvVars`).
- ⚠️ **The payloads carry real content**: `UserPromptSubmit` includes the
  **full prompt text**, and `PreToolUse` includes `tool_input` — for Bash, the
  literal command line. An ingest server therefore receives everything I type
  and every command an agent runs. That is a storage/retention decision, not
  an afterthought: it argues for storing summaries by default and raw payloads
  only behind a flag.

### 4.7 Combined verdict on R3

| Environment | Hooks fire | Can reach my server | Net |
|---|---|---|---|
| Local CLI | ✅ (assumed, trivial) | ✅ | ✅ |
| Remote control | ✅ (local CLI under the hood) | ✅ | ✅ |
| Cloud / web | ✅ **verified** | ⚠️ only with **Custom** network access + host in **Allowed domains** | ✅ with setup |
| Desktop app | ❓ untested | ✅ presumably | ❓ |

**R3 is feasible. The premise survives.** The residual risks are configuration
discipline (every environment must be allowlisted), identity (the payload does
not say where it came from), and privacy (payloads carry prompts and commands).

---

## 5. One-way vs. interactive — the tension mostly dissolves

The stated plan was "phase 1 is one-way", with spawn-by-API as the one
exception. Two findings change the calculus:

1. **Hooks are request/response, not fire-and-forget.** A hook's HTTP response
   can carry `permissionDecision: allow|deny|ask`, `additionalContext`,
   `updatedInput`, even `systemMessage`. Blocking-capable events:
   `PreToolUse`, `UserPromptSubmit`, `UserPromptExpansion`, `PreModelSwitch`,
   `Stop`. So a server that merely *answers* the report it already receives is
   an approval/steering channel **at zero extra architecture** — the agent is
   already synchronously waiting on it.
2. **Steering an existing session** (injecting a new prompt mid-flight) is the
   genuinely harder part and stays out of v1. That needs either AgentAPI-style
   PTY wrapping, or the remote-control/`send_message` path for cloud sessions.

Proposed reframing of the phases:

- **Phase 1 — observe.** Ingest + board + history. Hook responses always `200 {}`.
- **Phase 1.5 — spawn.** Create cards; start cloud sessions via the Routines
  API and local ones via a headless runner. Unlocks R5/R6.
- **Phase 2 — approve.** Answer `PreToolUse`/`Notification` hooks from the
  board: a permission prompt becomes a card action ("Allow"/"Deny"). Cheap,
  because the transport already exists.
- **Phase 3 — steer.** Send new prompts to running sessions (AgentAPI wrapper
  locally; `send_message` for cloud).

---

## 6. Sketch of the architecture (if built)

```
   local CLI ─┐
   desktop  ──┤  http hooks (mandatory, settings.json)
   remote ctl ┤       │
   cloud/web ─┘       ▼
                ┌──────────────────────────────┐
                │  ingest  POST /hooks/event   │  ← bearer token per host
                │  ────────────────────────────│
                │  session store (card per     │
                │  session_id) + event log     │
                │  ────────────────────────────│
                │  spawn  POST /agents         │ ─→ Routines API (cloud)
                │                               │ ─→ local runner (home server)
                │  ────────────────────────────│
                │  board UI  (SSE/WebSocket)   │
                └──────────────────────────────┘
                     ▲
      GitHub webhook ─┘ (via n8n, outside the core)
```

**Column semantics** — steal Kanban Code's, which are derived from hooks and
therefore already proven:

| Column | Entered on |
|---|---|
| Backlog | card created by API/webhook, no session yet |
| In Progress | `SessionStart`, or `UserPromptSubmit` |
| Waiting (on me) | `Notification[permission_prompt]`, `PermissionRequest`, `Elicitation` |
| Idle / Done-ish | `Stop` with no follow-up, `TeammateIdle` |
| Review | PR opened for the card's branch (GitHub integration) |
| Done | `SessionEnd`, or PR merged |

**Suggested stack** — the home server is Docker + Compose; anything that runs
as one container with a small DB fits. SQLite is enough for R10/R11; the infra
stack already has Postgres if preferred.

---

## 7. Next research steps

Ordered by how much each one can change the build decision.

1. ~~**Verify the cloud-session hook path end-to-end.**~~ ✅ **Done
   2026-09-11 — see §4.5, §4.6, §4.7.** Hooks fire; egress needs a
   per-environment allowlist entry. The premise holds.
2. ~~**Deploy Fusion on the home server.**~~ ❌ **Withdrawn** — §2.5: the mesh
   spans only Fusion's own nodes and every task gets a Fusion-created
   worktree, so cloud sessions can never appear. Do not deploy.
3. **Deploy paperclip** and try registering a Claude Code session as an
   **HTTP/webhook agent**. No longer a base candidate (§8), but if that
   primitive accepts push reports it is worth importing its approval gates,
   budgets and audit logging later rather than designing them from scratch.
4. ~~**Read disler's observability server** for the ingest schema, then decide:
   fork it or write the ingest fresh.~~ ✅ **Done 2026-09-15 — see §9.**
   Decision: write fresh, keep the event vocabulary.
5. **Evaluate Omnara** — self-hostable, REST, multi-machine, two-way. Question:
   does it accept reports from a session it did not launch?
6. **Prototype the Routines API trigger** to confirm the issue→cloud-agent path
   (R5/R6), independent of which board wins.
7. **Verify desktop-app hook support** — smallest environment, easiest to drop
   from v1 if it doesn't work.
8. **Steal intentic's transport** regardless of outcome: outbound-only
   Cloudflare tunnel instead of an exposed ingest endpoint.
9. Still unscreened, described in ways that might overlap: `codecast` (watches
   local sessions → triage inbox), `Comet` (cross-device control plane,
   daemon + sync), `ai-maestro` (dashboard spanning multiple machines),
   `herdr` (socket API), `agentsmesh`, `centaur`, `background-agents`.

## 8. Decision — 2026-09-15: build thin, seeded by the observability server

**Chosen: option A + option D.** Write the control plane fresh, small, and
report-first, taking the event vocabulary (and the lessons) from disler's
`claude-code-hooks-multi-agent-observability` rather than starting from a
blank page.

Options B (fork Fusion) and C (bend paperclip) are **not** taken. B was
withdrawn in §2.5 — Fusion's mesh spans only its own nodes and every task gets
a Fusion-created worktree, so cloud sessions are invisible to it. C stays on
the shelf as a possible *later* import of specific features (approval gates,
budgets, audit logging) rather than as a base.

The reasoning that decided it, from §2.5: **adoption is unavailable for the
core, because the core is the one thing nothing does.** Every catalogued board
is authoritative over the agent lifecycle — a card exists because the board
started a process in a worktree it created. A claude.ai cloud session can
never be *owned* by a home server, only *heard from*. A report-ingesting
control plane therefore has to be written.

Scope of the decision: this settles **build vs. fork vs. adopt** only. The
remaining open questions below (what counts as an "agent", vendor-neutrality,
personal vs. product) are not settled and do not block M1.

---

## 9. Teardown: what disler's observability server actually is

Read at commit `HEAD` on 2026-09-15 (~13k LOC across `apps/server`,
`apps/client`, `.claude/hooks`). It is the only project in the survey that
ingests reports from agents it did not launch, so it is the closest prior art
that exists. Five findings, all of which change our design.

**The whole persisted schema is one table:**

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_app TEXT NOT NULL,
  session_id TEXT NOT NULL,
  hook_event_type TEXT NOT NULL,
  payload TEXT NOT NULL,      -- the entire hook JSON, stringified
  chat TEXT, summary TEXT, timestamp INTEGER NOT NULL
)
-- + migrated columns: humanInTheLoop, humanInTheLoopStatus, model_name
```

HTTP surface: `POST /events`, `GET /events/recent`, `GET
/events/filter-options`, `POST /events/:id/respond`, `/stream` (WebSocket),
plus a themes marketplace. **No authentication anywhere.**

### F1 — identity is a self-declared CLI flag, not a machine

`source_app` arrives as `--source-app cc-hook-multi-agent-obvs`, hardcoded
into every hook line in `.claude/settings.json`. It identifies the *project*,
and only because the string was typed into that repo's settings file. Nothing
identifies the **machine or environment**. This independently confirms the
§4.6 gap: identity is not in the payload and cannot be, so it must come from
the **transport**. → §10.2.

### F2 — the transport is Python, and that is the portability bug

Every hook is `type: "command"` running `uv run …/send_event.py`, which
imports `anthropic` and `python-dotenv`. That requires `uv`, Python, the
repo's `.claude/hooks/` tree and a working network install *on every host that
reports* — including cloud sandboxes, where it is one `uv` cold start per
hook. §4.6 verified that native `type: "http"` hooks fire in a fresh cloud
session with **none** of that: no interpreter, no wrapper script, no
dependencies. Keep their event vocabulary; throw away their transport.

### F3 — there is no session entity, so it is a log and not a board

`events` is the only table. The UI's "agent swim lanes" are derived
client-side by grouping events on `session_id`. There is no row representing a
session, no state, no column, nothing that survives a restart as an entity. A
kanban board is exactly that missing row: a card with a **current column**,
driven by the event stream. This is the piece we have to add, and it is the
piece that makes it a board.

### F4 — the enriched fields are dropped at the DB boundary

`send_event.py` carefully lifts ~15 fields to the top level (`tool_name`,
`tool_use_id`, `agent_id`, `agent_type`, `error`, `is_interrupt`,
`notification_type`, `reason`, …) and `insertEvent` persists **none of them** —
they survive only inside the `payload` blob. Any query by tool or agent means
JSON extraction over every row. Lesson: **anything we want to filter a board
by must be a real column.**

### F5 — the human-in-the-loop channel points the wrong way

`utils/hitl.py` starts a **WebSocket server on the agent's own machine**, picks
a free port, and hands the board `ws://localhost:<port>`; the board's UI then
connects *back* to the agent and the hook blocks up to 300s waiting.

That is unusable here. It needs inbound reachability to the agent host —
impossible for a cloud sandbox, and false for any laptop behind NAT. The
native `http` hook's **response body** does the same job with no reverse
channel at all: the agent is already synchronously waiting on our reply, and
that reply may carry `permissionDecision`. This retires the main worry about
§5's phase 2 and fixes its design: **approvals ride the response to the report,
never a callback.**

### Verdict: write fresh, keep the vocabulary

| Keep | Drop |
|---|---|
| The 12-event vocabulary and what each one means | The `uv`/Python transport (F2) |
| Per-event emoji/colour as a UI affordance | `source_app` as identity (F1) |
| A single fan-out stream to the UI | Blob-only schema (F3, F4) |
| "Always exit 0, never block the agent" discipline | The HITL reverse channel (F5) |
| — | The themes marketplace (~half the codebase) |

Not a fork: the two things we need most — a session entity and real identity —
are precisely the two it does not have, and the Vue client plus themes
subsystem are irrelevant to us.

---

## 10. v1 design

### 10.1 Data model

Answers the open question *"what is a card?"* — **the card is a task; sessions
attach to it.** A session that reports without a known task auto-creates one,
so unsolicited reports still produce a card, and a card survives `SessionEnd`,
resume, fork and retry.

```
host     id, name, kind(local|desktop|remote|cloud), token_hash,
         retain_raw BOOL, created_at, last_seen_at
task     id, title, column, repo, branch, external_ref, created_by,
         created_at, updated_at            -- the card
session  id (Claude session_id), task_id, host_id, cwd, model,
         transcript_path, state, started_at, last_event_at,
         ended_at, end_reason
event    id, session_id, host_id, seq, type, tool_name, tool_use_id,
         agent_id, agent_type, summary, payload_json, ts   -- F4: real columns
approval id, event_id, session_id, kind, request_json,
         decision, decided_at                              -- phase 2
```

### 10.2 Identity — per-host bearer token, injected from the environment

Closes the §4.6 open question. **Verified 2026-09-15:** `type: "http"` hooks
support a `headers` map whose values interpolate environment variables, gated
by an `allowedEnvVars` allowlist:

```json
{
  "type": "http",
  "url": "https://agents.<my-domain>/ingest",
  "headers": { "Authorization": "Bearer $AGENT_BOARD_TOKEN" },
  "allowedEnvVars": ["AGENT_BOARD_TOKEN"]
}
```

This is the mechanism the design needs, and it is better than the per-host URL
path first sketched here:

- **One committed hook config works on every host.** The config is identical in
  `.claude/settings.json`; each machine or cloud environment supplies its own
  `AGENT_BOARD_TOKEN`. The token never enters the repo.
- **The token maps to a `host` row**, which is what stamps every event with its
  machine and environment — identity comes from the transport, per F1.
- **Unset variables interpolate to the empty string**, not an error. So a host
  that was never provisioned sends `Bearer ` and the server can file it as an
  *unidentified host* rather than silently accepting or silently dropping it.
  R2's weak point ("what if an agent doesn't report?") gains a detectable
  failure mode: reports that arrive unattributed.
- **No token in access logs**, which the path scheme would have required
  suppressing.

For cloud sessions the variable is set per-environment, so the environment that
already needs an allowlist entry (§4.5) is the same unit that carries the
token — one provisioning step, not two.

Also available and worth using: `if` (permission-rule syntax) to filter which
tool events report at all, keeping volume down without a server-side filter,
and `statusMessage` for the spinner text while a blocking hook runs.

### 10.3 HTTP surface

| Route | Purpose |
|---|---|
| `POST /ingest` | the one mandatory endpoint. `Authorization: Bearer <host-token>`; body = the raw hook JSON. Returns `{}` in phase 1; a decision object in phase 2 |
| `GET /api/board` | columns + cards |
| `GET /api/tasks/:id`, `GET /api/sessions/:id/events` | drill-down |
| `POST /api/tasks` | create a card (R5), optionally `{spawn: "cloud"\|"local"}` |
| `GET /stream` | SSE — one-way, reconnects natively, no WebSocket needed |
| `POST /api/approvals/:id` | phase 2 |

### 10.4 Privacy defaults

Answers the retention open question, which §4.6 made urgent (payloads carry
full prompt text and literal shell command lines).

- Store structured fields + a `summary` **always**; store `payload_json`
  **only** when the host row has `retain_raw`.
- Truncate prompt text and `tool_input.command` to a bounded prefix, keep a
  hash of the full value for dedupe.
- Reference `transcript_path`; never fetch the transcript.

### 10.5 Stack

Bun + `bun:sqlite`, one container, SQLite on a named volume. SQLite over the
infra stack's Postgres deliberately: R10/R11 are single-user and low-volume,
and a self-contained board does not go down when Postgres does. Board UI
server-rendered + SSE, no build step.

Exposure: `agents.<my-domain>` via the existing Cloudflare → reverse proxy
path (intentic's outbound-only tunnel idea, using infrastructure this repo
already has). Cloud sessions additionally need that host in their
environment's **Custom** allowlist — per §4.5 this is per-environment and
cannot be set org-wide, which remains the weakest point in R2.

### 10.6 Spawning (R5/R6)

- **Cloud** → Routines API (`POST` with a per-routine bearer token).
- **Home server** → small headless runner (`claude -p` in a container).
- **GitHub issue → card** → n8n workflow calling `POST /api/tasks`, keeping
  GitHub outside the core exactly as specified ("GitHub issues will be outside
  or plugin").

### 10.7 Build order

| | Milestone | Unlocks |
|---|---|---|
| M1 | ingest + task/session rows + SSE board (read-only) — ✅ **built 2026-09-15** | R1, R2, R3 |
| M2 | per-host tokens + unidentified-host handling, privacy defaults, cloud allowlist entry | R4, R7 |
| M3 | `POST /api/tasks` + n8n GitHub webhook → card | R5 |
| M4 | spawn cloud sessions via Routines | R6 |
| M5 | approvals over the hook response (F5) | phase 2 |

### 10.8 Questions this decision closes

- ~~Build, fork, or adopt?~~ → **build** (§8).
- ~~What is a card?~~ → **a task**, with sessions attached (§10.1).
- ~~How does a card know which machine it came from?~~ → **per-host bearer
  token injected from the host's environment** (§10.2, verified).
- ~~Retention and privacy?~~ → **summaries + structured fields by default,
  raw behind a per-host flag** (§10.4).

Still open, and not blocking M1: the scope of "agent" (coding agents only vs.
everything autonomous on this host), vendor-neutrality of the report contract
(R8), and personal-tool vs. product.

---

## Open questions

Four earlier questions were closed by the decision in §8 and the design in
§10 — see [§10.8](#108-questions-this-decision-closes). What remains:

- Is the board meant to be **only mine** (R10), or eventually a product? This
  changes auth and multi-tenancy decisions drastically. (Hosting is settled:
  self-hosted, R9.)
- **Copyleft acceptable?** Two shortlist candidates are AGPL-3.0 (`kandev`) and
  GPL-3.0 (`Garcon`). Fine for a private home-server deployment; a constraint
  if this ever becomes a product. The MIT/Apache candidates (Fusion, paperclip,
  Omnara, OpenHands, intentic, Open Session) carry no such question.
- **Scope of "agent"**: only coding agents, or also the n8n AI agents and
  scheduled automations already running on this host? A board that shows
  "everything autonomous that is currently running for me" is a different
  (larger, more interesting) product than a coding-agent board.
- **Non-Claude agents (R8)**: does the report contract need to be
  vendor-neutral from day one, or is a Claude-shaped schema fine with a
  translation layer added later?
- **What happens when an agent doesn't report?** Crash, `--settings` override,
  `disableAllHooks`, a session started before the hook existed. Mandatory
  reporting (R2) is only as strong as the settings file that declares it.

## Sources

- [awesome-agent-orchestrators] — the ~200-project catalogue
- [vibe-kanban] · [kanban-code] · [Omnara] · [Omnigent] · [AgentAPI] · [observability]
- Self-hosted shortlist: [Fusion] · [paperclip] · [kandev] · [Garcon] ·
  [OpenHands] · [Open Session] · [intentic] · [Ouijit]
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
- [Claude Code monitoring / OpenTelemetry](https://code.claude.com/docs/en/monitoring-usage)
- [Routines fire API](https://platform.claude.com/docs/en/api/claude-code/routines-fire)
- [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web)

[awesome-agent-orchestrators]: https://github.com/andyrewlee/awesome-agent-orchestrators
[vibe-kanban]: https://github.com/BloopAI/vibe-kanban
[kanban-code]: https://github.com/langwatch/kanban-code
[Omnara]: https://github.com/omnara-ai/omnara
[Omnigent]: https://github.com/omnigent-ai/omnigent
[AgentAPI]: https://github.com/coder/agentapi
[observability]: https://github.com/disler/claude-code-hooks-multi-agent-observability
[Fusion]: https://github.com/Runfusion/Fusion
[paperclip]: https://github.com/paperclipai/paperclip
[kandev]: https://github.com/kdlbs/kandev
[Garcon]: https://github.com/cfal/garcon
[OpenHands]: https://github.com/OpenHands/OpenHands
[Open Session]: https://github.com/tellahq/opensession
[intentic]: https://github.com/intentic/intentic
[Ouijit]: https://github.com/ouijit/ouijit
