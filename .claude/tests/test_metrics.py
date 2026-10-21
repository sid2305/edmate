"""metrics.py: turning one task's transcript(s) into board-safe numbers.

Uses a synthetic fixture JSONL (no real transcript text, no /Users/ paths, no secrets) copied
into a throwaway temp dir and pointed to via EDMATE_TRANSCRIPTS_DIR, so the real `~/.claude` is
never touched.
"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

TEAM_LEAD = Path(__file__).resolve().parents[1] / "skills" / "team-lead"
sys.path.insert(0, str(TEAM_LEAD))
import metrics  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "transcript-sample.jsonl"
TASK_ID = "9.9"
BRANCH = "m9/9.9-x"
MARKER = "EDMATE_TEST_MARKER_DO_NOT_LEAK_7f3a9c"


class MetricsCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="edmate-metrics-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "repo"
        self.transcripts = Path(self.tmp.name) / "transcripts"
        self.transcripts.mkdir(parents=True)
        shutil.copy(FIXTURE, self.transcripts / "session-a.jsonl")
        (self.root / "docs" / "tasks" / TASK_ID).mkdir(parents=True)

    def collect(self):
        import os

        old = os.environ.get("EDMATE_TRANSCRIPTS_DIR")
        os.environ["EDMATE_TRANSCRIPTS_DIR"] = str(self.transcripts)
        try:
            return metrics.collect(self.root, TASK_ID, BRANCH)
        finally:
            if old is None:
                os.environ.pop("EDMATE_TRANSCRIPTS_DIR", None)
            else:
                os.environ["EDMATE_TRANSCRIPTS_DIR"] = old


class Collect(MetricsCase):
    def test_transcripts_dir_uses_env_override(self):
        import os

        os.environ["EDMATE_TRANSCRIPTS_DIR"] = "/some/fixture/dir"
        try:
            self.assertEqual(metrics.transcripts_dir(self.root), Path("/some/fixture/dir"))
        finally:
            os.environ.pop("EDMATE_TRANSCRIPTS_DIR", None)

    def test_matches_by_git_branch_and_falls_back_to_cwd(self):
        entries = list(metrics.iter_entries(self.transcripts, BRANCH, TASK_ID))
        # 3 gitBranch matches + 1 cwd fallback match (gitBranch null, cwd contains "9.9")
        self.assertEqual(len(entries), 4)

    def test_excludes_other_branch_and_unrelated_cwd(self):
        entries = list(metrics.iter_entries(self.transcripts, BRANCH, TASK_ID))
        branches = {e.get("gitBranch") for e in entries}
        self.assertNotIn("m8/8.8-y", branches)
        cwds = {e.get("cwd") for e in entries}
        self.assertNotIn("/repo/.claude/worktrees/agent-unrelated", cwds)

    def test_sums_tool_calls_and_tokens(self):
        result = self.collect()
        self.assertEqual(result["tool_calls"], 4)  # 1 + 2 + 1
        self.assertEqual(result["tokens_in"], 310)  # 100 + 200 + 10
        self.assertEqual(result["tokens_out"], 135)  # 50 + 80 + 5
        self.assertEqual(result["cache_read_tokens"], 30)  # 20 + 10 + 0

    def test_wall_time_from_timestamps(self):
        result = self.collect()
        # earliest 09:57:00, latest 10:10:00 across matched entries = 13 minutes
        self.assertEqual(result["wall_time_seconds"], 13 * 60)

    def test_models_sorted_distinct(self):
        result = self.collect()
        self.assertEqual(result["models"], ["claude-haiku-5", "claude-opus-5-5", "claude-sonnet-5"])

    def test_builder_phases_from_plan_headings(self):
        (self.root / "docs" / "tasks" / TASK_ID / "plan.md").write_text(
            "# plan\n## Phase A\ntext\n## Phase B\ntext\n"
        )
        self.assertEqual(self.collect()["builder_phases"], 2)

    def test_builder_phases_defaults_to_one_without_plan(self):
        self.assertEqual(self.collect()["builder_phases"], 1)

    def test_fix_rounds_from_handoff_headings(self):
        (self.root / "docs" / "tasks" / TASK_ID / "handoff.md").write_text(
            "# handoff\n## Fix round 1\nx\n## Fix round 2\ny\n"
        )
        self.assertEqual(self.collect()["fix_rounds"], 2)

    def test_fix_rounds_zero_without_handoff(self):
        self.assertEqual(self.collect()["fix_rounds"], 0)

    def test_findings_parsed_from_review(self):
        (self.root / "docs" / "tasks" / TASK_ID / "review.md").write_text(
            "# review\n- [CRITICAL] [open] a.ts:1 -- x\n- [LOW] [fixed] b.ts:2 -- y\n"
            "- [LOW] [fixed] c.ts:3 -- z\nnot a finding line\n"
        )
        findings = self.collect()["findings"]
        self.assertEqual(findings["total"], 3)
        self.assertEqual(findings["by_severity"], {"CRITICAL": 1, "LOW": 2})
        self.assertEqual(findings["by_status"]["fixed"], 2)
        self.assertEqual(findings["by_status"]["open"], 1)

    def test_human_questions_zero_without_blockers_file(self):
        self.assertEqual(self.collect()["human_questions"], 0)

    def test_human_questions_counts_mentions(self):
        (self.root / ".claude").mkdir(exist_ok=True)
        (self.root / ".claude" / "blockers.md").write_text(
            f"## 9.9 something\n\n## 9.9 another thing\n\n## 8.8 unrelated\n"
        )
        self.assertEqual(self.collect()["human_questions"], 2)

    def test_no_transcript_text_leaks(self):
        result = self.collect()
        self.assertNotIn(MARKER, json.dumps(result))


if __name__ == "__main__":
    unittest.main()
