#!/usr/bin/env python3
"""Edmate merge gate: decides whether the team lead may merge a task's branch.

  merge_gate.py <task-id>           check the task's branch from the board
  merge_gate.py --pr <number>       check a GitHub PR (branch m<ms>/<id>-<slug>)

Exit codes: 0 = PASS (lead may merge) · 1 = FAIL (fix first) · 3 = NEEDS HUMAN (risky; ask the user)

Checks, in order:
  1. docs/tasks/<id>/handoff.md exists and has a "## Decisions" section (may say "None").
  2. docs/tasks/<id>/review.md exists, verdict APPROVE, lists the reviewers.
  3. Every CRITICAL/HIGH finding is [fixed]; no MEDIUM/LOW finding is still [open]
     (allowed: [fixed], [deferred <task-id>], [wontfix] — wontfix needs a decision-log entry).
  4. Safety paths changed -> docs/tasks/<id>/safety-review.md exists.
  5. Risky paths changed, or a migration drops/deletes data -> needs the `human-approved` PR label.
"""
import fnmatch
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FINDING = re.compile(r"^\s*[-*\d.]+\s*\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s*\[(fixed|open|deferred[^\]]*|wontfix)\]", re.I | re.M)
SAFETY = ("packages/harness/src/guardrails/", "content/prompt-packs/", "content/skills/", "evals/suites/safety/", "evals/suites/locked/", "apps/worker/src/alerts/")
DESTRUCTIVE_SQL = re.compile(r"\b(DROP\s+(TABLE|COLUMN|SCHEMA|INDEX)|TRUNCATE|DELETE\s+FROM)\b", re.I)


def sh(*cmd, cwd=ROOT):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return r.returncode, r.stdout.strip()


def risk_globs():
    lines = (ROOT / ".claude/skills/merge-gate/risk-paths.txt").read_text().splitlines()
    return [l.strip() for l in lines if l.strip() and not l.lstrip().startswith("#")]


def is_risky(path, globs):
    return any(fnmatch.fnmatch(path, g) or fnmatch.fnmatch(path, g.replace("/**", "/*")) for g in globs)


def board_branch(task_id):
    code, out = sh("python3", ".claude/skills/board/board.py", "show", task_id)
    m = re.search(r"^branch:\s*(\S+)", out, re.M)
    return m.group(1) if code == 0 and m and m.group(1) != "null" else None


def main(argv):
    pr, labels = None, []
    if argv[:1] == ["--pr"] and len(argv) == 2:
        pr = argv[1]
        code, out = sh("gh", "pr", "view", pr, "--json", "headRefName,labels")
        if code:
            print(f"FAIL  cannot read PR {pr} with gh: {out}")
            return 1
        data = json.loads(out)
        branch, labels = data["headRefName"], [l["name"] for l in data["labels"]]
        m = re.match(r"m\d+/(\d+\.\d+)", branch)
        if not m:
            print(f"FAIL  branch {branch} is not m<milestone>/<task-id>-<slug>")
            return 1
        task = m.group(1)
    elif len(argv) == 1:
        task, branch = argv[0], board_branch(argv[0])
        if not branch:
            print(f"FAIL  task {task} has no branch on the board (board.py set {task} running --branch ...)")
            return 1
    else:
        print(__doc__)
        return 1

    fails, notes = [], []
    # Task files live on the branch, so read them from git, not the working tree.
    def show(path):
        code, out = sh("git", "show", f"{branch}:{path}")
        return out if code == 0 else None

    _, diff_names = sh("git", "diff", "--name-only", f"main...{branch}")
    changed = [p for p in diff_names.splitlines() if p]
    if not changed:
        fails.append(f"branch {branch} has no changes against main (or does not exist)")

    handoff = show(f"docs/tasks/{task}/handoff.md")
    if handoff is None:
        fails.append(f"docs/tasks/{task}/handoff.md is missing")
    elif not re.search(r"^##\s+Decisions", handoff, re.M):
        fails.append("handoff.md has no '## Decisions' section (write 'None' if there were none)")

    review = show(f"docs/tasks/{task}/review.md")
    if review is None:
        fails.append(f"docs/tasks/{task}/review.md is missing: run the reviewers first")
    else:
        if not re.search(r"^#.*\bAPPROVE\b", review, re.M) or re.search(r"^#.*CHANGES_REQUESTED", review, re.M):
            fails.append("review.md verdict is not APPROVE")
        if not re.search(r"^Reviewers?:\s*\S", review, re.M):
            fails.append("review.md does not say which reviewers ran ('Reviewers: ...')")
        for sev, state in FINDING.findall(review):
            sev, state = sev.upper(), state.lower()
            if sev in ("CRITICAL", "HIGH") and state != "fixed":
                fails.append(f"a {sev} finding is [{state}]; CRITICAL and HIGH must be fixed and re-verified")
            elif state == "open":
                fails.append(f"a {sev} finding is still [open]: fix it, or mark [deferred <task-id>] / [wontfix]")
        notes.append(f"findings parsed: {len(FINDING.findall(review))}")

    if any(p.startswith(SAFETY) for p in changed):
        if show(f"docs/tasks/{task}/safety-review.md") is None:
            fails.append("safety paths changed but docs/tasks/{task}/safety-review.md is missing".format(task=task))

    globs = risk_globs()
    risky = [p for p in changed if is_risky(p, globs)]
    for p in changed:
        if "/migrations/" in p and p.endswith(".sql"):
            body = show(p) or ""
            if DESTRUCTIVE_SQL.search(body):
                risky.append(f"{p} (drops or deletes data)")

    print(f"Merge gate for {task} on {branch}" + (f" (PR #{pr})" if pr else ""))
    for n in notes:
        print(f"  note  {n}")
    if fails:
        for f in fails:
            print(f"  FAIL  {f}")
        print("RESULT: FAIL — fix the items above, re-run the reviewers, then run the gate again.")
        return 1
    if risky:
        approved = "human-approved" in labels
        for p in risky[:12]:
            print(f"  risky {p}")
        if approved:
            print("RESULT: PASS — risky, and the human-approved label is on the PR.")
            return 0
        print("RESULT: NEEDS HUMAN — risky change. Ask the user to review and add the `human-approved` label.")
        return 3
    print("RESULT: PASS — the team lead may merge (squash), then append the decisions to docs/decisions/log.md.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
