#!/usr/bin/env python3
"""Edmate build board: show ready/blocked tasks and update status.

  board.py next                      ready tasks (deps done, no open decisions)
  board.py status                    counts + everything not todo/done
  board.py show <id>                 one task (or GATE)
  board.py set <id> <status> [--branch B] [--model M] [--metrics <file.json>]
                                     M = models used, e.g. "plan:sonnet build:opus review:sonnet"
                                     `done` needs docs/tasks/<id>/handoff.md (merged) with a
                                     `## Decisions` section whose every `Decided:` line is in
                                     docs/decisions/log.md word for word (or the section says None)
                                     --metrics merges a JSON file's map (numbers/short strings
                                     only) into the task's `metrics` key, replacing any existing
                                     map (safe to run twice)
  board.py decide <key> "<answer>"   record a human decision
  board.py metrics [--last N] [--by risk|milestone]   table of done tasks with a `metrics` map,
                                     grouped by --by (default risk) and by the task's `build:`
                                     model, for the last N such tasks in board order (all if N
                                     omitted)
"""
import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("board.py needs PyYAML: python3 -m pip install --user pyyaml")

ROOT = Path(__file__).resolve().parents[3]
BOARD = ROOT / "docs" / "board" / "tasks.yaml"
LOG = ROOT / "docs" / "decisions" / "log.md"
STATUSES = {"todo", "planning", "running", "review", "blocked", "done"}
# A "Decided:" line, bare or bullet-prefixed ("- Decided: ..."), matched the same way as a
# "Status:" line (see merge_gate.py's STATUS_LINE): closeout.py copies handoff entries into
# docs/decisions/log.md verbatim, so this only needs to recognize the line, not normalize it.
DECIDED_LINE = re.compile(r"^[ \t]*[-*\d.]*[ \t]*Decided:")


def load():
    text = BOARD.read_text()
    header = "".join(l for l in text.splitlines(keepends=True) if l.startswith("#"))
    return header, yaml.safe_load(text)


def save(header, board):
    BOARD.write_text(header + yaml.safe_dump(board, sort_keys=False, allow_unicode=True, width=200))


def key(tid):
    return tuple(int(p) for p in tid.split(".")) if re.fullmatch(r"\d+\.\d+", tid) else (999,)


def dep_done(dep, tasks, gate):
    if dep == "GATE":
        return gate["status"] == "done"
    if dep.startswith("M"):
        return all(t["status"] == "done" for t in tasks if t["milestone"] == dep)
    return any(t["id"] == dep and t["status"] == "done" for t in tasks)


def open_decisions(item, decisions):
    return [d for d in item.get("needs_decision", []) if decisions[d]["status"] != "decided"]


def find(board, tid):
    if tid.upper() == "GATE":
        return board["gate"]
    for t in board["tasks"]:
        if t["id"] == tid:
            return t
    sys.exit(f"no task {tid}")


def norm(line):
    return " ".join(line.split())


def done_problems(tid):
    """Why task `tid` may not be set to done yet (empty list = it may)."""
    handoff = ROOT / "docs" / "tasks" / tid / "handoff.md"
    if not handoff.exists():
        return [f"{handoff.relative_to(ROOT)} is not in the working tree: merge first"]
    m = re.search(r"^##\s+Decisions\b.*$", handoff.read_text(), re.M)
    if not m:
        return ["handoff.md has no '## Decisions' section"]
    body = handoff.read_text()[m.end():]
    nxt = re.search(r"^##\s", body, re.M)
    body = body[: nxt.start()] if nxt else body
    if norm(body).rstrip(".").lower() == "none":
        return []
    decided = [norm(l) for l in body.splitlines() if DECIDED_LINE.match(l)]
    if not decided:
        return ["handoff ## Decisions has entries but no 'Decided:' lines (or write None)"]
    logged = {norm(l) for l in (LOG.read_text() if LOG.exists() else "").splitlines()}
    return [f"not in docs/decisions/log.md word for word: {d}" for d in decided if d not in logged]


def cmd_next(board):
    tasks, gate, decisions = board["tasks"], board["gate"], board["decisions"]
    items = tasks + [dict(gate, milestone="GATE")]
    ready, waiting = [], []
    for t in items:
        if t["status"] != "todo" or not all(dep_done(d, tasks, gate) for d in t["deps"]):
            continue
        (waiting if open_decisions(t, decisions) else ready).append(t)
    print("READY")
    for t in sorted(ready, key=lambda t: key(t["id"])):
        flag = {"risky": "  [risky: required reviewers + risk: high]", "expert": "  [expert sign-off]"}.get(t.get("risk"), "")
        print(f"  {t['id']:>5}  {t['milestone']:<4} {t['title']}{flag}")
    if not ready:
        print("  (none)")
    for t in sorted(tasks, key=lambda t: key(t["id"])):
        if t["status"] == "planning" and not (ROOT / "docs" / "tasks" / t["id"] / "plan.md").exists():
            print(f"WARNING  {t['id']} is in planning but docs/tasks/{t['id']}/plan.md does not exist")
    if waiting:
        print("DEPS DONE, WAITING ON A HUMAN DECISION")
        for t in sorted(waiting, key=lambda t: key(t["id"])):
            ds = ", ".join(f"{d}: {decisions[d]['question']}" for d in open_decisions(t, decisions))
            print(f"  {t['id']:>5}  {t['title']}  <- {ds}")


