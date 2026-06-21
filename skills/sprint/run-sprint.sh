#!/usr/bin/env bash
# run-sprint.sh — advance a planned sprint, one issue at a time, safely.
#
# No cluster, no Linear, no private infra. The only moving parts are:
#   • GitHub (issues = work items, PRs = delivery) via the `gh` CLI
#   • ONE local `claude` instance at a time (so it can rebase + merge with
#     nothing racing it — that serialization is what keeps work from being lost)
#   • this repo's .claude/sprints/sprint-N/  (the plan + a resumable run log)
#
# Each iteration: reconcile real state from GitHub, pick the next unblocked
# issue, hand it to Claude end-to-end (implement → PR → safe-merge), checkpoint,
# exit. `-n` caps how many issues one invocation does. Re-running is always safe:
# state is reconciled from GitHub every time, never assumed.
#
#   run-sprint.sh doctor              # preflight — are gh/claude/node/jq present + authed?
#   run-sprint.sh status              # show every issue's live verdict + next move (read-only)
#   run-sprint.sh --hitl              # Human In The Loop: implement + open a PR per issue, then STOP
#   run-sprint.sh --afk -n 10         # Away From Keyboard: implement + PR + safe-merge, up to 10, unattended
#   run-sprint.sh --sprint 3 --afk    # target sprint-3
#
# NO GIT ACTION HAPPENS WITHOUT AN EXPLICIT MODE. Pick --hitl or --afk; the runner
# asks if you omit both in a terminal and refuses in a non-interactive shell.
#   • --hitl (safe default) opens PRs for you to review — it NEVER merges or
#     touches your base branch.
#   • --afk is the only mode that merges, and only because you chose it.
#
# Flags: --hitl | --afk · -n N · --sprint N · --mute · --budget USD · --model M
# Env:   SPRINT_BUDGET_USD (per-issue $ cap, default 5) · SPRINT_MODEL ·
#        SPRINT_VOICE / SPRINT_VOICE_RATE (macOS `say`)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── colors (only when stdout is a tty) ──────────────────────────────────────
if [ -t 1 ]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; D=$'\033[2m'; Z=$'\033[0m'
else
  G=""; R=""; Y=""; B=""; D=""; Z=""
fi
rule() { printf '%s────────────────────────────────────────────────────────%s\n' "$D" "$Z"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$Z" "$1"; }
bad()  { printf '  %s✗%s %-9s — %s\n' "$R" "$Z" "$1" "$2"; }
note() { printf '  %s·%s %s\n' "$Y" "$Z" "$1"; }
die()  { printf '%ssprint:%s %s\n' "$R" "$Z" "$1" >&2; exit 1; }

# ── doctor ──────────────────────────────────────────────────────────────────
doctor() {
  local rc=1
  echo "sprint doctor: checking host tools"
  command -v gh      >/dev/null 2>&1 && ok gh           || { bad gh     "brew install gh";                       rc=0; }
  command -v claude  >/dev/null 2>&1 && ok claude       || { bad claude "npm i -g @anthropic-ai/claude-code";    rc=0; }
  command -v node    >/dev/null 2>&1 && ok node         || { bad node   "brew install node";                     rc=0; }
  command -v jq      >/dev/null 2>&1 && ok jq           || { bad jq     "brew install jq";                       rc=0; }
  command -v git     >/dev/null 2>&1 && ok git          || { bad git    "xcode-select --install";                rc=0; }
  command -v python3 >/dev/null 2>&1 && ok python3      || note "python3 missing — output won't be pretty/spoken (still runs)"
  command -v say     >/dev/null 2>&1 && ok "say (voice)"|| note "macOS \`say\` absent — voice narration off (fine on Linux/CI)"
  if command -v gh >/dev/null 2>&1; then
    if gh auth status >/dev/null 2>&1; then ok "gh authenticated"; else bad "gh auth" "run: gh auth login"; rc=0; fi
  fi
  echo
  [ "$rc" = 1 ] && { printf '%ssprint doctor: ready.%s\n' "$G" "$Z"; return 0; }
  printf '%ssprint doctor: fix the ✗ items above, then re-run.%s\n' "$R" "$Z" >&2
  return 1
}

# ── args ────────────────────────────────────────────────────────────────────
ACTION="run"; N=1; SPRINT=""; MODE=""
BUDGET="${SPRINT_BUDGET_USD:-5}"; MODEL="${SPRINT_MODEL:-}"
export SPRINT_MUTE="${SPRINT_MUTE:-0}"
case "${1:-}" in doctor|status) ACTION="$1"; shift;; esac
while [ $# -gt 0 ]; do
  case "$1" in
    -n)          N="${2:?-n needs a number}"; shift 2;;
    -n*)         N="${1#-n}"; shift;;
    --sprint)    SPRINT="${2:?--sprint needs a number}"; shift 2;;
    --sprint=*)  SPRINT="${1#--sprint=}"; shift;;
    --hitl)      MODE=hitl; shift;;
    --afk)       MODE=afk; shift;;
    --mute)      export SPRINT_MUTE=1; shift;;
    --budget)    BUDGET="${2:?}"; shift 2;;
    --budget=*)  BUDGET="${1#--budget=}"; shift;;
    --model)     MODEL="${2:?}"; shift 2;;
    --model=*)   MODEL="${1#--model=}"; shift;;
    -h|--help)   cat >&2 <<'EOF'
