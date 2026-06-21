#!/usr/bin/env python3
# Render `claude -p --output-format stream-json` into readable terminal lines for
# run-sprint.sh, and (on macOS) speak the agent's prose aloud via `say`.
# Best-effort: an unknown event shape is skipped, never fatal.
#
#   mute:   SPRINT_MUTE=1            pick a voice:  SPRINT_VOICE="Samantha"
#   speed:  SPRINT_VOICE_RATE=210    (words/min; unset = say's default)
#
# Voice is a no-op anywhere `say` is absent (Linux/CI), so the renderer is
# portable; only the spoken layer is macOS-only.
import sys, json, os, re, shutil, subprocess

_SAY = shutil.which("say")
_MUTE = os.environ.get("SPRINT_MUTE") == "1"
_VOICE = os.environ.get("SPRINT_VOICE", "")
_RATE = os.environ.get("SPRINT_VOICE_RATE", "")

DIM = "\033[2m"; CYAN = "\033[36m"; RESET = "\033[0m"
_tty = sys.stdout.isatty()
def c(code, s):
    return f"{code}{s}{RESET}" if _tty else s


def speak(text):
    # Strip markdown to plain prose, then speak detached. A new message kills the
    # previous `say` so a fast loop never overlaps voices.
    if not _SAY or _MUTE:
        return
    clean = re.sub(r"```.*?```", " ", text, flags=re.S)
    clean = re.sub(r"`[^`]*`", " ", clean)
    clean = re.sub(r"https?://\S+", " ", clean)
    clean = re.sub(r"[#*_>`|~-]+", " ", clean)
    clean = re.sub(r"\s+", " ", clean).strip()
    if not clean:
        return
    if len(clean) > 1200:
        clean = clean[:1200] + " ..."
    subprocess.run(["pkill", "-x", "say"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.Popen(
        [_SAY]
        + (["-v", _VOICE] if _VOICE else [])
        + (["-r", _RATE] if _RATE else [])
        + [clean],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def tool_detail(name, inp):
    # Surface WHAT a tool acted on — the command for Bash, the path for file tools.
    if not isinstance(inp, dict):
        return ""
    if name == "Bash":
        d = inp.get("command", "")
    elif name in ("Read", "Write", "Edit", "MultiEdit", "NotebookEdit"):
        d = inp.get("file_path") or inp.get("notebook_path") or ""
    else:
        d = ""
    d = " ".join(str(d).split())
    return d[:200] + " …" if len(d) > 200 else d


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        e = json.loads(line)
    except Exception:
        continue
    t = e.get("type")
    if t == "assistant":
        for b in e.get("message", {}).get("content", []):
            kind = b.get("type")
            if kind == "text" and b.get("text"):
                print(b["text"], flush=True)
                speak(b["text"])
            elif kind == "tool_use":
                name = b.get("name", "tool")
                detail = tool_detail(name, b.get("input"))
                print(c(CYAN, f"  ⚡ {name}") + (c(DIM, f"  {detail}") if detail else ""), flush=True)
    elif t == "result":
        cost = e.get("total_cost_usd")
        sub = e.get("subtype", "")
        tail = f"  ${cost}" if cost is not None else ""
        print(c(DIM, f"── result: {sub}{tail}"), flush=True)

sys.stdout.flush()
