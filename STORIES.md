# Stories

> This file is the source of truth for product behavior. Every change to a
> story — adding, editing, deleting — requires explicit approval from the
> repository owner. Code and tests adapt to the stories, not the other way
> around. See `CLAUDE.md` § "Stories workflow" for the test-coverage rule.

<!--
  Story IDs are permanent — don't renumber. A story recorded ahead of its
  implementation carries `<!-- @unimplemented -->` inside its section; remove
  the marker in the same change that lands its tagged tests.

  Scope, as of 2026-09-15: coding agents only. The report contract may stay
  Claude-shaped; a translation layer for other agents comes later, if ever.
-->

## INGEST-1 — A session reports in from anywhere

As someone running Claude Code in any environment, I want each session to
report its lifecycle events to the board over an HTTP hook, so that I can see
sessions the board never launched.

## INGEST-2 — An unknown session creates its own card

As a user, I want a session the board has never seen before to create a card by
itself, so that I never have to register work in advance for it to appear.

## INGEST-3 — Reporting never blocks the agent

As a user, I want `/ingest` to always answer with an empty decision, so that the
board can never stall, block or alter a running session.

## BOARD-1 — Cards move themselves between columns

As a user, I want a card's column to follow its session's hook events, so that
the board reflects reality without me dragging anything.

## BOARD-2 — A stop-hook loop is not idleness

As a user, I want a `Stop` event carrying `stop_hook_active` to leave the card
where it is, so that a stop-hook loop is not mistaken for a finished session.

## BOARD-3 — A card outlives its session

As a user, I want a card to be a task with sessions attached, so that it
survives `SessionEnd`, resume and retry instead of disappearing.

## BOARD-4 — The board updates live

As a user, I want the board to update without a refresh, so that I can leave it
open on a second screen.

## HOST-1 — Every card shows where it is running

As an operator, I want each machine or cloud environment to carry its own
token, so that every card is attributed to its host without committing a secret
to any repo.

## HOST-2 — An unprovisioned host is visible, not silent

As an operator, I want reports arriving with no usable token filed under
"unidentified" rather than dropped, so that a misconfigured machine is
something I can see.

## PRIVACY-1 — Prompts and commands are truncated by default

As a user, I want prompt text and shell command lines truncated to a bounded
prefix plus a hash of the full value, so that the board's history is not a
transcript of everything I typed and ran.

## PRIVACY-2 — Raw payloads only when asked for

As an operator, I want raw hook payloads stored only for hosts I explicitly
created with `--retain-raw`, so that full-fidelity capture is a deliberate
choice per machine.

## AUTH-1 — Only I can open the board

<!-- @unimplemented -->

As the owner of a board exposed on a public hostname, I want reading the board
and its API to require my own identity, so that publishing the ingest endpoint
does not publish everything my agents are doing.

Satisfied by an identity-provider policy on the Access application covering
everything except the ingest path. No application code — remove the marker when
a test can prove the deployed policy, or when app-level auth is built instead.

## AUTH-2 — Agents authenticate with no human in the middle

As an operator, I want a reporting agent to authenticate to the edge with
static credentials it carries in its environment, so that hooks keep working
where there is nobody to complete a browser login.

## SPAWN-1 — Create a card by API

<!-- @unimplemented -->

As a user, I want to create a card over the API with no session attached yet,
so that an opened GitHub issue can become a card waiting in Backlog.

## SPAWN-2 — Start a cloud session from a card

<!-- @unimplemented -->

As a user, I want to start a cloud agent from a card, so that a queued task
becomes a running session with one click.

## APPROVE-1 — Answer a permission prompt from the board

<!-- @unimplemented -->

As a user, I want to allow or deny a waiting permission prompt from the card,
so that I can unblock an agent without finding its terminal.