run-sprint.sh — advance a planned sprint one issue at a time.
  doctor          preflight checks (gh/claude/node/jq + gh auth)
  status          show the board, read-only — takes no git action
  --hitl          implement + open a PR per issue, then STOP (you review + merge)
  --afk           implement + PR + safe-merge, unattended (the ONLY mode that merges)
  -n N            advance up to N issues (default 1)
  --sprint N      target sprint-N (default: highest planned)
  --mute          no spoken narration   --budget USD  per-issue cap (default $5)
  --model M       claude model override
A mode (--hitl or --afk) is REQUIRED before any git action.
EOF
                 exit 0;;
    *)           die "unknown arg: $1 (try: run-sprint.sh --help)";;
  esac
done
case "$N" in ''|*[!0-9]*) die "-n must be a positive integer";; esac

[ "$ACTION" = doctor ] && { doctor; exit $?; }

# ── locate the active sprint ────────────────────────────────────────────────
command -v gh >/dev/null 2>&1 || die "gh CLI not found — run: bash run-sprint.sh doctor"
command -v jq >/dev/null 2>&1 || die "jq not found — run: bash run-sprint.sh doctor"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repo"
SPRINTS_DIR="$ROOT/.claude/sprints"

resolve_sprint() {
  if [ -n "$SPRINT" ]; then
    [ -f "$SPRINTS_DIR/sprint-$SPRINT/plan.json" ] || die "no plan.json for sprint-$SPRINT — plan it first (sprint-plan skill)"
    echo "$SPRINT"; return
  fi
  # highest-numbered sprint that still has a plan.json
  local n
  n="$(ls -1 "$SPRINTS_DIR" 2>/dev/null | sed -n 's/^sprint-\([0-9]\+\)$/\1/p' | sort -n | tail -1)"
  [ -n "$n" ] && [ -f "$SPRINTS_DIR/sprint-$n/plan.json" ] || die "no planned sprint found under .claude/sprints/ — run the sprint-plan skill first"
  echo "$n"
}
SPRINT="$(resolve_sprint)" || exit 1
PLAN="$SPRINTS_DIR/sprint-$SPRINT/plan.json"
RUNLOG="$SPRINTS_DIR/sprint-$SPRINT/runlog.jsonl"
BASE="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || echo main)"

