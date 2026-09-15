---
description: Pre-push verification — typecheck, lint, story-coverage, tests, build. Fix everything before declaring done.
---

Run the full pre-push sequence and report results. Do not skip any step. If a
step fails, stop and fix before continuing.

1. **Typecheck** — `bun run typecheck` must pass with zero errors.
2. **Story coverage** — `node scripts/check-stories.mjs` must pass (every story
   has a tagged test; no test references an unknown story ID).
3. **Tests** — `bun test` must be green.
4. **Container** — `docker build -t agent-board:ci .` must succeed.

There is no lint or bundler step in this project by design — `tsc --noEmit`
and `bun test` are the gate. `bun run check` runs steps 1–3 in one go.

When all steps pass, say so explicitly with the command outputs. If any step
fails, surface the failing command and the relevant error excerpt — do not
summarize away the actual error message.

Do not run `git push` automatically. The user pushes (or `/open-pr` does).
