# Example: a Kubernetes pod-monitoring dashboard

A worked sprint plan — 13 interconnected issues that build a live pod-monitoring UI,
from k8s API client up to an end-to-end test. See the artifacts before running anything.

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

- **Three independent roots** (wave 1): the k8s client, the metrics store, and the
  dashboard shell have no prerequisites — all startable at once.
- **The backend fans out before the UI converges.** Collector → APIs → tables/charts;
  every UI card waits only on the exact API it calls.
- **`#13` (the e2e test) sits alone in the last wave**, gated on the list, the detail
  drawer, and the live indicators all existing.