def cmd_status(board):
    tasks = board["tasks"]
    counts = {s: sum(t["status"] == s for t in tasks) for s in sorted(STATUSES)}
    print("  ".join(f"{s}={n}" for s, n in counts.items()), f" gate={board['gate']['status']}")
    for t in sorted(tasks, key=lambda t: key(t["id"])):
        if t["status"] not in ("todo", "done"):
            print(f"  {t['id']:>5}  {t['status']:<8} {t.get('branch') or '-':<36} {t.get('model') or '-':<28} {t['title'][:60]}")
    pending = [k for k, d in board["decisions"].items() if d["status"] != "decided"]
    print("open decisions:", ", ".join(pending) or "none")


def build_model(model_str):
    """The `build:` token out of a `model` string like "plan:sonnet build:opus review:sonnet",
    or "unknown" if there is none."""
    m = re.search(r"\bbuild:(\S+)", model_str or "")
    return m.group(1) if m else "unknown"


def cmd_metrics(board, args):
    by = "risk"
    if "--by" in args:
        by = args[args.index("--by") + 1]
        if by not in ("risk", "milestone"):
            sys.exit("--by must be one of 'risk', 'milestone'")
    last = None
    if "--last" in args:
        last = int(args[args.index("--last") + 1])

    tasks = [t for t in board["tasks"] if t.get("status") == "done" and t.get("metrics")]
    if last is not None:
        tasks = tasks[-last:] if last > 0 else []

    groups = {}
    for t in tasks:
        key_val = (t.get("risk") or "none") if by == "risk" else t["milestone"]
        gkey = (str(key_val), build_model(t.get("model")))
        g = groups.setdefault(gkey, {"n": 0, "tool_calls": 0, "tokens_in": 0, "tokens_out": 0,
                                      "wall_time_seconds": 0, "fix_rounds": 0, "findings_total": 0})
        met = t["metrics"]
        g["n"] += 1
        g["tool_calls"] += met.get("tool_calls", 0)
        g["tokens_in"] += met.get("tokens_in", 0)
        g["tokens_out"] += met.get("tokens_out", 0)
        g["wall_time_seconds"] += met.get("wall_time_seconds", 0)
        g["fix_rounds"] += met.get("fix_rounds", 0)
        g["findings_total"] += (met.get("findings") or {}).get("total", 0)

    if not groups:
        print("no done tasks with a metrics map")
        return

    print(f"{by:<10} {'model':<16} {'n':>3} {'tool_calls(avg)':>16} {'tokens(total)':>14} {'wall_s(total)':>14} {'fix_rounds':>10} {'findings':>8}")
    for (key_val, model), g in sorted(groups.items()):
        avg_tool_calls = g["tool_calls"] / g["n"]
        total_tokens = g["tokens_in"] + g["tokens_out"]
        print(f"{key_val:<10} {model:<16} {g['n']:>3} {avg_tool_calls:>16.1f} {total_tokens:>14} {g['wall_time_seconds']:>14} {g['fix_rounds']:>10} {g['findings_total']:>8}")


def main(argv):
    if not argv:
        sys.exit(__doc__)
    header, board = load()
    cmd, args = argv[0], argv[1:]
    if cmd == "next":
        cmd_next(board)
    elif cmd == "status":
        cmd_status(board)
    elif cmd == "show" and args:
        print(yaml.safe_dump(find(board, args[0]), sort_keys=False, allow_unicode=True, width=200))
    elif cmd == "set" and len(args) >= 2:
        if args[1] not in STATUSES:
            sys.exit(f"status must be one of {sorted(STATUSES)}")
        t = find(board, args[0])
        if args[1] == "done" and args[0].upper() != "GATE":
            problems = done_problems(args[0])
            if problems:
                print(f"refusing {args[0]} -> done (board unchanged):", file=sys.stderr)
                for p in problems:
                    print(f"  {p}", file=sys.stderr)
                sys.exit(1)
        t["status"] = args[1]
        if "--branch" in args:
            t["branch"] = args[args.index("--branch") + 1]
        if "--model" in args:
            t["model"] = args[args.index("--model") + 1]
        if "--metrics" in args:
            mpath = Path(args[args.index("--metrics") + 1])
            t["metrics"] = json.loads(mpath.read_text())
        save(header, board)
        print(f"{args[0]} -> {args[1]}")
    elif cmd == "metrics":
        cmd_metrics(board, args)
    elif cmd == "decide" and len(args) == 2:
        if args[0] not in board["decisions"]:
            sys.exit(f"unknown decision; one of {list(board['decisions'])}")
        board["decisions"][args[0]].update(status="decided", answer=args[1])
        save(header, board)
        print(f"decision {args[0]} = {args[1]}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
