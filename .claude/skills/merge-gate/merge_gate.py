#!/usr/bin/env python3
"""Edmate merge gate: decides whether the team lead may merge a task's branch.

  merge_gate.py <task-id>           check the task's branch from the board
  merge_gate.py --pr <number>       check a GitHub PR (branch m<ms>/<id>-<slug>; the local branch
                                    must be at the PR's head commit)

Exit codes: 0 = PASS (lead may merge) · 1 = FAIL (fix first). The lead decides every merge, risky
ones included (human decision, 18 Oct 2026), so there is no "needs human" exit and no PR label check.

Checks, in order (both modes run the same checks):
  1. docs/tasks/<id>/handoff.md exists, has a "Status:" line whose value is DONE (not PARTIAL,
     BLOCKED, or missing — lettered sub-tasks that have their own docs/tasks/<id> folder are read
     from it directly, same as every other check here), and has a "## Decisions" section (may say
     "None").
  2. docs/tasks/<id>/review.md exists, verdict APPROVE, lists the reviewers.
  3. Every line starting with a severity tag has a valid state tag; every CRITICAL/HIGH finding is [fixed]; no MEDIUM/LOW finding is still [open]
     (allowed: [fixed], [deferred <task-id>], [wontfix]). A [wontfix] finding needs a decision entry
     (handoff `## Decisions` or main's docs/decisions/log.md) whose heading has the task id and
     that names the finding's file.
  4. Safety paths changed (or any path in a group that needs safety-reviewer) -> safety-review.md exists.
     Only while some risk-paths.txt group lists safety-reviewer; until the pilot gate none does
     (MVP first, human decision 20 Oct 2026) and task 13.3 switches it back on.
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
# Any line that starts with a severity tag is a finding; it must carry a valid state tag.
SEVERITY_LINE = re.compile(r"^\s*[-*\d.]*\s*\[(CRITICAL|HIGH|MEDIUM|LOW)\](.*)$", re.I | re.M)
# A "Status:" line, bold or plain ("Status: DONE", "- **Status:** DONE (notes)"). Only matches at
# the start of a line (ignoring a leading bullet/number), so prose mentioning "Status:" mid-sentence
# (e.g. a Decided bullet quoting another task's handoff) is not picked up.
STATUS_LINE = re.compile(r"^[ \t]*[-*\d.]*[ \t]*\*{0,2}status\*{0,2}[ \t]*:[ \t]*\*{0,2}(.*?)\*{0,2}[ \t]*$", re.I | re.M)
STATUS_BAD = re.compile(r"\b(PARTIAL|BLOCKED)\b", re.I)
STATUS_DONE = re.compile(r"\bDONE\b", re.I)
STATE = re.compile(r"\s*\[(fixed|open|deferred\s+[^\]\s]+|wontfix)\](.*)$", re.I)
SAFETY = ("packages/harness/src/guardrails/", "content/prompt-packs/", "content/skills/", "evals/suites/safety/", "evals/suites/locked/", "apps/worker/src/alerts/")
DESTRUCTIVE_SQL = re.compile(
    r"\b(DROP\s+(TABLE|COLUMN|SCHEMA|INDEX|VIEW|MATERIALIZED\s+VIEW|TYPE|FUNCTION|DATABASE|SEQUENCE|TRIGGER|CONSTRAINT)"
    r"|ALTER\s+TABLE\b[^;]*?\bDROP\b|TRUNCATE|DELETE\s+FROM|UPDATE\s+\S+\s+SET)\b", re.I)
# SQL, or JS/TS migration files (which hold SQL in strings), in any migrations/ folder.
MIGRATION_FILE = re.compile(r"(^|/)migrations/.+\.(sql|ts|js|mjs|cjs|mts|cts)$")
REVIEWER_ITEM = re.compile(r"([a-z][a-z0-9-]*)(\s*\([^()]*\))?")
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


def reviewer_names(review):
    """Names on the first `Reviewers:` line outside code fences, or None if there is none.
    The line is a comma-separated list; each item is a name with an optional `(model)` suffix.
    Any other item ("security-reviewer skipped", "not architect") does not count."""
    fenced = False
    for line in (review or "").splitlines():
        if line.lstrip().startswith(("```", "~~~")):
            fenced = not fenced
            continue
        m = None if fenced else re.match(r"Reviewers?:\s*(\S.*)$", line)
        if m:
            items = [i.strip() for i in m.group(1).split(",")]
            return {mm.group(1) for mm in map(REVIEWER_ITEM.fullmatch, items) if mm}
    return None


def changed_paths(branch):
    """Every path the branch changes, as plain UTF-8 (no quoting), with both sides of a rename."""
    r = subprocess.run(["git", "-c", "core.quotePath=false", "diff", "--name-only", "-z", "--no-renames", f"main...{branch}"],
                       cwd=ROOT, capture_output=True, text=True)
    return [p for p in r.stdout.split("\0") if p] if r.returncode == 0 else []


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


def status_value(handoff):
    """The handoff's first 'Status:' line value, stripped, or None if there is no such line."""
    m = STATUS_LINE.search(handoff or "")
    return m.group(1).strip() if m else None


