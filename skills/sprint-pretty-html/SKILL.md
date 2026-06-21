---
name: sprint-pretty-html
description: Turn a raw sprint plan (HTML, markdown, Slack dump, Linear export) into a self-contained interactive dependency-DAG HTML — tickets as cards colored by owner, arrows for dependencies, columns as readiness waves (wave 1 = startable now), multi-select person filter with ticket counts, hover-to-trace chains. Use when the user wants to visualize how sprint tickets are interrelated, says "pretty sprint", "sprint DAG", "dependency graph for this sprint", or hands over a sprint plan asking how work chains together.
---

# sprint-pretty-html

## Objective

Produce ONE self-contained `.html` file that renders a sprint as an interactive dependency DAG in the dark "mission control" aesthetic (Instrument Serif + IBM Plex Mono, blueprint dot-grid, teal accent). All interactivity (filters, chain tracing, counts) is already implemented in the bundled template — your job is extracting a correct graph model from the raw sprint and filling in the data arrays.

## Output

Write `sprint-dag-<cycle-or-date>.html` (e.g. `sprint-dag-c146.html`) into the current working directory. `assets/template.html` is read-only source material — never edit it in place.

## Workflow

**1. Extract the model from the raw sprint.** Whatever the input format, pull out:

- **People** — every assignee. Also note per-person priority pill counts if present (used to verify your totals later).
- **Tickets** — title, tracker id (or `NEW`), priority (P0/P1/P2), owner.
- **Explicit dependencies** — a "Dependencies" callout, or per-ticket markers like "blocked by X", "→ unblocks Y", "depends on Z". These become SOLID edges.
- **Implied links** — sequenced phases (days 1–3 → 3–6 → 6–14), API-before-frontend clusters, "feeds into", external blockers ("blocked on design"), mentoring/support. These become DASHED edges, with a short label where it helps ("awaiting design", "sequenced", "supports").
- **Prerequisites that are already done** — work landed in a previous cycle that this sprint's tickets build on. These become ghost cards in the "Done · External" column, not sprint tickets.

When >5 similar tickets all feed one consumer (e.g. "10 new alert rules" → a config UI), collapse them into ONE aggregate ghost node (`GROUP` pill) rather than drawing 10 edges. Record which people the aggregate stands for (template: `AGG_MEMBERS`).

**2. Compute waves.** Column = readiness, left to right:

- Col 0 — `Done · External`: landed prior-cycle work (ghost, `C144`-style pill) and pending external blockers (ghost, `EXT` pill, e.g. a designer's mock).
- Wave 1 — no unfinished prerequisite. Depending only on LANDED work still counts as wave 1; depending on a PENDING external blocker does not.
- Wave N — `1 + max(wave of non-done predecessors)`.

Most sprints fit in 3 waves. If a node lands in wave 4+, double-check the edge really exists.

**3. Lay out rows.** Group chains into horizontal thematic bands (one band per storyline: "Sanctions", "Case Management", …) and hand-assign `y` per node. Rules of thumb, given 272px-wide × ~78px-tall cards:

- ≥100px vertical spacing between cards in the same column, ≥120px between bands.
- An edge that skips a column must not pass through a card: route it through a vertical gap, or nudge the source/target `y` until the bezier clears (the template's curves bow horizontally — at mid-span the path sits roughly between the two endpoint heights).
- Keep a chain's nodes near the same `y` so its arrows read as a horizontal storyline.

**4. Fill the template.** Copy `assets/template.html` to the output path, keep ALL CSS/JS, and replace only the data:

| What | Where |
|---|---|
| `PEOPLE` | owner → color map; reuse the palette, keep ghost colors (`C144` slate, external red, `Team` neutral) |
| `NODES` | `[id, col, y, pri, title, sub, owner, ghost?]` — pri ∈ `P0 P1 P2 C144 EXT SET`; `SET` renders as `GROUP` |
| `EDGES` | `[from, to, 'hard'|'soft', label?]` |
| `BANDS` | `[y, label]` per thematic band |
| `AGG_MEMBERS` | aggregate node id → people it stands for |
| `REST` | per-person list of tickets with NO edges (`[title, id, pri]`) — every sprint ticket must appear exactly once, in `NODES` or `REST` |
| Header, `.statline`, canvas `height` | cycle name, dates, issue/dependency counts, P0→P0 critical chains; height ≈ max(y) + 140 |

Filter chips, ticket-count badges, wave headers, hover chain-tracing, and band labels all derive from the arrays — do not touch the JS logic.

**5. Verify.** Counts per person (non-ghost `NODES` + `REST`) must reconcile with the source plan's per-person pills. Then `open` the file and confirm: arrows don't cut through cards, every band label sits beside its band, filtering a heavy-load person looks right.

## Design language

Dark ink `#0b0f14`, dotted blueprint grid, teal `#2dd4bf` accent. Cards: `#141b24`, 3px left border in owner color, priority pill + tracker id + owner dot. Solid teal edges = explicit dependencies; dashed grey = implied/sequenced/support. Ghost cards are dashed-border and muted. Display face Instrument Serif (italic) for the title, IBM Plex Mono everywhere else (Google Fonts link; degrades to monospace offline). Owner palette in the template — distinct hues per person, consistent across graph, filter chips, and the off-path list.

## Sharp edges

- Never invent dependencies: solid edges only for stated ones. Inferred edges are dashed, and call them out as assumptions when presenting the result.
- A ticket in an aggregate node must NOT also get its own node; it stays in `REST` (the aggregate is a visual stand-in, counts come out right because ghosts are excluded).
- `Date`/emoji free; no external JS — the only network fetch is the fonts link.
