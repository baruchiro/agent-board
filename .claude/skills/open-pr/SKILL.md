---
name: open-pr
description: Opens a GitHub PR for the current branch after running the local gate. Use when the user asks to "open a PR", "create a pull request", "push and open PR", or "ship this". For UI projects, include a screenshot of the change.
---

# open-pr

Take a branch to an open pull request, safely. The gate runs first, so broken
work never gets pushed.

## When to use

User says any of: "open a PR", "create a pull request", "push and open PR",
"ship this". If they gave a title or scope, honor it; otherwise derive it from
the branch's commit log.

Do **not** open a PR unless asked — except when working a GitHub issue, where
every issue gets a PR (see `CLAUDE.md` § "GitHub issue workflow").

## Workflow

### 1. Pre-flight — run the local gate

Run the `/ship` sequence (`.claude/commands/ship.md`). **Abort on failure** — do
not push broken work. Surface the error and stop.

### 2. Evidence of the change

- **UI change**: capture a screenshot of the affected screen (mobile-first,
  `375×667`) and commit it under `docs/screenshots/<branch>/` so it has a stable
  raw URL to embed in the PR body. Drive the capture yourself (e.g. the
  Playwright MCP) — don't ask the user to do it.

  Commit the PNG as a real binary via `git add` + `git commit`. **Never** commit
  it through a GitHub file API whose `content` field is base64 — it lands as
  base64 *text*, not an image.
- **Backend-only change**: no screenshot. Note "no UI surface changed" in the
  body.

### 3. Push the branch

```sh
git push -u origin "$(git branch --show-current)"
```

Retry on network errors with exponential backoff (2s, 4s, 8s, 16s).

### 4. Open the PR

Use the GitHub MCP (`mcp__github__create_pull_request`) — `gh` may not be
available in cloud sessions. Check for a PR template
(`.github/pull_request_template.md` or `.github/PULL_REQUEST_TEMPLATE/`) and
mirror its structure if present; otherwise use:

```markdown
## What
<one-line summary>

## Why
<one-line motivation>

## Screenshots
<embed the raw URL from step 2, or "No UI surface changed.">

## Test plan
- [x] Local gate green (typecheck / lint / story-coverage / tests / build)
- [ ] Manual: <the flow you exercised>
```

If this PR resolves a GitHub issue, end the body with the closing keyword on its
own line and the session link:

```
Closes #<issue-number>

Session: https://claude.ai/code/session_<id>
```

### 5. Report back

> PR opened at <PR URL>.

## When NOT to use

- Backend-only hotfix / typo fix — open the PR directly, no screenshot.
- User hasn't asked for a PR and you're not working an issue — don't open one.