# ── reconcile: classify every planned issue from live GitHub state ──────────
# Emits the plan enriched with {status, prstate, verdict, ready}. The labels lag
# reality, so a merged/open PR wins over a stale status label. ready = not done /
# blocked / in-flight AND every dependency is done.
reconcile() {
  local issues prs
  issues="$(gh issue list --label "sprint-$SPRINT" --state all --limit 300 --json number,labels 2>/dev/null || echo '[]')"
  prs="$(gh pr list --label "sprint-$SPRINT" --state all --limit 300 --json number,headRefName,state 2>/dev/null || echo '[]')"
  jq -n --slurpfile p "$PLAN" --argjson issues "$issues" --argjson prs "$prs" '
    ($issues | map({ key:(.number|tostring),
                     value:([.labels[].name | select(startswith("status:"))][0] // "status:none") }) | from_entries) as $st |
    ($prs    | map({ key:.headRefName, value:.state }) | from_entries) as $pr |
    ($p[0]
      | map(. + { status:  ($st[(.id|tostring)] // "status:none"),
                  prstate: ($pr["agent/issue-\(.id)"] // $pr["agent/\(.id)"] // "none") })
      | map(. + { verdict:
            (if .status=="status:done" or .prstate=="MERGED" then "done"
             elif .status=="status:needs-human"               then "blocked"
             elif .prstate=="OPEN"                             then "in-review"
             elif .status=="status:in-progress"               then "refire"
             else "ready" end) })
      | (map(select(.verdict=="done") | .id)) as $done
      | map(. + { ready: ((.verdict=="ready" or .verdict=="refire")
                          and (.deps | all(. as $d | $done | index($d) != null))) })
    )'
}

verdict_color() {
  case "$1" in
    done)       printf '%sdone%s'        "$G" "$Z";;
    in-review)  printf '%sin-review%s'   "$Y" "$Z";;
    blocked)    printf '%sblocked%s'     "$R" "$Z";;
    refire)     printf '%srefire%s'      "$Y" "$Z";;
    *)          printf 'ready';;
  esac
}

print_status() {
  local state="$1"
  rule
  printf '%ssprint-%s%s · base %s · %s\n' "$B" "$SPRINT" "$Z" "$BASE" "$(date -u +%H:%M:%SZ)"
  rule
  printf '%-6s %-6s %-12s %s\n' "#" "wave" "verdict" "title"
  echo "$state" | jq -r '.[] | [(.id|tostring), (.wave|tostring), .verdict, .title] | @tsv' \
    | while IFS=$'\t' read -r id wave v title; do
        printf '%-6s %-6s %-21b %s\n' "#$id" "$wave" "$(verdict_color "$v")" "$title"
      done
  local done total ready blocked
  done="$(echo "$state"    | jq '[.[]|select(.verdict=="done")]      | length')"
  total="$(echo "$state"   | jq 'length')"
  ready="$(echo "$state"   | jq '[.[]|select(.ready)]                | length')"
  blocked="$(echo "$state" | jq '[.[]|select(.verdict=="blocked")]   | length')"
  echo
  printf '  %s%s/%s done%s · %s ready to fire · %s blocked\n' "$B" "$done" "$total" "$Z" "$ready" "$blocked"
}

if [ "$ACTION" = status ]; then
  print_status "$(reconcile)"
  exit 0
fi

# ── execution mode — explicit, or no git happens ───────────────────────────
if [ -z "$MODE" ]; then
  if [ -t 0 ]; then
    rule
    printf '%sHow should I execute sprint-%s?%s\n' "$B" "$SPRINT" "$Z"
    printf '  %shitl%s  Human In The Loop — implement + open a PR per issue, then STOP. You review + merge. I never touch %s.\n' "$B" "$Z" "$BASE"
    printf '  %safk%s   Away From Keyboard — implement + PR + safely merge each into %s, unattended.\n' "$B" "$Z" "$BASE"
    printf 'choose [hitl/afk]: '; read -r m < /dev/tty || m=""
    case "$m" in afk|AFK) MODE=afk;; hitl|HITL) MODE=hitl;; *) die "no mode chosen — re-run with --hitl or --afk";; esac
  else
    die "no execution mode set. Re-run with --hitl (open PRs, you merge) or --afk (autonomous, I merge). I won't touch git without one."
  fi
fi
if [ "$MODE" = afk ]; then MERGE=1; CONFIRM=0; MERGE_MODE=merge; else MERGE=0; CONFIRM=1; MERGE_MODE=open-only; fi

# ── the loop: advance up to N issues, one at a time ─────────────────────────
mkdir -p "$(dirname "$RUNLOG")"
rule
printf '%srun-sprint · sprint-%s%s · %s%s%s mode · up to %s issue(s) · per-issue cap $%s\n' \
  "$B" "$SPRINT" "$Z" "$B" "$MODE" "$Z" "$N" "$BUDGET"
[ "$MODE" = hitl ] && printf '  %shitl: I open PRs and stop — you merge. Nothing lands on %s without you.%s\n' "$D" "$BASE" "$Z"
rule

done_count=0
while [ "$done_count" -lt "$N" ]; do
  state="$(reconcile)"
  remaining="$(echo "$state" | jq '[.[]|select(.verdict!="done")] | length')"
  if [ "$remaining" -eq 0 ]; then
    printf '\n%s✓ sprint-%s complete — every issue done.%s\n' "$G" "$SPRINT" "$Z"
    break
  fi
  pick="$(echo "$state" | jq -r '[.[]|select(.ready)] | sort_by(.wave, .id) | .[0] // empty | [(.id|tostring), (.wave|tostring), .title] | @tsv')"
  if [ -z "$pick" ]; then
    printf '\n%s· nothing ready this turn%s — %s issue(s) blocked or in review. Run `status` for the board.\n' "$Y" "$Z" "$remaining"
    break
  fi
  IFS=$'\t' read -r NUM WAVE TITLE <<EOF
