# Example: an Ethereum blockchain explorer

A worked sprint plan — 16 interconnected issues that build an Etherscan-style explorer,
from JSON-RPC client through indexers, APIs, and UI pages to an end-to-end test.

| File | What it is |
|------|------------|
| `issues.json` | the input — issues with `deps` + `files` |
| `plan.json` | the machine-readable wave schedule the runner reads |
| `dag.mmd` / `dag.html` | the rendered graph — open `dag.html` in a browser, or see the Mermaid in `promise.md` |
| `promise.md` | the human-readable sprint contract |

Regenerate the graph + plan:

```bash
node ../../skills/sprint-plan/wave-sort.mjs issues.json --out . --max-wave-width 5
```

Worth noticing:

- **A clean layered shape.** Schemas + RPC client (wave 1) → indexers (wave 2) →
  APIs (wave 3) → UI + search (waves 4-5) → e2e (wave 6). The DAG makes the
  architecture legible at a glance.
- **`#11` (unified search) converges** three APIs before the search bar UI can use it.
- **Six waves from 16 issues** — depth comes from genuine data dependencies (you can't
  serve blocks before you've indexed them), not from over-declared blocking.
