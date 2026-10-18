#!/usr/bin/env python3
"""Edmate merge gate: decides whether the team lead may merge a task's branch.

  merge_gate.py <task-id>           check the task's branch from the board
  merge_gate.py --pr <number>       check a GitHub PR (branch m<ms>/<id>-<slug>)

Exit codes: 0 = PASS (lead may merge) · 1 = FAIL (fix first). The lead decides every merge, risky
ones included (human decision, 18 Oct 2026), so there is no "needs human" exit and no PR label check.

Checks, in order (both modes run the same checks):
  1. docs/tasks/<id>/handoff.md exists and has a "## Decisions" section (may say "None").
  2. docs/tasks/<id>/review.md exists, verdict APPROVE, lists the reviewers.
  3. Every CRITICAL/HIGH finding is [fixed]; no MEDIUM/LOW finding is still [open]
     (allowed: [fixed], [deferred <task-id>], [wontfix]). A [wontfix] finding needs a decision entry
     (handoff `## Decisions` or main's docs/decisions/log.md) whose heading has the task id and
     that names the finding's file.
  4. Safety paths changed (or any path in a group that needs safety-reviewer) -> safety-review.md exists.
  5. Risky paths changed (risk-paths.txt groups), or a migration drops/deletes data -> review.md's
     Reviewers: line names every reviewer each touched group requires (`# reviewers:` lines in
     risk-paths.txt; database-reviewer for destructive migrations), and the handoff's
     `## Decisions` has a `### ... risk: high` entry.
"""
import fnmatch
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FINDING = re.compile(r"^\s*[-*\d.]+\s*\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s*\[(fixed|open|deferred[^\]]*|wontfix)\](.*)$", re.I | re.M)
SAFETY = ("packages/harness/src/guardrails/", "content/prompt-packs/", "content/skills/", "evals/suites/safety/", "evals/suites/locked/", "apps/worker/src/alerts/")
DESTRUCTIVE_SQL = re.compile(r"\b(DROP\s+(TABLE|COLUMN|SCHEMA|INDEX)|TRUNCATE|DELETE\s+FROM)\b", re.I)
MIGRATION_REVIEWERS = ("database-reviewer",)
PATH_TOKEN = re.compile(r"[\w.@-]*[\w@-](/[\w.@-]+)*")


def sh(*cmd, cwd=ROOT):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return r.returncode, r.stdout.strip()


def risk_groups():
    """[(glob, reviewers)] from risk-paths.txt. Each `# reviewers: a, b` line applies to the globs
    below it; a glob with no reviewers line above it gets None (the gate fails closed)."""
    groups, current = [], None
    for raw in (ROOT / ".claude/skills/merge-gate/risk-paths.txt").read_text().splitlines():
        line = raw.strip()
        m = re.match(r"#\s*reviewers:\s*(.*)$", line)
        if m:
            current = tuple(r.strip() for r in m.group(1).split(",") if r.strip())
        elif line and not line.startswith("#"):
            groups.append((line, current))
    return groups


def matches(path, glob):
    return fnmatch.fnmatch(path, glob) or fnmatch.fnmatch(path, glob.replace("/**", "/*"))


def names_reviewer(reviewers, who):
    return re.search(rf"(?<![\w-]){re.escape(who)}(?![\w-])", reviewers) is not None


def board_field(task_id, field):
    code, out = sh("python3", ".claude/skills/board/board.py", "show", task_id)
    m = re.search(rf"^{field}:\s*(\S+)", out, re.M)
    return m.group(1).strip("'\"") if code == 0 and m and m.group(1) != "null" else None


def board_branch(task_id):
    return board_field(task_id, "branch")


def section(text, heading):
    """Body of a `## heading` section, up to the next `## ` heading (or None)."""
    m = re.search(rf"^##\s+{heading}\b.*$", text or "", re.M)
    if not m:
        return None
    rest = text[m.end():]
    nxt = re.search(r"^##\s", rest, re.M)
    return rest[: nxt.start()] if nxt else rest


def entries(text):
    """Decision entries: (heading, full text) for every `### ` heading."""
    parts = re.split(r"^(?=###\s)", text or "", flags=re.M)
    return [(p.splitlines()[0], p) for p in parts if p.startswith("###")]


def names_task(heading, task):
    return re.search(rf"(?<![\d.]){re.escape(task)}(?![\d])", heading) is not None


def first_path(text):
    """The first `path[:line]` token in a finding: has a `/` or a file extension (`...` is not one)."""
    for word in text.split():
        m = PATH_TOKEN.fullmatch(word.rstrip(",;:)").split(":")[0])
        if m and ("/" in m.group(0) or "." in m.group(0).strip(".")):
            return m.group(0)
    return None


