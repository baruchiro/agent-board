---
name: plan-project
description: First-run kickoff for a project cloned from this template. Orchestrates the bundled planning skills (optionally grill-me → brainstorming → writing-plans) and adds the template-specific glue — an approval-gated STORIES.md, filled-in CLAUDE.md, and wired toolchain. Use on a fresh clone (placeholders still present), or when the user says "plan the project", "let's start", "kick off", "what should we build first", or describes a new app/idea from scratch.
---

# plan-project

Take an idea to a project that's ready to build test-first. This skill is a thin
**orchestrator**: the thinking is done by battle-tested skills vendored from
elsewhere —

- **`grill-me`** (optional) — from [`mattpocock/skills`](https://github.com/mattpocock/skills).
  A stateless, relentless interview that sharpens a loose idea into concrete
  decisions before any design work starts. Reach for it only when the idea is
  still vague; skip it when the user already arrives scoped.
- **`brainstorming`** — from [`obra/superpowers`](https://github.com/obra/superpowers).
  Explore intent, constraints, and design; ends in an approved design spec. (It
  hard-gates: no code until you've presented a design and the user approved it.)
- **`writing-plans`** — from `obra/superpowers`. Turn a spec into a bite-sized,
  test-first implementation plan.

What this skill adds is the glue those generic skills don't know about: this
template's **STORIES.md** as the approval-gated source of truth, the
**Project-specific** sections of `CLAUDE.md`, and the `/ship` + CI wiring.

## When to use

- A fresh clone where `CLAUDE.md` still has `<!-- FILL IN -->` placeholders and
  `STORIES.md` still has the `CORE-*` examples.
- The user describes a new project and wants to start.

If the project is already underway (real stories, no placeholders), don't re-run
this — add or change stories through the normal approval-gated flow, and reach
for `brainstorming` / `writing-plans` per-feature instead.

## Workflow

### 1. Sharpen a loose idea — invoke `grill-me` (optional)

If the idea arrives loose ("something like X" with no real scope yet), grill it
before design work starts: invoke the `grilling` skill — `grill-me`'s own
`SKILL.md` is just a one-line forward to it, so invoke `grilling` directly. It
interviews in rounds (a numbered frontier of questions plus your recommended
answer each round) until every branch is settled. It's stateless — no files, no
repo assumptions — so it's safe to run before `CLAUDE.md`/`STORIES.md` exist.
Stay in the same conversation afterward; hand the sharpened idea straight to
`brainstorming` next. Skip this step entirely when the user already arrives with
a precise, scoped idea — `brainstorming`'s own clarifying questions are enough.

### 2. Brainstorm the design — invoke `brainstorming`

Hand off to the `brainstorming` skill. Let it drive: explore context, ask
questions one at a time, propose approaches, present a design, and — on approval
— write the design spec (it saves to `docs/superpowers/specs/`). Don't shortcut
its hard gate; come back here only once the user has approved the design.

### 3. Lock the stack → fill in `CLAUDE.md`

From the approved design, recommend a concrete stack (runtime, framework,
language, data layer, styling, test runner, lint/format) with versions — one
recommendation with a one-line reason each. On approval, fill the
**Project-specific** sections of `CLAUDE.md` (purpose, stack, layout, commands,
env vars, setup) and delete each `<!-- FILL IN -->` note.

### 4. Derive the stories → `STORIES.md` (approval-gated)

Translate the approved design into behavioral stories. **Stories are the
template's source of truth for product behavior** — a different artifact from the
superpowers design spec (which captures *how* it's built). Propose the story text
**in chat** first:

- Group by feature area with a stable prefix (`AUTH-`, `CORE-`, …); each story is
  `## PREFIX-N — Title` + an "As a …, I want …, so that …" paragraph about
  *behavior*, not implementation.
- Sequence them: first-slice stories vs. roadmap. Mark not-yet-built ones
  `<!-- @unimplemented -->`.

Iterate until the owner says "approved", then write `STORIES.md`, replacing the
`CORE-*` examples.

### 5. Wire the toolchain

Point `/ship` (`.claude/commands/ship.md`) and `.github/workflows/ci.yml` at the
stack's real typecheck / lint / format / test / build commands. **Keep**
`node scripts/check-stories.mjs`. Confirm the gate is green on the empty project
(an all-`@unimplemented` `STORIES.md` passes).

#### Browser verification — install `playwright-cli`

**If the stack has a UI**, set up `playwright-cli` so the agent can actually
drive the app, as `CLAUDE.md`'s
[Verifying your change](../../../CLAUDE.md#verifying-your-change) requires.
Prefer it over the Playwright MCP: it's the
[Playwright CLI for coding agents](https://playwright.dev/docs/getting-started-cli),
and CLI commands keep large tool schemas and verbose accessibility trees out of
the context window. Skip this whole sub-step for a backend-only stack and say so
rather than installing it unused.

The **skill** is already vendored at `.claude/skills/playwright-cli/`. What a
fresh clone needs is the **binary**:

```sh
npm install -g @playwright/cli@latest   # any language
playwright-cli --help
```

If the stack already depends on Playwright, use the bundled entry point instead
of a global install — `npx playwright cli <command>` (JS/TS) or
`python -m playwright cli <command>` (Python). Substitute that for
`playwright-cli` in every command below.

Then make the browser reachable and prove it works against the real dev server:

```sh
playwright-cli install-browser chromium
playwright-cli open http://localhost:<dev-port> --headed
playwright-cli resize 375 667                     # mobile-first, per CLAUDE.md
playwright-cli snapshot
playwright-cli close
```

To refresh the vendored skill from the installed CLI (it ships with the CLI, so
it moves with the version):

```sh
playwright-cli install --skills          # → .claude/skills/playwright-cli/
playwright-cli install --skills -g       # instead share it across all projects
playwright-cli install --skills=agents   # AGENTS.md-style agents instead of claude
```

**Sandboxed environments** (Claude Code on the web, CI images, most containers)
often ship a browser already and block the download CDN, and run as root so
Chromium's sandbox fails. `install --skills` still succeeds there — it's
`install-browser` that fails, and the two are independent. Point the CLI at the
existing binary via `.playwright/cli.config.json`, which it auto-loads:

```json
{
  "browser": {
    "launchOptions": {
      "executablePath": "/opt/pw-browsers/chromium",
      "chromiumSandbox": false
    }
  }
}
```

It resolves relative to the working directory, so run `playwright-cli` from the
repo root or it silently falls back to downloading a browser. Commit the config
when the whole team shares one container image; leave it uncommitted when the
path is a local quirk — a wrong `executablePath` fails the launch outright
instead of falling back. `.gitignore` already ignores everything else under
`.playwright/`, plus `.playwright-cli/` (snapshot and screenshot output).

### 6. Plan the first slice — invoke `writing-plans`

Pick the smallest vertical slice that delivers one visible end-to-end behavior;
name the story IDs it covers. Hand off to `writing-plans` to produce the
implementation plan for that slice (bite-sized, test-first tasks).

### 7. Hand off to implementation

Implement the first slice **test-first**, per this template's workflow: write the
`@story:`-tagged test, watch it fail, make it pass, run `/ship`. Delete
`tests/example.test.mjs` once real tests exist. Then stop — implementation is a
separate step.

> `writing-plans` offers a superpowers execution hand-off
> (`subagent-driven-development` / `executing-plans`). Both are bundled, but
> this template's own test-first + `/ship` loop is enough for a first slice —
> reach for them when a plan is big enough to need checkpoints or parallelism.

## Output checklist

- [ ] Loose idea sharpened via `grill-me`/`grilling` before design (or skipped
      — idea already arrived scoped).
- [ ] Design spec written & approved (via `brainstorming`).
- [ ] `CLAUDE.md` Project-specific sections filled, `FILL IN` notes removed.
- [ ] `STORIES.md` reflects approved stories; `CORE-*` examples gone.
- [ ] `/ship` and CI point at real commands; story-coverage step kept.
- [ ] UI stack: `playwright-cli` installed and verified against the dev server
      (or explicitly skipped as backend-only).
- [ ] First slice planned (via `writing-plans`), identified by story ID.
- [ ] `tests/example.test.mjs` deleted once real tests exist.
