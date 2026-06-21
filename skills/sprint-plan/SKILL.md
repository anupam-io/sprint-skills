---
name: sprint-plan
description: Design one sprint as a dependency-ordered wave DAG of GitHub issues a long-running agent can execute unattended. Use when the user says "plan a sprint", "design a sprint", "scope the next batch of work", or hands over a goal/PRD/repo to break into interconnected GitHub issues. This is the designer (drafts the issues, the wave DAG, and a promise.md, then creates the issues only on approval); the `sprint` skill and its run-sprint.sh are the runner that executes the waves.
---

# sprint-plan

The **designer**. You turn one goal into a dependency-ordered wave plan a
long-running agent can execute unattended — decompose, size, map file ownership,
build the DAG, sort into waves — so that once the user approves, the `sprint`
runner fires issue after issue to completion without a human in the loop.

Plan-time is the only human gate. Get it right and the unattended run is boring;
get it wrong and issues collide or build on code that doesn't exist yet.

**Everything is GitHub + local.** Issues live on GitHub Issues, delivery is
GitHub PRs, and the sprint's own artifacts live in the repo under
`.claude/sprints/sprint-N/`. No external tracker, no private infra.

## What you produce

1. **`plan.json`** — the machine-readable wave schedule (`run-sprint.sh` reads
   this, not the prose). One object per issue: `{id, title, type, deps, wave, files}`.
2. **`promise.md`** — the human-readable sprint contract (schema below).
3. **`dag.html`** — a self-contained rendered graph the user opens in a browser
   to eyeball the waves before approving.
4. **GitHub issues** — one per node, each with `## Plan` + `## Definition of Done`
   and the `sprint-N` + `type:*` + `status:ready` labels. Created **only after
   the user approves the draft.**

All four land in `.claude/sprints/sprint-N/` (artifacts) and on GitHub (issues).

## The pipeline

Steps 1-5 are drafting (no writes to GitHub); step 6 is the human gate; step 7 commits.

### 1. Ground the direction

- **Source the goal** from whatever the user gave you: a one-line prompt, a PRD,
  pasted tickets (GitHub issues, a Linear export — just text to decompose, no
  integration), or "look at the repo and propose one." If it's the repo, read its
  `CLAUDE.md` / `README` and the last ~10 merged PRs to infer the next worthwhile batch.
- Count existing `status:ready` issues — some of the sprint may already be filed;
  don't re-create what exists.
- Pick the next sprint integer `N` (highest existing `sprint-*` label + 1, else 1).

### 2. Decompose into atomic issues

The highest-leverage step and the one LLMs get wrong. **Resist writing a few fat
issues.** Each issue must fit in one agent's context window = roughly one PR: one
migration, one component, one endpoint, one refactor of one module.

- Hard cap **~300 LOC per issue.** Anything bigger gets split *now*, at plan time.
- Aim for **10-30 issues.** If the goal only yields 6, it's a small sprint — say
  so; don't pad. If it yields 50, it's two sprints — plan the first.
- Tag each with a `type`: `research | feature | bug | improvement | qa`.

### 3. Assign file ownership

For each issue, list the **exact paths it will own** (no globs — the collision
check is literal string equality). Best-effort, but load-bearing: two issues in
the same wave must touch **no file in common** (one file, one owner). This is what
lets a wave's issues be worked back-to-back without merge wars. Be concrete —
`api/todos/handlers.ts`, `db/schema/todos.ts` — not `src/`.

### 4. Build the dependency graph

Issue B depends on A iff B genuinely cannot start until A's output exists (B
imports A's schema, calls A's endpoint, extends A's component). **Default to
independent** — only add a dep when it's real. Over-declaring deps serialises the
sprint and kills throughput.

### 5. Sort into waves + render

Write the issues to a temp JSON and run the bundled deterministic sorter — don't
hand-sort 20+ nodes:

```bash
# issues.json: [{ "id": 1, "title": "...", "type": "feature", "deps": [], "files": ["..."] }, ...]
# (sequential placeholder ids 1..N at draft time; remap to real GH numbers after creation)
node .claude/skills/sprint-plan/wave-sort.mjs issues.json \
  --max-wave-width 8 \
  --out "$(git rev-parse --show-toplevel)/.claude/sprints/sprint-N/"
```

