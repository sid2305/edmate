"""Shared fixtures for the harness tests: throwaway git repos and a hook runner.

Every test builds its own repo under a temp dir, so nothing depends on the real repo's state.
The merge-gate and board scripts are copied into <tmp>/.claude/skills/... so their
`ROOT = parents[3]` resolves to the temp repo.
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[1]  # <repo>/.claude
HOOKS = HARNESS / "hooks"
REPO = HARNESS.parent
SCRIPTS = [
    "skills/merge-gate/merge_gate.py",
    "skills/merge-gate/risk_labels.py",
    "skills/merge-gate/risk-paths.txt",
    "skills/board/board.py",
    "skills/team-lead/closeout.py",
]

# Isolate git from the developer's own config (signing, hooks, default branch, identity).
ENV = dict(
    os.environ,
    GIT_CONFIG_GLOBAL=os.devnull,
    GIT_CONFIG_NOSYSTEM="1",
    GIT_AUTHOR_NAME="Test",
    GIT_AUTHOR_EMAIL="test@example.invalid",
    GIT_COMMITTER_NAME="Test",
    GIT_COMMITTER_EMAIL="test@example.invalid",
)
for k in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"):
    ENV.pop(k, None)


def require_tools():
    """Fail loudly (never skip) when a tool the tests need is missing."""
    missing = [t for t in ("git", "jq", "bash") if shutil.which(t) is None]
    try:
        import yaml  # noqa: F401
    except ImportError:
        missing.append("PyYAML")
    if missing:
        raise RuntimeError(f"harness tests need: {', '.join(missing)}")


def run(cmd, cwd, env=None, stdin=None):
    return subprocess.run(cmd, cwd=cwd, env=env or ENV, input=stdin, capture_output=True, text=True)


def git(cwd, *args):
    r = run(["git", *args], cwd)
    if r.returncode:
        raise RuntimeError(f"git {' '.join(args)} failed: {r.stderr}")
    return r.stdout.strip()


def task(tid, status="review", branch=None, milestone=None):
    return {
        "id": tid,
        "milestone": milestone or f"M{tid.split('.')[0]}",
        "title": f"task {tid}",
        "accept": "x",
        "deps": [],
        "status": status,
        "risk": None,
        "branch": branch,
        "model": None,
    }


def board_yaml(tasks):
    import yaml

    board = {
        "decisions": {},
        "gate": {"id": "GATE", "title": "Gate", "deps": [], "status": "todo"},
        "tasks": tasks,
    }
    return "# test board\n" + yaml.safe_dump(board, sort_keys=False)


GOOD_REVIEW = "# {tid} review — APPROVE\nReviewers: code-reviewer, typescript-reviewer\n\n## Findings\n- [LOW] [fixed] a.ts:1 — x\n"
GOOD_HANDOFF = "# {tid} handoff\nStatus: DONE\n\n## Decisions\nNone\n"


class Repo:
    """A temp git repo on `main` with the harness scripts and a board."""

    def __init__(self, tasks=None, log="# Edmate decision log\n"):
        self.tmp = tempfile.TemporaryDirectory(prefix="edmate-test-")
        self.root = Path(self.tmp.name).resolve() / "repo"
        self.root.mkdir()
        git(self.root, "init", "-q", "-b", "main")
        for rel in SCRIPTS:
            src = HARNESS / rel
            if src.exists():
                dst = self.root / ".claude" / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(src, dst)
        for rel in (".githooks/secret-scan.py", ".githooks/secret-scan-allow.txt"):
            dst = self.root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / rel, dst)
        tasks = tasks if tasks is not None else [task("9.9", branch="m9/9.9-x")]
        self.write("docs/board/tasks.yaml", board_yaml(tasks))
        self.write("docs/decisions/log.md", log)
        self.write("README.md", "test\n")
        self.commit("init")

    def cleanup(self):
        self.tmp.cleanup()

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        return p

    def commit(self, msg="change"):
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "--no-verify", "-m", msg)
        return git(self.root, "rev-parse", "HEAD")

    def branch(self, name, files, base="main"):
        """Create `name` from `base` with `files` ({rel: text}) committed, then return to main."""
        git(self.root, "checkout", "-q", "-b", name, base)
        for rel, text in files.items():
            self.write(rel, text)
        sha = self.commit(f"work on {name}")
        git(self.root, "checkout", "-q", "main")
        return sha

    def add_commit(self, name, files):
        git(self.root, "checkout", "-q", name)
        for rel, text in files.items():
            self.write(rel, text)
        sha = self.commit("more work")
        git(self.root, "checkout", "-q", "main")
        return sha

    def task_files(self, tid="9.9", review=None, handoff=None):
        return {
            f"docs/tasks/{tid}/review.md": review if review is not None else GOOD_REVIEW.format(tid=tid),
            f"docs/tasks/{tid}/handoff.md": handoff if handoff is not None else GOOD_HANDOFF.format(tid=tid),
        }

    def head(self, ref):
        return git(self.root, "rev-parse", ref)

    def script(self, name, *args, root=None, env=None):
        root = root or self.root
        rel = {"gate": "skills/merge-gate/merge_gate.py", "board": "skills/board/board.py",
               "labels": "skills/merge-gate/risk_labels.py",
               "closeout": "skills/team-lead/closeout.py"}[name]
        return run(["python3", str(root / ".claude" / rel), *args], cwd=root, env=env)


def run_hook(script, tool_input, cwd, env=None):
    """Pipe a PreToolUse payload to a hook; return (decision or None, reason, raw result)."""
    payload = json.dumps({"tool_input": tool_input, "cwd": str(cwd)})
    r = run(["bash", str(HOOKS / script)], cwd=cwd, env=env, stdin=payload)
    if r.returncode != 0:
        raise AssertionError(f"{script} exited {r.returncode}: {r.stderr}")
    if not r.stdout.strip():
        return None, "", r
    out = json.loads(r.stdout)["hookSpecificOutput"]
    return out["permissionDecision"], out["permissionDecisionReason"], r


class RepoCase(unittest.TestCase):
    tasks = None

    def setUp(self):
        self.repo = Repo(self.tasks)
        self.addCleanup(self.repo.cleanup)
