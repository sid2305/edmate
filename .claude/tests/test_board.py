"""board.py: `set <id> done` decision checks, `next` plan warnings, other statuses."""
import json
import tempfile
import unittest
from pathlib import Path

from helpers import RepoCase, require_tools, task


def setUpModule():
    require_tools()


ENTRY = """### 18 Oct 2026 · 9.9 Thing · decided by lead · risk: low
Decided: Keep the   thing simple.
Why: x.

### 18 Oct 2026 · 9.9 Other · decided by lead · risk: low
Decided: Use one table.
Why: y.
"""


class Done(RepoCase):
    tasks = [task("9.9", status="review", branch="m9/9.9-x"), task("9.8", status="planning"), task("9.7", status="todo")]

    def board_text(self):
        return (self.repo.root / "docs/board/tasks.yaml").read_text()

    def done(self, tid="9.9"):
        before = self.board_text()
        r = self.repo.script("board", "set", tid, "done")
        return r.returncode, r.stdout + r.stderr, before

    def handoff(self, decisions):
        self.repo.write("docs/tasks/9.9/handoff.md", f"# 9.9 handoff\nStatus: DONE\n\n## Decisions\n{decisions}\n## Notes\nDecided: not a decision line.\n")

    def test_no_handoff_refused_board_unchanged(self):
        code, out, before = self.done()
        self.assertEqual(code, 1, out)
        self.assertIn("merge first", out)
        self.assertEqual(self.board_text(), before)

    def test_no_decisions_section_refused(self):
        self.repo.write("docs/tasks/9.9/handoff.md", "# 9.9 handoff\nStatus: DONE\n")
        code, out, before = self.done()
        self.assertEqual(code, 1, out)
        self.assertIn("## Decisions", out)
        self.assertEqual(self.board_text(), before)

    def test_none_is_done(self):
        self.handoff("None\n")
        code, out, _ = self.done()
        self.assertEqual(code, 0, out)
        self.assertIn("status: done", self.board_text())

    def test_missing_line_refused_and_named(self):
        self.handoff(ENTRY)
        self.repo.write("docs/decisions/log.md", "# log\n\n### 18 Oct 2026 · 9.9 Thing\nDecided: Keep the thing simple.\n")
        code, out, before = self.done()
        self.assertEqual(code, 1, out)
        self.assertIn("Decided: Use one table.", out)
        self.assertNotIn("Keep the thing simple", out)
        self.assertEqual(self.board_text(), before)

    def test_all_present_with_whitespace_differences(self):
        self.handoff(ENTRY)
        self.repo.write("docs/decisions/log.md", "# log\n\nDecided:  Keep the thing simple.  \n\n   Decided: Use one\ttable.\n")
        code, out, _ = self.done()
        self.assertEqual(code, 0, out)
        self.assertIn("status: done", self.board_text())

    def test_condensed_line_refused(self):
        self.handoff(ENTRY)
        self.repo.write("docs/decisions/log.md", "Decided: Keep the thing simple and use one table.\n")
        self.assertEqual(self.done()[0], 1)

    def test_entries_without_decided_lines_refused(self):
        self.handoff("### 18 Oct 2026 · 9.9 Thing\nWhy: x.\n")
        code, out, _ = self.done()
        self.assertEqual(code, 1, out)
        self.assertIn("Decided:", out)

    def test_bullet_decided_line_accepted(self):
        # A handoff written with bullet-prefixed Decided lines ("- Decided: ...") is recognized
        # the same as a plain "Decided:" line, as long as the log has the same bulleted text.
        self.handoff("### 18 Oct 2026 · 9.9 Thing · decided by lead · risk: low\n- Decided: Keep the thing simple.\nWhy: x.\n")
        self.repo.write("docs/decisions/log.md", "# log\n\n### 18 Oct 2026 · 9.9 Thing\n- Decided: Keep the thing simple.\n")
        code, out, _ = self.done()
        self.assertEqual(code, 0, out)
        self.assertIn("status: done", self.board_text())

    def test_bullet_decided_line_still_checked_against_log(self):
        self.handoff("### 18 Oct 2026 · 9.9 Thing · decided by lead · risk: low\n- Decided: Keep the thing simple.\nWhy: x.\n")
        self.repo.write("docs/decisions/log.md", "# log\n\n### 18 Oct 2026 · 9.9 Thing\nSomething else entirely.\n")
        code, out, _ = self.done()
        self.assertEqual(code, 1, out)
        self.assertIn("Decided: Keep the thing simple.", out)

    def test_other_statuses_unchanged(self):
        r = self.repo.script("board", "set", "9.7", "running", "--branch", "m9/9.7-y", "--model", "build:opus")
        self.assertEqual(r.returncode, 0, r.stderr)
        text = self.board_text()
        self.assertIn("m9/9.7-y", text)
        self.assertIn("build:opus", text)
        self.assertEqual(self.repo.script("board", "set", "9.7", "review").returncode, 0)

    def test_bad_status(self):
        self.assertNotEqual(self.repo.script("board", "set", "9.7", "finished").returncode, 0)


