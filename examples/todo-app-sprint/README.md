# Example: a todo app with auth

A worked sprint plan, so you can see the artifacts before running anything.

| File | What it is |
|------|------------|
| `issues.json` | the input — 10 issues with `deps` + `files` (what `sprint-plan` drafts before creating anything) |
| `plan.json` | the machine-readable wave schedule the runner reads (`run-sprint.sh`) |
| `dag.mmd` / `dag.html` | the rendered graph — open `dag.html` in a browser, or see the Mermaid in `promise.md` |
| `promise.md` | the human-readable sprint contract |

Regenerate the graph + plan from the input yourself:

```bash
node ../../skills/sprint-plan/wave-sort.mjs issues.json --out . --max-wave-width 4
```

Things worth noticing:

- **Waves are readiness layers.** Wave 1 (`#1`, `#2`) needs nothing — startable
  immediately. Each later issue waits only on what it genuinely imports.
- **`#9` shares a file with `#4`** (`api/todos/handlers.ts`). Even if their
  dependencies allowed the same wave, the sorter pushes them apart so two runs
  never edit one file — one file, one owner, per wave.
- **`#10` converges** on `#6` and `#8` — the end-to-end test can't run until both
  the UI and the login page exist.
