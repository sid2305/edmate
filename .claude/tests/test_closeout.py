"""closeout.py: one command to log a merged task's decisions, mark it done, and clean up its
git worktree/branch. Fixture simulates a PR already merged into main (handoff/review committed
there), same style as test_board.py and test_merge_gate.py's RepoCase."""
import unittest

from helpers import RepoCase, git, require_tools, task

HANDOFF = """# 9.9 handoff
Status: DONE

## Decisions
### 18 Oct 2026 · 9.9 Thing · decided by lead · risk: low
Decided: Keep it simple.
Why: x.
"""

REVIEW = "# 9.9 review — APPROVE\nReviewers: code-reviewer\n"


def setUpModule():
    require_tools()


class CloseoutCase(RepoCase):
    tasks = [task("9.9", status="review", branch="m9/9.9-x")]

    def setUp(self):
        super().setUp()
        # Simulate a merged PR: the task branch exists, carries the handoff/review, and is
        # merged into main (so docs/tasks/9.9/handoff.md is on main, as closeout expects).
        # Edmate always merges with `gh pr merge --squash`, so the branch tip is never an
        # ancestor of main -- use a real squash merge here (not --no-ff) so the ancestry
        # trap can't mask a broken branch_is_merged().
        git(self.repo.root, "checkout", "-q", "-b", "m9/9.9-x")
        self.repo.write("docs/tasks/9.9/handoff.md", HANDOFF)
        self.repo.write("docs/tasks/9.9/review.md", REVIEW)
        self.repo.commit("9.9 work")
        git(self.repo.root, "checkout", "-q", "main")
        git(self.repo.root, "merge", "-q", "--squash", "m9/9.9-x")
        git(self.repo.root, "commit", "-q", "--no-verify", "-m", "squash merge 9.9")

    def closeout(self, *args):
        r = self.repo.script("closeout", *args)
        return r.returncode, r.stdout + r.stderr

    def board_text(self):
        return (self.repo.root / "docs/board/tasks.yaml").read_text()

    def log_text(self):
        return (self.repo.root / "docs/decisions/log.md").read_text()


class Basics(CloseoutCase):
    def test_appends_decisions_and_marks_done(self):
        code, out = self.closeout("9.9")
        self.assertEqual(code, 0, out)
        self.assertIn("Keep it simple.", self.log_text())
        self.assertIn("status: done", self.board_text())

    def test_idempotent_no_duplicate_entry(self):
        self.assertEqual(self.closeout("9.9")[0], 0)
        code, out = self.closeout("9.9")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.log_text().count("9.9 Thing"), 1)

    def test_removes_worktree_and_deletes_merged_branch(self):
        wt_dir = self.repo.root.parent / "wt-9.9"
        git(self.repo.root, "worktree", "add", "-q", str(wt_dir), "m9/9.9-x")
        code, out = self.closeout("9.9")
        self.assertEqual(code, 0, out)
        self.assertFalse(wt_dir.exists())
        self.assertEqual(git(self.repo.root, "branch", "--list", "m9/9.9-x"), "")

    def test_no_worktree_still_deletes_merged_branch(self):
        code, out = self.closeout("9.9")
        self.assertEqual(code, 0, out)
        self.assertEqual(git(self.repo.root, "branch", "--list", "m9/9.9-x"), "")

    def test_refuses_to_delete_unmerged_branch(self):
        git(self.repo.root, "checkout", "-q", "-b", "m9/9.9-x-unmerged", "main")
        self.repo.write("docs/tasks/9.9/extra.txt", "x\n")
        self.repo.commit("more work, not merged")
        git(self.repo.root, "checkout", "-q", "main")
        board = self.board_text().replace("m9/9.9-x", "m9/9.9-x-unmerged")
        self.repo.write("docs/board/tasks.yaml", board)
        code, out = self.closeout("9.9")
        self.assertEqual(code, 0, out)
        self.assertIn("unmerged commits", out)
        self.assertNotEqual(git(self.repo.root, "branch", "--list", "m9/9.9-x-unmerged"), "")

    def test_rejects_task_id_with_path_characters(self):
        for bad in ("../etc/passwd", "9.9/../x", "a/b", "a\\b"):
            code, out = self.closeout(bad)
            self.assertEqual(code, 1, out)
            self.assertIn("bad task id", out)

    def test_board_not_done_when_decisions_missing_from_log(self):
        # If board.py refuses (e.g. decisions not actually written), closeout reports the
        # refusal and exits non-zero, same as board.py itself would.
        self.repo.write("docs/tasks/9.9/handoff.md", "# 9.9 handoff\nStatus: DONE\n")
        code, out = self.closeout("9.9")
        self.assertEqual(code, 1, out)
        self.assertIn("## Decisions", out)
        self.assertNotIn("status: done", self.board_text())


if __name__ == "__main__":
    unittest.main()
