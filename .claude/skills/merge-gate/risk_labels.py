#!/usr/bin/env python3
"""Edmate risk labeller: which `needs:<reviewer>` labels a branch's PR should carry.

  risk_labels.py <branch>        print the labels for <branch> (diffed against main), one per line
  risk_labels.py --vocabulary    print every label this script can ever print

Labels are informational, for skimming the PR list. Nothing reads them back: the merge gate checks
review.md and the handoff, never PR labels, and no label here stands for a human approval.

The rules are merge_gate.py's own (risk-paths.txt groups, first matching glob wins, plus
database-reviewer for a migration that drops or deletes data), imported, not copied.
Exit codes: 0 = printed · 1 = cannot label (no changes, or a glob with no reviewers line) · 2 = usage.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import merge_gate as gate  # noqa: E402

TOUCHED = "risk:touched"


def label(reviewer):
    return f"needs:{reviewer}"


def vocabulary():
    names = {r for _, rs in gate.risk_groups() for r in (rs or ())} | set(gate.MIGRATION_REVIEWERS)
    return sorted(map(label, names)) + [TOUCHED]


def labels_for(branch):
    """(labels, errors) for the branch."""
    changed = gate.changed_paths(branch)
    if not changed:
        return [], [f"branch {branch} has no changes against main (or does not exist)"]
    groups, needed, errors = gate.risk_groups(), set(), []
    for p in changed:
        hit = next(((g, r) for g, r in groups if gate.matches(p, g)), None)
        if hit is None:
            continue
        if hit[1] is None:
            errors.append(f"risk-paths.txt: {hit[0]} has no '# reviewers:' line above it")
            continue
        needed.update(hit[1])
    for p in changed:
        if gate.MIGRATION_FILE.search(p):
            code, text = gate.sh("git", "show", f"{branch}:{p}")
            if code == 0 and gate.DESTRUCTIVE_SQL.search(text):
                needed.update(gate.MIGRATION_REVIEWERS)
    out = sorted(map(label, needed))
    return (out + [TOUCHED] if out else out), errors


def main(argv):
    if argv == ["--vocabulary"]:
        print("\n".join(vocabulary()))
        return 0
    if len(argv) != 1 or argv[0].startswith("-"):
        print(__doc__, file=sys.stderr)
        return 2
    labels, errors = labels_for(argv[0])
    if errors:
        print("\n".join(f"FAIL  {e}" for e in errors), file=sys.stderr)
        return 1
    if labels:
        print("\n".join(labels))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
