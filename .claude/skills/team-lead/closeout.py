#!/usr/bin/env python3
"""Close out a merged Edmate task in one command.

  closeout.py <task-id> [--remote]

Run this once a task's PR has merged to main (so docs/tasks/<id>/handoff.md is in the working
tree). It:

  1. appends the handoff's `## Decisions` entries to docs/decisions/log.md, word for word
     (skips entries already logged by heading -- safe to run twice);
  2. runs `board.py set <id> done` (which itself refuses unless every `Decided:` line is logged);
  3. removes the task's git worktree, if one still exists for its board branch, and deletes the
     local branch -- but only if the branch is fully merged into main. An unmerged branch is left
     alone with a clear message (mirrors board.py's refuse-without-decisions check); pass
     `--remote` to also delete the branch on origin once it is removed locally.

Exit codes: 0 = closed out (or safely partial, e.g. branch left because it isn't merged yet),
1 = couldn't even log decisions / mark the board done (board.py's own refusal reasons print as-is).
"""
import os
import re
import subprocess
import sys
from pathlib import Path

DECISIONS_HEADING = re.compile(r"^##\s+Decisions\b.*$", re.M)
ENTRY_HEADING = re.compile(r"^###\s", re.M)
NEXT_H2 = re.compile(r"^##\s", re.M)
LOG_SEP = re.compile(r"\n-{3,}\n")


def repo_root():
    """The repo root: $CLAUDE_PROJECT_DIR if set, else `git rev-parse --show-toplevel` run from
    this script's own location (works however/wherever closeout.py is invoked from)."""
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env:
        return Path(env)
    r = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=Path(__file__).resolve().parent,
                        capture_output=True, text=True)
    if r.returncode == 0 and r.stdout.strip():
        return Path(r.stdout.strip())
    return Path(__file__).resolve().parents[3]


def sh(root, *cmd):
    r = subprocess.run(cmd, cwd=root, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


def norm(line):
    return " ".join(line.split())


def decisions_body(handoff_text):
    """The `## Decisions` section body, or None if there is no such section."""
    m = DECISIONS_HEADING.search(handoff_text or "")
    if not m:
        return None
    rest = handoff_text[m.end():]
    nxt = NEXT_H2.search(rest)
    return rest[: nxt.start()] if nxt else rest


def decision_entries(body):
    """[(heading, full_entry_text)] for every `### ` entry in a Decisions body."""
    parts = re.split(r"^(?=###\s)", body or "", flags=re.M)
    return [(norm(p.splitlines()[0]), p.strip("\n")) for p in parts if p.startswith("###")]


def split_log(text):
    blocks = LOG_SEP.split(text or "# Edmate decision log\n")
    return blocks[0].rstrip("\n"), [b.strip("\n") for b in blocks[1:]]


def append_decisions(log_path, handoff_path):
    """Append `handoff_path`'s `## Decisions` entries to `log_path`, skipping any entry already
    there (matched by its heading). Returns the number of entries appended."""
    handoff_text = handoff_path.read_text() if handoff_path.exists() else ""
    body = decisions_body(handoff_text)
    if body is None or norm(body).rstrip(".").lower() == "none":
        return 0
    new_entries = decision_entries(body)
    if not new_entries:
        return 0
    log_text = log_path.read_text() if log_path.exists() else "# Edmate decision log\n"
    header, existing = split_log(log_text)
    existing_headings = {norm(e.splitlines()[0]) for e in existing if e.startswith("###")}
    to_add = [text for heading, text in new_entries if heading not in existing_headings]
    if not to_add:
        return 0
    all_entries = to_add + existing
    log_path.write_text(header + "\n\n---\n\n" + "\n\n---\n\n".join(all_entries) + "\n")
    return len(to_add)


def worktree_for_branch(root, branch):
    code, out = sh(root, "git", "worktree", "list", "--porcelain")
    if code:
        return None
    path, is_match = None, False
    for line in out.splitlines():
        if line.startswith("worktree "):
            path = line[len("worktree "):]
            is_match = False
        elif line == f"branch refs/heads/{branch}":
            is_match = True
        elif line == "" and is_match:
            return path
    return path if is_match else None


def branch_is_merged(root, branch):
    """True if `branch` is fully merged into main -- i.e. merging it now would change nothing.

    Edmate merges every PR with `gh pr merge --squash`, so the branch tip is never an ancestor
    of main and a plain `git branch --merged` check always says "not merged". Keep that ancestry
    check as a fast path (true merges and fast-forwards), but fall back to comparing the tree a
    merge of `branch` into main would produce against main's own tree: if they're equal, the
    branch's content is already on main (a squash merge, or any other history-breaking merge),
    so there's nothing left to merge and the branch is safe to delete. A branch with new,
    unmerged commits still produces a different tree and is correctly refused.
    """
    code, out = sh(root, "git", "branch", "--merged", "main", "--list", branch)
    if code == 0 and out.strip():
        return True
    code, tree = sh(root, "git", "merge-tree", "--write-tree", "main", branch)
    if code != 0:
        return False
    code, main_tree = sh(root, "git", "rev-parse", "main^{tree}")
    if code != 0:
        return False
    return tree.strip() == main_tree.strip()


def main(argv):
    if not argv:
        sys.exit(__doc__)
    task_id = argv[0]
    if "/" in task_id or "\\" in task_id or ".." in task_id:
        print(f"bad task id {task_id!r}: must not contain '/', '\\\\' or '..'")
        return 1
    remote = "--remote" in argv[1:]
    root = repo_root()

    handoff = root / "docs" / "tasks" / task_id / "handoff.md"
    log = root / "docs" / "decisions" / "log.md"
    added = append_decisions(log, handoff)

    code, out = sh(root, "python3", str(root / ".claude" / "skills" / "board" / "board.py"), "set", task_id, "done")
    print(out)
    if code:
        return code

    code, branch = sh(root, "python3", str(root / ".claude" / "skills" / "board" / "board.py"), "show", task_id)
    m = re.search(r"^branch:\s*(\S+)", branch, re.M) if code == 0 else None
    branch_name = m.group(1).strip("'\"") if m and m.group(1) != "null" else None

    if branch_name:
        wt = worktree_for_branch(root, branch_name)
        if wt:
            code, out = sh(root, "git", "worktree", "remove", wt)
            if code:
                print(f"could not remove worktree {wt}: {out}")
        if branch_is_merged(root, branch_name):
            # -D, not -d: branch_is_merged() already verified the branch's content is fully on
            # main (ancestry or tree-equality). Plain `git branch -d` only knows the ancestry
            # check and refuses every squash-merged branch, which is how every Edmate PR merges.
            code, out = sh(root, "git", "branch", "-D", branch_name)
            if code:
                print(f"could not delete branch {branch_name}: {out}")
            elif remote:
                sh(root, "git", "push", "origin", "--delete", branch_name)
        else:
            print(f"branch {branch_name} has unmerged commits: left in place (delete it yourself once it is merged)")

    print(f"{task_id} closed out: {added} decision(s) appended, board set to done.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
