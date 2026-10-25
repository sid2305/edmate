#!/usr/bin/env python3
"""Close out a merged Edmate task in one command.

  closeout.py <task-id> [--remote]

Run this once a task's PR has merged to main (so docs/tasks/<id>/handoff.md is in the working
tree). It:

  1. appends the handoff's `## Decisions` entries to docs/decisions/log.md, word for word
     (skips entries already logged by heading -- safe to run twice);
  2. prints a one-line reminder to add a docs/lessons.md entry when the handoff has a
     `## Fix round` heading or a just-appended decision is "decided by you" (never blocks);
  3. runs `board.py set <id> done` (which itself refuses unless every `Decided:` line is logged);
  4. regenerates docs/decisions/digest.md with `board.py digest`, so a stale digest never fails
     the RealRepo freshness test in CI for a later PR -- if that fails, prints the reason and
     still does step 5, but the command exits non-zero so the lead sees it and runs
     `board.py digest` by hand;
  5. removes the task's git worktree, if one still exists for its board branch, and deletes the
     local branch -- but only if the branch is fully merged into main. An unmerged branch is left
     alone with a clear message (mirrors board.py's refuse-without-decisions check); pass
     `--remote` to also delete the branch on origin once it is removed locally.

Exit codes: 0 = closed out (or safely partial, e.g. branch left because it isn't merged yet),
1 = couldn't even log decisions / mark the board done (board.py's own refusal reasons print as-is),
or the board was set done but `board.py digest` then failed (step 4).
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import metrics  # noqa: E402

DECISIONS_HEADING = re.compile(r"^##\s+Decisions\b.*$", re.M)
ENTRY_HEADING = re.compile(r"^###\s", re.M)
NEXT_H2 = re.compile(r"^##\s", re.M)
LOG_SEP = re.compile(r"\n-{3,}\n")
FIX_ROUND = re.compile(r"^## Fix round\b", re.M)


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


def append_decisions(log_path, handoff_path, handoff_text=None):
    """Append `handoff_path`'s `## Decisions` entries to `log_path`, skipping any entry already
    there (matched by its heading). Returns the number of entries appended."""
    return len(append_decision_entries(log_path, handoff_path, handoff_text))


def append_decision_entries(log_path, handoff_path, handoff_text=None):
    """Like `append_decisions`, but returns the headings it appended. `handoff_text`, when given,
    is used instead of reading `handoff_path` (main() reads the handoff once and reuses it)."""
    if handoff_text is None:
        handoff_text = handoff_path.read_text() if handoff_path.exists() else ""
    body = decisions_body(handoff_text)
    if body is None or norm(body).rstrip(".").lower() == "none":
        return []
    new_entries = decision_entries(body)
    if not new_entries:
        return []
    log_text = log_path.read_text() if log_path.exists() else "# Edmate decision log\n"
    header, existing = split_log(log_text)
    existing_headings = {norm(e.splitlines()[0]) for e in existing if e.startswith("###")}
    to_add = [(heading, text) for heading, text in new_entries if heading not in existing_headings]
    if not to_add:
        return []
    all_entries = [text for _, text in to_add] + existing
    log_path.write_text(header + "\n\n---\n\n" + "\n\n---\n\n".join(all_entries) + "\n")
    return [heading for heading, _ in to_add]


def needs_lesson(handoff_text, appended_headings):
    """True when the handoff has a `## Fix round` heading or a just-appended decision heading
    says "decided by you" (a human correction). closeout then nudges the lead toward a
    docs/lessons.md entry (task 0.19). Advisory only: never blocks or changes the exit code."""
    if FIX_ROUND.search(handoff_text or ""):
        return True
    return any("decided by you" in h.lower() for h in appended_headings)


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
    handoff_text = handoff.read_text() if handoff.exists() else ""
    appended = append_decision_entries(log, handoff, handoff_text)
    added = len(appended)
    if needs_lesson(handoff_text, appended):
        print(f"{task_id}: handoff shows a fix round or human correction — consider a docs/lessons.md entry.")

    board_py = str(root / ".claude" / "skills" / "board" / "board.py")
    code, show_out = sh(root, "python3", board_py, "show", task_id)
    m = re.search(r"^branch:\s*(\S+)", show_out, re.M) if code == 0 else None
    branch_name = m.group(1).strip("'\"") if m and m.group(1) != "null" else None

    # Metrics are best-effort: a missing transcript dir, unparseable JSONL or any other read
    # error must never block marking the task done -- just skip the --metrics flag.
    metrics_args, tmp_metrics_path = [], None
    if branch_name:
        try:
            data = metrics.collect(root, task_id, branch_name)
            fd, tmp_name = tempfile.mkstemp(suffix=".json")
            os.close(fd)
            tmp_metrics_path = Path(tmp_name)
            tmp_metrics_path.write_text(json.dumps(data))
            metrics_args = ["--metrics", str(tmp_metrics_path)]
        except Exception as e:
            # type name only: str(e) can hold a home-directory path
            print(f"could not collect metrics for {task_id}: {type(e).__name__}")

    code, out = sh(root, "python3", board_py, "set", task_id, "done", *metrics_args)
    print(out)
    if tmp_metrics_path:
        tmp_metrics_path.unlink(missing_ok=True)
    if code:
        return code

    digest_failed = False
    code, out = sh(root, "python3", board_py, "digest")
    if code:
        print(f"could not regenerate docs/decisions/digest.md: {out}")
        digest_failed = True

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
    return 1 if digest_failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
