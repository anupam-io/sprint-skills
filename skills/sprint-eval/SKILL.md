---
name: sprint-eval
description: Rate a sprint plan by convening a panel of 3 local expert agents (engineering program management, operations-research scheduling, agentic task planning), each scoring the same 3 fixed criteria 1-10, then synthesizing a score table, consensus risks, and concrete fixes. Use when the user wants a sprint plan rated/evaluated/stress-tested, asks "how good is this sprint plan", or hands over a sprint doc asking for a quality verdict. Input is a sprint plan in any format (HTML, markdown, Slack dump, Linear export).
---

# Sprint Eval

Panel-based sprint plan rating. Three independent expert agents read the SAME plan and score the SAME criteria, so scores are comparable and agreement is signal: anything all three flag independently is almost certainly real.

## Input

A sprint plan: a file path or pasted text. If it's a file, pass the path to the agents and let each read it themselves (independent reads, no shared summary — don't pre-digest the plan for them, that would correlate their errors).

## Fixed criteria (same for every rater)

1. **Dependency & sequencing health** — critical path soundness, blocker surfacing/ordering, cross-person handoffs.
2. **Capacity realism & load balance** — per-person allocation vs the sprint horizon, onboarding load, P0 distribution.
3. **Goal alignment & scope discipline** — must-ship items map to stated targets; cancel/backlog/carry-over hygiene; clarity.

## The panel

Spawn all 3 in ONE message (parallel `Agent` calls, general-purpose). Each gets a distinct lens so they catch different failure modes:

| Rater | Persona | Lens emphasis |
|---|---|---|
| EPM | Veteran engineering program manager, 15y of 2-week cycles | handoffs, single points of failure, priority inversion |
| OR | Operations-research scheduling specialist (CPM/PERT, resource-constrained scheduling) | chain depth vs horizon, slack, utilization vs variance buffer, negative-slack chains |
| Agentic | Expert in agentic task planning — crisp specs, explicit interfaces, verifiable done-conditions | hidden couplings, unspecified API contracts, vague acceptance criteria, TBD items |

Every prompt must include, verbatim in spirit:
- the 3 fixed criteria, phrased through that rater's lens;
- "Return raw data only (your final message is consumed by a program, not a human): for each criterion give `score: N/10` plus 2-3 sentences of justification grounded in specifics from the plan, then one line `top risk:` with the single biggest thing you'd flag.";
- "Be a tough but fair grader; don't inflate."

Domain swap: if the sprint is clearly outside software (e.g. content, ops), swap the EPM persona for the matching domain planner; keep OR and Agentic — they're domain-agnostic.

## Synthesis (your final answer)

Lead with the verdict: overall average to one decimal, e.g. "≈ 4.7/10".

1. **Score table** — criterion rows × rater columns + per-criterion average.
2. **Unanimous findings first** — anything 2-3 raters flagged independently, named as such ("all three named X"). The intersection is the headline, not your own opinion.
3. **Lens-unique catches** — findings only one expert saw (typically the Agentic rater's interface/spec gaps), attributed to the lens.
4. **What scored well** — 2-4 genuine strengths; a panel that only criticizes is uncalibrated.
5. **Top 2 fixes** — concrete, smallest-change recommendations ("shed ~4 of X's items to Y", "ticket the 7 missing integrations or rewrite the target"), not generic advice.

Do not average away disagreement: if raters split by ≥3 points on a criterion, say why (usually the OR rater counting days where others pattern-matched).

## Sharp edges

- Scores come from the agents, never from you; if an agent fails or returns no scores, rerun it rather than filling in numbers.
- Keep raters blind to each other — no sharing of outputs between them, no "rater 2 said...".
- Ground every claim in the plan's specifics (names, ticket ids, counts). A finding that can't cite the plan gets dropped from the synthesis.
