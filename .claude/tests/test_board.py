"""board.py: `set <id> done` decision checks, `next` plan warnings, other statuses."""
import unittest

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

    def test_other_statuses_unchanged(self):
        r = self.repo.script("board", "set", "9.7", "running", "--branch", "m9/9.7-y", "--model", "build:opus")
        self.assertEqual(r.returncode, 0, r.stderr)
        text = self.board_text()
        self.assertIn("m9/9.7-y", text)
        self.assertIn("build:opus", text)
        self.assertEqual(self.repo.script("board", "set", "9.7", "review").returncode, 0)

    def test_bad_status(self):
        self.assertNotEqual(self.repo.script("board", "set", "9.7", "finished").returncode, 0)


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
