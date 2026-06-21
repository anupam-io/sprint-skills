---
name: sprint
description: Run a planned sprint — process its dependency-ordered GitHub issues one at a time to completion, safely. A sprint is a batch of interconnected issues designed by the `sprint-plan` skill (labelled sprint-N, with a plan.json wave schedule under .claude/sprints/). Use when the user says "run the sprint", "start sprint-N", "execute the sprint", "what's the state of the sprint", or hands over issues/tickets to work through. If no sprint exists yet, this routes to `sprint-plan` to design one first. NEVER takes a git action without the user explicitly choosing an execution mode (HITL or AFK).
---

# sprint

The **runner / front door**. Designing happens in `sprint-plan` (it leaves a
`plan.json` wave schedule + GitHub issues). This skill takes an *approved* sprint
and drives it to completion — one issue at a time, reconciling real state from
GitHub before every step, so it's always safe to stop and re-enter.

Everything is GitHub (issues = work, PRs = delivery) + the repo's
`.claude/sprints/sprint-N/`. No cluster, no external tracker, no private infra.

## Two hard rules

1. **No git action without an explicit mode.** Before anything touches a branch,
   PR, or merge, the user must choose **HITL** or **AFK** (below). Never assume one.
2. **One Claude instance at a time.** Issues run strictly sequentially. That
   serialization is what lets the agent rebase + merge safely — nothing else is
   touching the tree, so nothing gets lost.

## When invoked — dispatch on state

```
Look in .claude/sprints/ + `gh issue list --label sprint-*`:
  ├─ NO sprint (or every issue done) → DESIGN
  │     Hand to the `sprint-plan` skill. Seed it from whatever the user gave you —
  │     a one-line goal, a PRD, pasted GitHub/Linear tickets, or "look at the repo
  │     and propose one". Planning is interactive and human-gated; come back here
  │     to run it once issues exist.
  └─ sprint EXISTS with open work → ADVANCE  (ask the mode, then run — see below)
```

Never silently pick a sprint. If several are unfinished, ask which.

## ADVANCE — ask the mode, then run

Before running, ask the user **how** to execute (this is the explicit git
permission — don't skip it):

- **HITL — Human In The Loop** (safe default): the agent implements each ready
  issue and opens a PR, then **stops**. The user reviews and merges. Nothing the
  agent does lands on the base branch. Dependent issues wait until the user merges.
- **AFK — Away From Keyboard**: the agent implements, opens a PR, and **safely
  merges** each issue into the base branch (rebase → resolve → re-check → merge),
  then moves to the next — unattended, to completion or budget.

Then run the bundled script, which enforces both hard rules:

```bash
bash .claude/skills/sprint/run-sprint.sh --hitl            # or --afk
bash .claude/skills/sprint/run-sprint.sh --afk -n 10       # advance up to 10 issues
bash .claude/skills/sprint/run-sprint.sh status            # the board, read-only
bash .claude/skills/sprint/run-sprint.sh doctor            # preflight
```

Each iteration the script: reconciles live state from GitHub → picks the lowest
unblocked issue (every dependency merged) → hands it to ONE `claude` instance
end-to-end (read issue → branch → implement only the `## Plan` → verify every
`## Definition of Done` line → open PR → in AFK, safe-merge) → checkpoints to
`runlog.jsonl` → repeats up to `-n`. `-n` bounds the blast radius; exiting between
issues is the feature (bounded cost, inspectable, Ctrl-C-safe).

### Two ways the user runs it

- **The bash file directly** — `run-sprint.sh --afk -n 10`. Pretty streamed output
  (`⚡ tool` lines, per-issue banners, a cost summary) and optional spoken
  narration on macOS (`--mute` to silence). This is the unattended path.
- **This skill, conversationally** — "run the sprint". You confirm the mode, then
  either invoke `run-sprint.sh` or, for a single careful step, drive one issue
  inline and report. Same rules either way.

## status

Read-only — takes no git action. `run-sprint.sh status` prints every planned
issue with its live verdict (`done` / `in-review` / `blocked` / `ready` /
`refire`) and a one-line direction call. The verdicts come from GitHub labels +
PR state, reconciled against `plan.json`:

| verdict | meaning | next |
|---|---|---|
| done | issue closed or its PR merged | nothing |
| in-review | PR open, awaiting human | user reviews/merges (HITL) |
| blocked | `status:needs-human` | a human unblocks it |
| ready | unblocked, all deps merged | the runner fires it |
| refire | started but no PR (a crashed run) | the runner safely re-fires |

## close — retro

When every sprint-N issue is done, write `result.md` to
`.claude/sprints/sprint-N/`:

1. **Verify done** — all sprint-N issues closed, all PRs merged. If anything's
   open, bail with the list; never close over open work.
2. **Load `promise.md`** — judge delivered vs promised (in scope vs drifted).
3. **Aggregate** from `runlog.jsonl` — total spend, per-issue cost, slowest/
   costliest issue, count of re-fires.
4. **Write `result.md`**: header (sprint N, close timestamp, one-line outcome) ·
   promise-vs-delivered table (✅ merged / ⚠️ partial / ❌ dropped / ➕ added) ·
   metrics · what shipped (3-7 capability highlights) · what missed (re-fire
   loops, blocks) · future plan for sprint N+1 (a proposal, not a commitment).

Don't auto-plan N+1 — the future-plan section seeds the user's next `sprint-plan`.

## State

Per-sprint artifacts live in the repo under `.claude/sprints/sprint-N/`:
`plan.json` (the runner's wave schedule), `promise.md` (the contract), `dag.mmd`
+ `dag.html` (the graph), `runlog.jsonl` (the checkpoint), `result.md` (the retro).
The active sprint is whichever has open issues; the runner defaults to the
highest-numbered one (override with `--sprint N`).

## Result line

End with exactly one of:
- `RESULT: SPRINT_ADVANCED N <count>` — ran the runner; `<count>` issues progressed
- `RESULT: SPRINT_STATUS N` — after a status read
- `RESULT: SPRINT_CLOSED N` — after writing result.md
- `RESULT: SPRINT_DESIGN` — no sprint yet; routed to `sprint-plan`
- `RESULT: IDLE` — nothing to do this turn