def task_with(tid, **kw):
    t = task(tid, status=kw.pop("status", "done"))
    t.update(kw)
    return t


class SetMetrics(RepoCase):
    tasks = [task("9.9", status="review", branch="m9/9.9-x")]

    def board_text(self):
        return (self.repo.root / "docs/board/tasks.yaml").read_text()

    def test_set_metrics_merges_map(self):
        self.repo.write("docs/tasks/9.9/handoff.md", "# 9.9 handoff\nStatus: DONE\n\n## Decisions\nNone\n")
        with tempfile.TemporaryDirectory() as tmp:
            mfile = Path(tmp) / "metrics.json"
            mfile.write_text(json.dumps({"tool_calls": 12, "tokens_in": 100, "models": ["claude-opus-5-5"]}))
            r = self.repo.script("board", "set", "9.9", "done", "--metrics", str(mfile))
            self.assertEqual(r.returncode, 0, r.stderr)
        text = self.board_text()
        self.assertIn("tool_calls: 12", text)
        self.assertIn("claude-opus-5-5", text)

    def test_set_metrics_idempotent_overwrite(self):
        self.repo.write("docs/tasks/9.9/handoff.md", "# 9.9 handoff\nStatus: DONE\n\n## Decisions\nNone\n")
        with tempfile.TemporaryDirectory() as tmp:
            mfile = Path(tmp) / "metrics.json"
            mfile.write_text(json.dumps({"tool_calls": 12}))
            self.repo.script("board", "set", "9.9", "done", "--metrics", str(mfile))
            mfile.write_text(json.dumps({"tool_calls": 40}))
            r = self.repo.script("board", "set", "9.9", "review")
            self.assertEqual(r.returncode, 0, r.stderr)
            r = self.repo.script("board", "set", "9.9", "done", "--metrics", str(mfile))
            self.assertEqual(r.returncode, 0, r.stderr)
        text = self.board_text()
        self.assertIn("tool_calls: 40", text)
        self.assertNotIn("tool_calls: 12", text)

    def set_metrics(self, data):
        self.repo.write("docs/tasks/9.9/handoff.md", "# 9.9 handoff\nStatus: DONE\n\n## Decisions\nNone\n")
        with tempfile.TemporaryDirectory() as tmp:
            mfile = Path(tmp) / "metrics.json"
            mfile.write_text(json.dumps(data))
            return self.repo.script("board", "set", "9.9", "done", "--metrics", str(mfile))

    def test_set_metrics_accepts_full_collect_shape(self):
        r = self.set_metrics({"tool_calls": 1, "tokens_in": 2, "tokens_out": 3, "cache_read_tokens": 4,
                              "wall_time_seconds": 5, "models": ["claude-opus-5-5"], "builder_phases": 1,
                              "fix_rounds": 0, "human_questions": 0,
                              "findings": {"total": 1, "by_severity": {"LOW": 1},
                                           "by_status": {"fixed": 1, "open": 0}}})
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_set_metrics_rejects_unknown_key(self):
        r = self.set_metrics({"tool_calls": 1, "transcript": "x"})
        self.assertEqual(r.returncode, 1, r.stderr)
        self.assertNotIn("metrics:", self.board_text())

    def test_set_metrics_rejects_long_string(self):
        r = self.set_metrics({"models": ["x" * 500]})
        self.assertEqual(r.returncode, 1, r.stderr)
        self.assertNotIn("metrics:", self.board_text())

    def test_set_metrics_rejects_deep_nesting(self):
        r = self.set_metrics({"findings": {"by_status": {"fixed": {"deeper": [1]}}}})
        self.assertEqual(r.returncode, 1, r.stderr)

    def test_set_metrics_rejects_non_object(self):
        r = self.set_metrics([1, 2])
        self.assertEqual(r.returncode, 1, r.stderr)


