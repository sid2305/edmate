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
FINDING_LINE = re.compile(r"^[ \t]*-\s*\[([A-Za-z]+)\]\s*\[([A-Za-z]+)\]")
STATUSES = ("fixed", "open", "deferred", "wontfix")


def transcripts_dir(repo_root):
    """Where this repo's Claude Code transcripts live, same naming Claude Code itself uses
    (a project dir per repo path, '/' replaced with '-'). Overridable via
    `EDMATE_TRANSCRIPTS_DIR` so tests never touch a real `~/.claude`."""
    env = os.environ.get("EDMATE_TRANSCRIPTS_DIR")
    if env:
        return Path(env)
    slug = str(repo_root).replace(os.sep, "-")
    return Path.home() / ".claude" / "projects" / slug


def _load_jsonl(path):
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except (ValueError, TypeError):
            continue
        if isinstance(entry, dict):
            yield entry


def iter_entries(dir, branch, task_id=None):
    """Every JSON entry across `dir`'s *.jsonl files whose `gitBranch` equals `branch`; for
    entries with no `gitBranch` at all, fall back to entries whose `cwd` contains `task_id`
    (older transcripts, or sessions that never set up a worktree)."""
    dir = Path(dir)
    if not dir.is_dir():
        return
    for path in sorted(dir.glob("*.jsonl")):
        for entry in _load_jsonl(path):
            gb = entry.get("gitBranch")
            if gb is not None:
                if gb == branch:
                    yield entry
                continue
            if task_id and task_id in (entry.get("cwd") or ""):
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
            sev, status = m.group(1).upper(), m.group(2).lower()
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


def collect(repo_root, task_id, branch):
    """Board-safe metrics for `task_id` on `branch`: counts and short model-name strings only,
    no paths, session ids or raw transcript text."""
    repo_root = Path(repo_root)
    entries = list(iter_entries(transcripts_dir(repo_root), branch, task_id))

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