$pick
EOF

  rule
  printf '%sissue #%s%s  (wave %s)  %s\n' "$B" "$NUM" "$Z" "$WAVE" "$TITLE"
  rule
  if [ "$CONFIRM" = 1 ] && [ -t 0 ]; then
    printf 'fire Claude on #%s? [Y/n] ' "$NUM"; read -r a < /dev/tty || a=""
    case "$a" in n|N|no) note "skipped #$NUM"; break;; esac
  fi

  gh issue edit "$NUM" --add-label status:in-progress --remove-label status:ready >/dev/null 2>&1 || true

  if [ "$MERGE" = 1 ]; then
    MERGE_STEPS="6. INTEGRATE SAFELY so nothing is lost — you are the ONLY agent on this repo, so the tree is yours: rebase your branch onto the latest origin/$BASE, resolve any conflict deliberately, re-run every DoD check, then \`gh pr merge --squash --delete-branch\`. If you cannot merge cleanly, STOP: leave the PR open, comment why, and \`gh issue edit $NUM --add-label status:needs-human --remove-label status:in-progress\`, then print RESULT: ISSUE_BLOCKED $NUM.
7. On a clean merge: \`gh issue edit $NUM --add-label status:done --remove-label status:in-progress\`."
  else
    MERGE_STEPS="6. Leave the PR OPEN for human review — do NOT merge. \`gh issue edit $NUM --add-label status:in-review --remove-label status:in-progress\`."
  fi
  PROMPT="You are completing exactly ONE GitHub issue in sprint-$SPRINT, running unattended. You are the only agent touching this repo right now.
1. Read it: \`gh issue view $NUM\`. Its \`## Plan\` is your scope; its \`## Definition of Done\` is the contract — every \`- [ ]\` line must end up genuinely satisfied (run the commands, don't assume).
2. Create branch agent/issue-$NUM off the latest origin/$BASE.
3. Implement ONLY what the Plan covers. Smallest correct diff; touch only the files the issue owns.
4. Verify every Definition-of-Done line yourself.
5. Open a PR: \`gh pr create --fill --base $BASE --label sprint-$SPRINT\`.
$MERGE_STEPS
End with exactly one line: \`RESULT: ISSUE_DONE $NUM\` or \`RESULT: ISSUE_BLOCKED $NUM <reason>\`."

  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  log="$SPRINTS_DIR/sprint-$SPRINT/issue-$NUM-$ts.jsonl"
  set +e
  claude -p "$PROMPT" \
    --dangerously-skip-permissions \
    ${MODEL:+--model "$MODEL"} \
    --max-budget-usd "$BUDGET" \
    --verbose --output-format stream-json \
    2>>"$log.err" \
    | tee "$log" \
    | { command -v python3 >/dev/null 2>&1 && python3 "$HERE/pretty.py" || cat; }
  set -e

  # outcome + cost from the stream's final result event
  final="$(grep '"type":"result"' "$log" 2>/dev/null | tail -1)"
  cost="$(printf '%s' "$final" | jq -r '.total_cost_usd // 0' 2>/dev/null || echo 0)"
  result="$(printf '%s' "$final" | jq -r '.result // ""' 2>/dev/null | grep -oE 'RESULT: ISSUE_(DONE|BLOCKED) [0-9]+' | head -1)"
  verdict="done"; printf '%s' "$result" | grep -q BLOCKED && verdict="blocked"
  printf '{"issue":%s,"verdict":"%s","cost_usd":%s,"merge":"%s","ts":"%s"}\n' \
    "$NUM" "$verdict" "${cost:-0}" "$MERGE_MODE" "$ts" >> "$RUNLOG"

  if [ "$verdict" = blocked ]; then
    printf '\n%s· #%s needs a human%s — stopping this run. Resolve it, then re-run.\n' "$Y" "$NUM" "$Z"
    break
  fi
  printf '%s✓ #%s done%s  (cost $%s)\n' "$G" "$NUM" "$Z" "${cost:-?}"
  done_count=$((done_count + 1))
done

# ── run summary ─────────────────────────────────────────────────────────────
echo
rule
state="$(reconcile)"
done_n="$(echo "$state" | jq '[.[]|select(.verdict=="done")]|length')"
total_n="$(echo "$state" | jq 'length')"
spent="$(jq -s 'map(.cost_usd // 0) | add // 0' "$RUNLOG" 2>/dev/null || echo 0)"
printf '%srun-sprint · advanced %s issue(s) this run · sprint-%s now %s/%s done · total spend $%.2f%s\n' \
  "$B" "$done_count" "$SPRINT" "$done_n" "$total_n" "$spent" "$Z"
if [ "$done_n" -lt "$total_n" ]; then
  printf '  next: %srun-sprint.sh -n %s%s  (or `status` for the board)\n' "$D" "$N" "$Z"
else
  printf '  %s✓ sprint done — close it out with the `sprint` skill.%s\n' "$G" "$Z"
fi
rule