def evaluate(task, branch, pr=None):
    """Run every check. Returns (exit code, output lines)."""
    fails, notes, lines = [], [], []

    # Task files live on the branch, so read them from git, not the working tree.
    def show(path, ref=branch):
        code, out = sh("git", "show", f"{ref}:{path}")
        return out if code == 0 else None

    _, diff_names = sh("git", "diff", "--name-only", f"main...{branch}")
    changed = [p for p in diff_names.splitlines() if p]
    if not changed:
        fails.append(f"branch {branch} has no changes against main (or does not exist)")

    handoff = show(f"docs/tasks/{task}/handoff.md")
    decisions = section(handoff, "Decisions")
    if handoff is None:
        fails.append(f"docs/tasks/{task}/handoff.md is missing")
    elif decisions is None:
        fails.append("handoff.md has no '## Decisions' section (write 'None' if there were none)")

    review = show(f"docs/tasks/{task}/review.md")
    reviewers = ""
    if review is None:
        fails.append(f"docs/tasks/{task}/review.md is missing: run the reviewers first")
    else:
        if not re.search(r"^#.*\bAPPROVE\b", review, re.M) or re.search(r"^#.*CHANGES_REQUESTED", review, re.M):
            fails.append("review.md verdict is not APPROVE")
        m = re.search(r"^Reviewers?:\s*(\S.*)$", review, re.M)
        if m:
            reviewers = m.group(1)
        else:
            fails.append("review.md does not say which reviewers ran ('Reviewers: ...')")
        findings = FINDING.findall(review)
        decision_entries = None
        for sev, state, rest in findings:
            sev, state = sev.upper(), state.lower()
            if sev in ("CRITICAL", "HIGH") and state != "fixed":
                fails.append(f"a {sev} finding is [{state}]; CRITICAL and HIGH must be fixed and re-verified")
            elif state == "open":
                fails.append(f"a {sev} finding is still [open]: fix it, or mark [deferred <task-id>] / [wontfix]")
            elif state == "wontfix":
                if decision_entries is None:
                    log = show("docs/decisions/log.md", ref="main") or ""
                    decision_entries = [e for e in entries(decisions) + entries(log) if names_task(e[0], task)]
                path = first_path(rest)
                if path is None:
                    fails.append(f"a [wontfix] {sev} finding names no file: start it with path[:line]")
                    continue
                if not any(path in body or os.path.basename(path) in body for _, body in decision_entries):
                    fails.append(f"[wontfix] {path} has no decision entry naming it (handoff ## Decisions or docs/decisions/log.md, heading with {task})")
        notes.append(f"findings parsed: {len(findings)}")

    # Risky groups: every touched group's reviewers must be named, plus one risk: high decision.
    groups = risk_groups()
    risky, needed = [], {}
    for p in changed:
        hit = next(((g, r) for g, r in groups if matches(p, g)), None)
        if hit is None:
            continue
        glob, reviewers_needed = hit
        risky.append(p)
        if reviewers_needed is None:
            fails.append(f"risk-paths.txt: {glob} has no '# reviewers:' line above it")
            continue
        for who in reviewers_needed:
            needed.setdefault(who, p)
    for p in changed:
        if "/migrations/" in p and p.endswith(".sql") and DESTRUCTIVE_SQL.search(show(p) or ""):
            risky.append(f"{p} (drops or deletes data)")
            for who in MIGRATION_REVIEWERS:
                needed.setdefault(who, p)

    safety_paths = [p for p in changed if p.startswith(SAFETY) or any(
        matches(p, g) and r and "safety-reviewer" in r for g, r in groups)]
    if safety_paths and show(f"docs/tasks/{task}/safety-review.md") is None:
        fails.append(f"safety paths changed but docs/tasks/{task}/safety-review.md is missing")

    if risky:
        for who, p in needed.items():
            if not names_reviewer(reviewers, who):
                fails.append(f"risky {p}: review.md Reviewers: is missing {who}")
        if not any("risk: high" in h for h, _ in entries(decisions)):
            fails.append("risky change: handoff ## Decisions needs a '### ... risk: high' entry (it reaches the human's skim list)")

    lines.append(f"Merge gate for {task} on {branch}" + (f" (PR #{pr})" if pr else ""))
    lines += [f"  note  {n}" for n in notes]
    lines += [f"  risky {p}" for p in risky[:12]]
    if len(risky) > 12:
        lines.append(f"  risky ... and {len(risky) - 12} more")
    if fails:
        lines += [f"  FAIL  {f}" for f in fails]
        lines.append("RESULT: FAIL — fix the items above, re-run the reviewers, then run the gate again.")
        return 1, lines
    if risky:
        lines.append("RESULT: PASS — risky, lead-approved: the required reviewers ran and a risk: high decision is logged. The lead may merge (squash), then append the decisions to docs/decisions/log.md.")
        return 0, lines
    lines.append("RESULT: PASS — the team lead may merge (squash), then append the decisions to docs/decisions/log.md.")
    return 0, lines


def main(argv):
    pr = None
    if argv[:1] == ["--pr"] and len(argv) == 2:
        pr = argv[1]
        code, out = sh("gh", "pr", "view", pr, "--json", "headRefName")
        if code:
            print(f"FAIL  cannot read PR {pr} with gh: {out}")
            return 1
        data = json.loads(out)
        branch = data["headRefName"]
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
    code, lines = evaluate(task, branch, pr)
    print("\n".join(lines))
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
