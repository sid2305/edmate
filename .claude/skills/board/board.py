#!/usr/bin/env python3
"""Edmate build board: show ready/blocked tasks and update status.

  board.py next                      ready tasks (deps done, no open decisions)
  board.py status                    counts + everything not todo/done
  board.py show <id>                 one task (or GATE)
  board.py set <id> <status> [--branch B] [--model M]   M = models used, e.g. "plan:sonnet build:opus review:sonnet"
  board.py decide <key> "<answer>"   record a human decision
"""
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("board.py needs PyYAML: python3 -m pip install --user pyyaml")

BOARD = Path(__file__).resolve().parents[3] / "docs" / "board" / "tasks.yaml"
STATUSES = {"todo", "planning", "running", "review", "blocked", "done"}


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
        flag = {"risky": "  [risky: you approve]", "expert": "  [expert sign-off]"}.get(t.get("risk"), "")
        print(f"  {t['id']:>5}  {t['milestone']:<4} {t['title']}{flag}")
    if not ready:
        print("  (none)")
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
        t["status"] = args[1]
        if "--branch" in args:
            t["branch"] = args[args.index("--branch") + 1]
        if "--model" in args:
            t["model"] = args[args.index("--model") + 1]
        save(header, board)
        print(f"{args[0]} -> {args[1]}")
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
