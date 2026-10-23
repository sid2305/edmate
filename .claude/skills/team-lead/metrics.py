"""Pure functions to turn one task's Claude Code transcripts into board-safe numbers.

No subprocess calls, no YAML writes -- `collect()` only reads files and returns a dict of
numbers/short strings (no paths, session ids or transcript text). `closeout.py` is the only
caller that writes the result anywhere (via `board.py set <id> done --metrics <file>`).
"""
import json
import os
import re
from datetime import datetime
from pathlib import Path

PHASE_HEADING = re.compile(r"^##\s+Phase\b", re.M)
FIX_ROUND_HEADING = re.compile(r"^##\s+Fix round\b", re.M)
FINDING_LINE = re.compile(r"^[ \t]*-\s*\[([A-Za-z]+)\]\s*\[([^\]]+)\]")
STATUSES = ("fixed", "open", "deferred", "wontfix")


def transcripts_dir(repo_root):
    """Where this repo's Claude Code transcripts live, same naming Claude Code itself uses
    (a project dir per repo path, '/' replaced with '-'). Overridable via
    `EDMATE_TRANSCRIPTS_DIR` so tests never touch a real `~/.claude`."""
    env = os.environ.get("EDMATE_TRANSCRIPTS_DIR")
    if env:
        return Path(env)
    slug = str(Path(repo_root).resolve()).replace(os.sep, "-")
    return Path.home() / ".claude" / "projects" / slug


# A task id counts in a cwd only when bounded by '/', '-', '_' or the string ends, so "0.1"
# never matches a cwd for "0.16" (or the reverse).
_ID_START = r"(?:^|(?<=[/_-]))"
_ID_END = r"(?=$|[/_-])"


def _id_in(task_id, text):
    return re.search(_ID_START + re.escape(task_id) + _ID_END, text or "") is not None


def _load_jsonl(path):
    """Stream one JSONL file line by line; unreadable files and bad lines are skipped."""
    try:
        with path.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if isinstance(entry, dict):
                    yield entry
    except OSError:
        return


_BOARD_ID = re.compile(r"""^-\s+id:\s*['"]?([^'"\s#]+)""", re.M)


def read_board_ids(repo_root):
    """Task ids from `docs/board/tasks.yaml` (top-level `- id:` lines), or None when the board is
    missing or unreadable -- callers then match `work-<id>` exactly, never with a letter."""
    try:
        text = (Path(repo_root) / "docs" / "board" / "tasks.yaml").read_text(encoding="utf-8")
    except (OSError, ValueError):
        return None
    return frozenset(_BOARD_ID.findall(text))


def _prompt_names_task(task_id, text):
    """`task <id>` (so also `Edmate task <id>`), the id not followed by a digit, a letter or
    '.digit', so "task 0.16" never matches 0.1, "task 10.1" never matches 0.1 and "task 0.16a"
    never matches 0.16."""
    pattern = r"\btask\s+" + re.escape(task_id) + r"(?![0-9a-z]|\.\d)"
    return re.search(pattern, text or "", re.I) is not None


def _work_branch(task_id, gb, ids):
    """Builder branches: `work-<id>` always; `work-<id><letter>` (builder phase branches such as
    work-7.7a) only when `<id><letter>` is not itself a board task. With no board ids (None or
    empty) only the exact branch counts."""
    if gb == "work-" + task_id:
        return True
    if not ids or re.fullmatch(r"work-" + re.escape(task_id) + r"[a-z]", gb or "") is None:
        return False
    return gb[len("work-"):] not in ids


def _first_prompt(entries):
    """Text of the first user message (the subagent's prompt). Used only for matching."""
    for entry in entries:
        message = entry.get("message")
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return " ".join(
                b.get("text") or "" for b in content if isinstance(b, dict) and b.get("type") == "text"
            )
        return ""
    return ""


def _subagent_files(dir):
    """`<dir>/<session>/subagents/*.jsonl`, skipping any symlinked session dir, subagents dir
    or file, so nothing outside `dir` is read."""
    for session in sorted(dir.iterdir()):
        if session.is_symlink() or not session.is_dir():
            continue
        sub = session / "subagents"
        if sub.is_symlink() or not sub.is_dir():
            continue
        for path in sorted(sub.glob("*.jsonl")):
            if path.is_symlink() or not path.is_file():
                continue
            yield path