It computes waves (deps satisfied + file-disjoint), splits same-file pairs across
waves, splits any over-wide wave into sub-waves, **errors on a dependency cycle**,
and writes `dag.mmd`, `dag.html`, and `plan.json`. A sprint typically lands in
**4-6 waves**. `--max-wave-width` just caps how many issues share a wave; with a
sequential runner it mainly affects the graph's shape, not safety.

### 6. Show the user — the human gate

Present, in chat: the composition (counts by type), the wave table (the sorter's
text output), the Mermaid DAG block, and a pointer to open
`.claude/sprints/sprint-N/dag.html` in a browser.

Then **stop and wait for explicit approval.** Do not create a single GitHub issue
before the user says go — an LLM-drafted plan that's subtly wrong wastes the whole
unattended run. Iterate here: re-split a fat issue, break a false dependency, move
a collision. Re-run the sorter after edits.

### 7. On approval — create issues + write artifacts

- Create the labels if absent (idempotent with `--force`):
  ```bash
  gh label create sprint-N --color BFD4F2 --description "Sprint N" --force
  gh label create status:ready --color C2E0C6 --force
  gh label create type:feature --color 1D76DB --force   # repeat per type used
  ```
- For each issue, in dependency order, `gh issue create` with:
  - a `## Plan` (plain heading — you are designer of record, so it's pre-approved
    scope) covering goal / constraints / format of done / failure mode / files owned,
  - a `## Definition of Done` — a `- [ ]` checklist of **verifiable** predicates
    the runner grades pass/fail. Always include `- [ ] PR opens against <base>` and
    `- [ ] gh pr checks all pass`, plus feature-specific lines (a command that exits
    0, an endpoint that returns a known shape).
  - labels `type:<type>`, `status:ready`, `sprint-N`.
- **Remap** the placeholder ids in `plan.json` + `promise.md` to the real GH issue
  numbers, and re-run `wave-sort.mjs` with the real ids so `dag.html` and
  `plan.json` carry real numbers (the runner keys off these).
- Write **`promise.md`** (schema below) and leave everything for the user to commit.

End with `RESULT: SPRINT_PLANNED N <count>`.

## promise.md schema

```markdown
# Sprint N — <one-line goal>

Planned: <ISO-8601, e.g. 2026-06-14T17:30:00Z>
Waves: <count>   Issues: <count>   Budget: $<ceiling>

## Composition
| type | count |
|---|---|
| feature | … |
| improvement | … |
| qa | … |

## Issues
| # | type | title | files-owned | deps | wave |
|---|------|-------|-------------|------|------|
| 12 | feature | todos schema | db/schema/todos.ts | - | 1 |
| 18 | feature | todos API | api/todos/handlers.ts | 12 | 2 |

## Wave DAG
` ` `mermaid
<contents of dag.mmd>
` ` `

## Out of scope
- <3-5 bullets explicitly deferred, so scope creep can be pushed back on later>

## Definition of done (sprint)
- All sprint-N issues merged
- <the deployable / runnable outcome that proves the sprint landed>
```

Set a **`budget_usd` ceiling** now — the runner's per-issue cap
(`SPRINT_BUDGET_USD`, default $5) bounds each fire; this is the sprint-wide
guidance. Heuristic: `~$3 × issues`, +30% for re-fires.

## Boundaries

- **No in-flight inheritance.** Plan from zero open PRs. If PRs are open, close or
  carry them as fresh issues — never list a pre-existing PR as a sprint node.
- **You don't run anything.** Planning only. Executing is the `sprint` skill /
  `run-sprint.sh`, a separate post-approval step.
- **You don't draft a DoD the user can't verify.** A wrong DoD is worse than none —
  keep each line mechanical.

## Result line

End with exactly one of:
- `RESULT: SPRINT_PLANNED N <count>` — approved + issues created + artifacts written
- `RESULT: SPRINT_DRAFTED N <count>` — draft shown, waiting on approval
- `RESULT: IDLE` — nothing to plan (goal unclear; ask the user to sharpen it)
