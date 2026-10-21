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
  6. Budget: the plan's cap (a `Budget: <N> tool calls` line, or the first `<N> ... calls` number
     inside a `## Budget` section -- tolerates bold, bullets, `~` and `About`/`about`) vs. the
     handoff's `Tool calls used: <M>` line (also bold/bullet tolerant). Both missing is silently
     skipped (note, no fail -- plans and handoffs written before this check still pass). A
     `## Budget` section or a `Tool calls used:` line present with no number parseable is a visible
     FAIL (not a silent skip). Both present and M > 1.2x N fails, unless the handoff's
     `## Decisions` has a `### ... <task-id> ... budget ... decided by lead ...` entry (same escape
     pattern as [wontfix]), which turns it into a note instead. M > N but <= 1.2x N is a note either way.
"""
import fnmatch
import json
import os
import re
import subprocess
import sys
import time
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
# "Budget: 24 tool calls", tolerant of a leading bullet/bold (same convention as STATUS_LINE), or
# the heading form "## Budget: 24 tool calls" / "### Budget: 24 tool calls".
BUDGET_LINE = re.compile(
    r"^[ \t]*(?:#{2,3}[ \t]+)?[ \t]*[-*\d.]*[ \t]*\*{0,2}Budget[ \t*]*:[ \t*]*(\d+)\s*tool\s*calls",
    re.I | re.M,
)
# The first "<N> ... calls" number inside a `## Budget` section's prose, e.g. "~70 tool calls",
# "About 40 builder calls", "~60 tool calls". The leading `~`/`About` is optional and not captured.
BUDGET_SECTION_NUM = re.compile(r"(?:~\s*|\babout\b\s+)?(\d+)\s*(?:[a-zA-Z][a-zA-Z-]*\s+)?calls?\b", re.I)
TOOL_CALLS_USED_LINE = re.compile(r"^[ \t]*[-*\d.]*[ \t]*\*{0,2}Tool\s*calls\s*used[ \t*]*:[ \t*]*(\d+)", re.I | re.M)
TOOL_CALLS_USED_PRESENT = re.compile(r"^[ \t]*[-*\d.]*[ \t]*\*{0,2}Tool\s*calls\s*used[ \t*]*:", re.I | re.M)
BUDGET_OVERRUN_TOLERANCE = 1.2
UNPARSEABLE = object()  # a '## Budget' section or 'Tool calls used:' line exists but no number parsed


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


FENCE_OPEN = re.compile(r"^[ \t]*(`{3,}|~{3,})")


def fence_mask(lines):
    """(hidden, unclosed_at): hidden[i] is True for a fence marker line or a line inside a fenced
    code block. A fence opened by a run of N backticks (or tildes) closes only on a line that is
    a run of at least N of the SAME character with nothing else after it (CommonMark), so ```
    is never closed by ~~~, a shorter run, or a line like ```md. unclosed_at is the index of the
    opening line of a fence the document never closes, else None (callers must not silently treat
    everything after it as absent)."""
    hidden, opener, opened_at = [], None, None
    for i, line in enumerate(lines):
        m = FENCE_OPEN.match(line)
        if opener is None:
            if m:
                opener, opened_at = m.group(1), i
            hidden.append(m is not None)
            continue
        hidden.append(True)
        run = m.group(1) if m else ""
        if run and run[0] == opener[0] and len(run) >= len(opener) and not line[m.end():].strip():
            opener, opened_at = None, None
    return hidden, opened_at


REVIEWERS_LINE = re.compile(r"^[ \t]*[-*\d.]*[ \t]*Reviewers?:\s*(\S.*)$", re.I)


def reviewer_names(review):
    """Names on the first `Reviewers:` line outside code fences, or None if there is none.
    The line may carry a leading bullet/number ("- Reviewers: ...", same convention as
    STATUS_LINE). The value is a comma-separated list; each item is a name with an optional
    `(model)` suffix; a trailing period on the whole line is ignored. Any other item
    ("security-reviewer skipped", "not architect") does not count."""
    lines = (review or "").splitlines()
    hidden, _ = fence_mask(lines)
    for line, fenced in zip(lines, hidden):
        m = None if fenced else REVIEWERS_LINE.match(line)
        if m:
            items = [i.strip() for i in m.group(1).rstrip().rstrip(".").split(",")]
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


def unfenced(text):
    """Text with the contents of ``` / ~~~ fenced code blocks blanked out (line positions kept),
    the same fence-tracking convention as reviewer_names(), so a decoy inside a quoted code
    example never matches as if it were real document structure."""
    lines = (text or "").splitlines()
    hidden, _ = fence_mask(lines)
    return "\n".join("" if h else line for line, h in zip(lines, hidden))


def section(text, heading):
    """Body of a `## heading` section (its first unfenced occurrence), up to the next `## `
    heading (or None). Fenced code is blanked out first, so a quoted `## heading` inside an
    example never counts as the section."""
    clean = unfenced(text)
    m = re.search(rf"^##\s+{heading}\b.*$", clean, re.M)
    if not m:
        return None
    rest = clean[m.end():]
    nxt = re.search(r"^##\s", rest, re.M)
    return rest[: nxt.start()] if nxt else rest


def section_heading_line(text, heading):
    """The exact text of the section's own `## heading ...` line (its first unfenced occurrence),
    or None if there is no such section."""
    m = re.search(rf"^##\s+{heading}\b.*$", unfenced(text), re.M)
    return m.group(0) if m else None


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


def budget_cap(plan):
    """The plan's tool-call cap. When the plan has a `## Budget` section (its first unfenced
    occurrence — a decoy heading quoted in prose or inside a fenced code block is ignored, the
    same convention as reviewer_names()), the cap comes from that section only, in order: its own
    heading line if that is itself a `## Budget: <N> tool calls` heading; else an explicit
    `Budget: <N> tool calls` line anywhere in its (unfenced) body; else the `<N> ... calls` number
    on the section body's first non-blank unfenced line — never a number from later in the
    section's prose, so a decoy count (another task's total, an old estimate) can't set the cap.
    If that first line has no such number the result is UNPARSEABLE (a visible FAIL, not a silent
    skip). Only when there is no `## Budget` section at all does a whole-document `Budget: <N>
    tool calls` line (outside fences) set the cap; a decoy such a line elsewhere in the document
    can't win once a real `## Budget` section exists, since that section is then checked first.
    A stray UNCLOSED code fence whose hidden tail holds a `## Budget` heading or a `Budget: <N>
    tool calls` line gives UNPARSEABLE (visible FAIL) rather than a silent skip; an unclosed fence
    with nothing budget-like after it changes nothing.
    Returns None if nothing at all is present (old-style plan, silent skip)."""
    text = plan or ""
    lines = text.splitlines()
    _, unclosed_at = fence_mask(lines)
    if unclosed_at is not None:
        # A stray unclosed fence would blank out the rest of the document. If anything
        # budget-like sits in that hidden tail, the cap can't be read safely: fail visibly.
        tail = "\n".join(lines[unclosed_at + 1:])
        if re.search(r"^##\s+Budget\b", tail, re.M | re.I) or BUDGET_LINE.search(tail):
            return UNPARSEABLE
    heading_line = section_heading_line(text, "Budget")
    sect = section(text, "Budget")
    if sect is not None:
        if heading_line:
            hm = BUDGET_LINE.match(heading_line.strip())
            if hm:
                return int(hm.group(1))
        body = unfenced(sect)
        m = BUDGET_LINE.search(body)
        if m:
            return int(m.group(1))
        first_line = next((ln for ln in body.splitlines() if ln.strip()), "")
        m2 = BUDGET_SECTION_NUM.search(first_line)
        return int(m2.group(1)) if m2 else UNPARSEABLE
    m = BUDGET_LINE.search(unfenced(text))
    return int(m.group(1)) if m else None


def tool_calls_used(handoff):
    """The handoff's `Tool calls used: <M>` count. Returns None if there is no such line at all
    (silent skip), or UNPARSEABLE if the phrase is present but no number could be parsed (must
    surface as a visible FAIL, not a silent skip)."""
    text = handoff or ""
    m = TOOL_CALLS_USED_LINE.search(text)
    if m:
        return int(m.group(1))
    return UNPARSEABLE if TOOL_CALLS_USED_PRESENT.search(text) else None


def has_budget_decision(decisions, task):
    """A `### ...` decision entry whose heading names the task, the word 'budget' and 'decided by
    lead' (same escape pattern as [wontfix]: the human's call is the entry existing with the right
    shape, not any particular wording beyond that)."""
    return any(
        names_task(h, task) and "budget" in h.lower() and "decided by lead" in h.lower()
        for h, _ in entries(decisions)
    )


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

    # Check 6: Budget (plan.md) vs. Tool calls used (handoff.md). Either side missing is a silent
    # skip (backward-compatible with every plan/handoff written before this task).
    cap = budget_cap(show(f"docs/tasks/{task}/plan.md"))
    used = tool_calls_used(handoff)
    if cap is UNPARSEABLE:
        fails.append("plan.md has a '## Budget' section but no '<N> ... calls' number could be parsed")
    if used is UNPARSEABLE:
        fails.append("handoff.md has a 'Tool calls used:' line but no number could be parsed")
    if isinstance(cap, int) and isinstance(used, int):
        if used > cap * BUDGET_OVERRUN_TOLERANCE:
            if has_budget_decision(decisions, task):
                notes.append(f"budget overrun: plan cap {cap}, handoff reported {used} tool calls (decision on file)")
            else:
                fails.append(
                    f"budget overrun: plan cap {cap} tool calls, handoff reported {used} (over "
                    f"{BUDGET_OVERRUN_TOLERANCE}x cap; add a '### ... {task} ... budget ...' decision "
                    "to explain, or bring the count down)")
        elif used > cap:
            notes.append(f"budget: plan cap {cap} tool calls, handoff reported {used} (over cap, within tolerance)")

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
            if sev == "CRITICAL" and state != "fixed":
                fails.append(f"a CRITICAL finding is [{state}]; CRITICAL must be fixed and re-verified")
            elif sev == "HIGH" and state.startswith("deferred"):
                # MVP first (human decision, 20 Oct 2026): one fix round; a HIGH still open after it
                # becomes a board task and the PR merges. The task must exist on the board.
                tid = state.split(None, 1)[1]
                if board_field(tid, "id") is None:
                    fails.append(f"a HIGH finding is [deferred {tid}] but {tid} is not on the board")
            elif sev == "HIGH" and state != "fixed":
                fails.append(f"a HIGH finding is [{state}]; fix it, or [deferred <task-id>] after the one fix round")
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


def env_non_negative(name, default, cast):
    """`cast(os.environ[name])`, clamped to >= 0; falls back to `default` for a value that's
    missing, unparseable, or negative -- a bad MERGE_GATE_PR_WAIT_SECONDS/_RETRIES must never
    hang or crash the gate."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = cast(raw)
    except (TypeError, ValueError):
        return default
    return value if value >= 0 else default