def _subagent_entries(dir, branch, task_id, ids):
    """A whole subagent file counts for the task when its prompt names the task, or any entry's
    gitBranch is the task branch or the task's `work-` branch. Builders start on `main` before
    their checkout and reviewers run from the main checkout, so per-entry matching misses them."""
    for path in _subagent_files(dir):
        entries = list(_load_jsonl(path))
        branches = {e.get("gitBranch") for e in entries}
        hit = branch in branches
        if task_id and not hit:
            hit = any(_work_branch(task_id, gb, ids) for gb in branches if isinstance(gb, str))
            hit = hit or _prompt_names_task(task_id, _first_prompt(entries))
        if hit:
            yield from entries


def iter_entries(dir, branch, task_id=None, board_ids=None):
    """Lead (top-level) files: every entry whose `gitBranch` equals `branch`; for entries with no
    `gitBranch` at all, fall back to entries whose `cwd` contains `task_id` as a whole part
    bounded by '/', '-', '_' or the string ends (older transcripts, or sessions that never set up
    a worktree). Subagent files (`<session>/subagents/*.jsonl`) count whole; see
    `_subagent_entries` (`board_ids`: the board's task ids, see `_work_branch`). Symlinks are
    skipped so nothing outside `dir` is read."""
    dir = Path(dir)
    if not dir.is_dir():
        return
    yield from _lead_entries(dir, branch, task_id)
    yield from _subagent_entries(dir, branch, task_id, board_ids)


def _lead_entries(dir, branch, task_id):
    for path in sorted(dir.glob("*.jsonl")):
        if path.is_symlink() or not path.is_file():
            continue
        for entry in _load_jsonl(path):
            gb = entry.get("gitBranch")
            if gb is not None:
                if gb == branch:
                    yield entry
                continue
            if task_id and _id_in(task_id, entry.get("cwd")):
                yield entry


def _parse_ts(ts):
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return None


def _heading_count(path, pattern):
    if not path.exists():
        return None
    return len(pattern.findall(path.read_text()))


def _findings(path):
    by_severity, by_status = {}, {s: 0 for s in STATUSES}
    total = 0
    if path.exists():
        for line in path.read_text().splitlines():
            m = FINDING_LINE.match(line)
            if not m:
                continue
            # bucket by the bracket's first word: "[deferred 0.13a]" counts as deferred
            sev, status = m.group(1).upper(), (m.group(2).split() or [""])[0].lower()
            by_severity[sev] = by_severity.get(sev, 0) + 1
            if status in by_status:
                by_status[status] += 1
            total += 1
    return {"total": total, "by_severity": by_severity, "by_status": by_status}


def _human_questions(root, task_id):
    blockers = root / ".claude" / "blockers.md"
    if not blockers.exists():
        return 0
    return sum(1 for line in blockers.read_text().splitlines() if task_id in line)


def collect(repo_root, task_id, branch, board_ids=None):
    """Board-safe metrics for `task_id` on `branch`: counts and short model-name strings only,
    no paths, session ids or raw transcript text. `board_ids` defaults to the ids read from the
    repo's board (tests pass an explicit set)."""
    repo_root = Path(repo_root).resolve()
    if board_ids is None:
        board_ids = read_board_ids(repo_root)
    entries = list(iter_entries(transcripts_dir(repo_root), branch, task_id, board_ids))

    tool_calls = 0
    tokens_in = tokens_out = cache_read_tokens = 0
    timestamps = []
    models = set()

    for entry in entries:
        ts = _parse_ts(entry.get("timestamp"))
        if ts is not None:
            timestamps.append(ts)
        message = entry.get("message")
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        model = message.get("model")
        if model:
            models.add(model)
        content = message.get("content")
        if isinstance(content, list):
            tool_calls += sum(1 for block in content if isinstance(block, dict) and block.get("type") == "tool_use")
        usage = message.get("usage")
        if isinstance(usage, dict):
            tokens_in += usage.get("input_tokens") or 0
            tokens_out += usage.get("output_tokens") or 0
            cache_read_tokens += usage.get("cache_read_input_tokens") or 0

    wall_time_seconds = (max(timestamps) - min(timestamps)) if timestamps else 0

    plan_path = repo_root / "docs" / "tasks" / task_id / "plan.md"
    handoff_path = repo_root / "docs" / "tasks" / task_id / "handoff.md"
    review_path = repo_root / "docs" / "tasks" / task_id / "review.md"

    phases = _heading_count(plan_path, PHASE_HEADING)
    builder_phases = phases if phases else 1

    return {
        "tool_calls": tool_calls,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "cache_read_tokens": cache_read_tokens,
        "wall_time_seconds": round(wall_time_seconds),
        "models": sorted(models),
        "builder_phases": builder_phases,
        "fix_rounds": _heading_count(handoff_path, FIX_ROUND_HEADING) or 0,
        "findings": _findings(review_path),
        "human_questions": _human_questions(repo_root, task_id),
    }