def status_is_done(value):
    """A status value counts as done if it says DONE and doesn't also say PARTIAL/BLOCKED (a
    composite status for several sub-tasks, e.g. '4.0b DONE (PR #29); 4.0a DONE pending sign-off',
    counts as done only when every part does)."""
    return value is not None and STATUS_DONE.search(value) and not STATUS_BAD.search(value)


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

    changed = changed_paths(branch)
    if not changed:
        fails.append(f"branch {branch} has no changes against main (or does not exist)")

    handoff = show(f"docs/tasks/{task}/handoff.md")
    decisions = section(handoff, "Decisions")
    if handoff is None:
        fails.append(f"docs/tasks/{task}/handoff.md is missing")
    else:
        status = status_value(handoff)
        if status is None:
            fails.append("handoff.md has no 'Status:' line (must say DONE; PARTIAL/BLOCKED handoffs may not merge)")
        elif not status_is_done(status):
            fails.append(f"handoff.md Status is '{status}', not DONE (PARTIAL/BLOCKED handoffs may not merge)")
        if decisions is None:
            fails.append("handoff.md has no '## Decisions' section (write 'None' if there were none)")

    review = show(f"docs/tasks/{task}/review.md")
    reviewers = set()
    if review is None:
        fails.append(f"docs/tasks/{task}/review.md is missing: run the reviewers first")
    else:
        if not re.search(r"^#.*\bAPPROVE\b", review, re.M) or re.search(r"^#.*CHANGES_REQUESTED", review, re.M):
            fails.append("review.md verdict is not APPROVE")
        names = reviewer_names(review)
        if names is None:
            fails.append("review.md does not say which reviewers ran ('Reviewers: ...')")
        reviewers = names or set()
        findings = SEVERITY_LINE.findall(review)
        decision_entries = None
        for sev, after in findings:
            sev = sev.upper()
            st = STATE.match(after)
            if st is None:
                fails.append(f"a [{sev}] finding has no valid state tag ([fixed|open|deferred <id>|wontfix]): {after.strip()[:80]}")
                continue
            state, rest = st.group(1).lower(), st.group(2)
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
        if MIGRATION_FILE.search(p) and DESTRUCTIVE_SQL.search(show(p) or ""):
            risky.append(f"{p} (drops or deletes data)")
            for who in MIGRATION_REVIEWERS:
                needed.setdefault(who, p)

    # Dormant until 13.3 puts `safety-reviewer` back in risk-paths.txt (MVP first, 20 Oct 2026).
    safety_on = any(r and "safety-reviewer" in r for _, r in groups)
    safety_paths = [p for p in changed if safety_on and (p.startswith(SAFETY) or any(
        matches(p, g) and r and "safety-reviewer" in r for g, r in groups))]
    if safety_paths and show(f"docs/tasks/{task}/safety-review.md") is None:
        fails.append(f"safety paths changed but docs/tasks/{task}/safety-review.md is missing")

    if risky:
        for who, p in needed.items():
            if who not in reviewers:
                fails.append(f"risky {p}: review.md Reviewers: is missing {who}")
        if not any(re.search(r"risk:\s*high\s*$", h) for h, _ in entries(decisions)):
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
        code, out = sh("gh", "pr", "view", pr, "--json", "headRefName,headRefOid")
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
        # The PR merges GitHub's head, so the local branch the gate reads must be that exact commit.
        oid = data.get("headRefOid")
        _, local = sh("git", "rev-parse", "--verify", "--quiet", f"{branch}^{{commit}}")
        if not oid:
            print(f"FAIL  gh did not report PR {pr}'s head commit (headRefOid); cannot check what will merge")
            return 1
        if oid != local:
            print(f"FAIL  PR head {oid[:7]} is not local {branch} ({local[:7] or 'missing'}): git fetch the branch and re-run")
            return 1
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