def pr_head(pr):
    """(code, branch, oid, local, error) for PR `pr`'s current head, or (1, ..., error) if `gh`
    or git fail. A fresh call each time, since this is retried to ride out a `gh pr view` race."""
    code, out = sh("gh", "pr", "view", pr, "--json", "headRefName,headRefOid")
    if code:
        return 1, None, None, None, f"FAIL  cannot read PR {pr} with gh: {out}"
    data = json.loads(out)
    branch = data["headRefName"]
    m = re.match(r"m\d+/(\d+\.\d+[a-z]*)", branch)  # task ids may carry a letter: 3.11d
    if not m:
        return 1, None, None, None, f"FAIL  branch {branch} is not m<milestone>/<task-id>-<slug>"
    oid = data.get("headRefOid")
    _, local = sh("git", "rev-parse", "--verify", "--quiet", f"{branch}^{{commit}}")
    if not oid:
        return 1, branch, None, local, f"FAIL  gh did not report PR {pr}'s head commit (headRefOid); cannot check what will merge"
    return 0, branch, oid, local, None


def main(argv):
    pr = None
    if argv[:1] == ["--pr"] and len(argv) == 2:
        pr = argv[1]
        # `gh pr view` can briefly lag just after a push, reporting a stale headRefOid (false
        # positive seen 18 Oct). Retry a bounded number of times before failing; tests set
        # MERGE_GATE_PR_WAIT_SECONDS=0 so this never slows the suite down.
        wait = env_non_negative("MERGE_GATE_PR_WAIT_SECONDS", 2.0, float)
        retries = env_non_negative("MERGE_GATE_PR_RETRIES", 3, int)
        code = branch = oid = local = err = None
        for attempt in range(retries + 1):
            code, branch, oid, local, err = pr_head(pr)
            if code:
                print(err)
                return 1
            if oid == local:
                break
            if attempt < retries:
                time.sleep(wait)
        if oid != local:
            print(f"FAIL  PR head {oid[:7]} is not local {branch} ({local[:7] or 'missing'}): git fetch the branch and re-run")
            return 1
        m = re.match(r"m\d+/(\d+\.\d+[a-z]*)", branch)
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