class MetricsTable(RepoCase):
    tasks = [
        task_with("1.1", risk="high", model="plan:sonnet build:opus review:sonnet",
                  metrics={"tool_calls": 10, "tokens_in": 100, "tokens_out": 50,
                           "wall_time_seconds": 60, "fix_rounds": 1, "findings": {"total": 2}}),
        task_with("1.2", risk="high", model="build:opus",
                  metrics={"tool_calls": 20, "tokens_in": 200, "tokens_out": 100,
                           "wall_time_seconds": 120, "fix_rounds": 0, "findings": {"total": 0}}),
        task_with("2.1", risk=None, model="build:sonnet",
                  metrics={"tool_calls": 5, "tokens_in": 10, "tokens_out": 5,
                           "wall_time_seconds": 30, "fix_rounds": 0, "findings": {"total": 1}}),
        task_with("3.1", status="todo"),  # no metrics: excluded
    ]

    def test_groups_by_risk_and_build_model_by_default(self):
        r = self.repo.script("board", "metrics")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("high", r.stdout)
        self.assertIn("opus", r.stdout)
        self.assertIn("none", r.stdout)
        self.assertIn("sonnet", r.stdout)
        # two "high"/"opus" tasks (1.1, 1.2) are grouped together: n=2
        for line in r.stdout.splitlines():
            if line.startswith("high") and "opus" in line:
                self.assertTrue(line.split()[2] == "2", line)

    def test_by_milestone(self):
        r = self.repo.script("board", "metrics", "--by", "milestone")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("M1", r.stdout)
        self.assertIn("M2", r.stdout)

    def test_last_n_limits_rows(self):
        r = self.repo.script("board", "metrics", "--last", "1")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("sonnet", r.stdout)
        self.assertNotIn("1.1", r.stdout)

    def test_bad_by_rejected(self):
        r = self.repo.script("board", "metrics", "--by", "nonsense")
        self.assertNotEqual(r.returncode, 0)

    def test_no_metrics_message(self):
        r = self.repo.script("board", "metrics", "--last", "0")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("no done tasks", r.stdout)


class Next(RepoCase):
    tasks = [task("9.8", status="planning"), task("9.7", status="todo"), task("9.6", status="running")]

    def test_warns_without_plan(self):
        r = self.repo.script("board", "next")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("WARNING  9.8 is in planning but docs/tasks/9.8/plan.md does not exist", r.stdout)
        self.assertNotIn("9.6 is in", r.stdout)
        self.assertIn("9.7", r.stdout)

    def test_no_warning_with_plan(self):
        self.repo.write("docs/tasks/9.8/plan.md", "# plan\n")
        r = self.repo.script("board", "next")
        self.assertNotIn("WARNING", r.stdout)


if __name__ == "__main__":
    unittest.main()
