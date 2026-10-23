"""metrics.py: turning one task's transcript(s) into board-safe numbers.

Uses a synthetic fixture JSONL (no real transcript text, no /Users/ paths, no secrets) copied
into a throwaway temp dir and pointed to via EDMATE_TRANSCRIPTS_DIR, so the real `~/.claude` is
never touched.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
import unittest.mock
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

    def test_findings_with_multiword_status_bracket(self):
        (self.root / "docs" / "tasks" / TASK_ID / "review.md").write_text(
            "# review\n- [LOW] [deferred 0.13a] a.ts:1 -- x\n- [MEDIUM] [fixed] b.ts:2 -- y\n"
        )
        findings = self.collect()["findings"]
        self.assertEqual(findings["total"], 2)
        self.assertEqual(findings["by_severity"], {"LOW": 1, "MEDIUM": 1})
        self.assertEqual(findings["by_status"]["deferred"], 1)
        self.assertEqual(findings["by_status"]["fixed"], 1)

    def test_skips_symlinked_transcripts(self):
        outside = Path(self.tmp.name) / "outside"
        outside.mkdir()
        shutil.copy(FIXTURE, outside / "elsewhere.jsonl")
        (self.transcripts / "link.jsonl").symlink_to(outside / "elsewhere.jsonl")
        entries = list(metrics.iter_entries(self.transcripts, BRANCH, TASK_ID))
        self.assertEqual(len(entries), 4)

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


class CwdBoundary(unittest.TestCase):
    """Task "0.1" must not pick up a cwd for "0.16", and the reverse."""

    def entries(self, task_id, branch, lines):
        with tempfile.TemporaryDirectory(prefix="edmate-metrics-") as tmp:
            (Path(tmp) / "s.jsonl").write_text("\n".join(json.dumps(x) for x in lines))
            return list(metrics.iter_entries(tmp, branch, task_id))

    def test_short_id_does_not_match_longer_id_cwd(self):
        lines = [{"gitBranch": None, "cwd": "/repo/.claude/worktrees/agent-0.16-work"}]
        self.assertEqual(self.entries("0.1", "m0/0.1-x", lines), [])

    def test_long_id_does_not_match_shorter_id_cwd(self):
        lines = [{"gitBranch": None, "cwd": "/repo/.claude/worktrees/agent-0.1-work"}]
        self.assertEqual(self.entries("0.16", "m0/0.16-x", lines), [])

    def test_id_matches_at_boundaries(self):
        lines = [
            {"gitBranch": None, "cwd": "/repo/wt/agent-0.1-work"},
            {"gitBranch": None, "cwd": "/repo/wt/0.1"},
            {"gitBranch": None, "cwd": "/repo/wt/x_0.1/y"},
            {"gitBranch": None, "cwd": "/repo/wt/v10.1"},
        ]
        self.assertEqual(len(self.entries("0.1", "m0/0.1-x", lines)), 3)

    def test_git_branch_is_exact(self):
        lines = [{"gitBranch": "m0/0.16-x"}, {"gitBranch": "m0/0.1-x"}]
        self.assertEqual(len(self.entries("0.1", "m0/0.1-x", lines)), 1)


BOARD_IDS = frozenset({"0.1", "0.2", "0.16", "0.16a", "5.7", "5.7b", "7.7"})
SUBAGENT_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "transcripts-subagents"


class SubagentTranscripts(unittest.TestCase):
    """Subagent transcripts live in `<dir>/<session>/subagents/*.jsonl`; a whole file counts for
    a task when its prompt names the task or any entry is on the task's (or work-) branch."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="edmate-metrics-")
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name) / "transcripts"
        shutil.copytree(SUBAGENT_FIXTURE, self.dir)
        self.root = Path(self.tmp.name) / "repo"
        self.root.mkdir()

    def tools(self, task_id, branch):
        n = 0
        for e in metrics.iter_entries(self.dir, branch, task_id, board_ids=BOARD_IDS):
            content = (e.get("message") or {}).get("content")
            if isinstance(content, list):
                n += sum(1 for b in content if isinstance(b, dict) and b.get("type") == "tool_use")
        return n

    def test_builder_on_work_branch_counts_whole_file_for_016(self):
        # lead 1 (m0/0.16 entry) + builder 2 (on main before checkout) + 1 (on work-0.16f)
        self.assertEqual(self.tools("0.16", "m0/0.16-agent-metrics"), 4)

    def test_reviewer_prompt_counts_for_01_only(self):
        # lead 1 (m0/0.1 entry) + reviewer 2 (prompt says "task 0.1")
        self.assertEqual(self.tools("0.1", "m0/0.1-repo-setup"), 3)

    def test_unrelated_task_gets_nothing(self):
        self.assertEqual(self.tools("0.2", "m0/0.2-x"), 0)

    def test_collect_counts_subagents_without_leaking_text(self):
        import os

        os.environ["EDMATE_TRANSCRIPTS_DIR"] = str(self.dir)
        try:
            result = metrics.collect(self.root, "0.16", "m0/0.16-agent-metrics", board_ids=BOARD_IDS)
        finally:
            os.environ.pop("EDMATE_TRANSCRIPTS_DIR", None)
        self.assertEqual(result["tool_calls"], 4)
        self.assertEqual(result["models"], ["claude-opus-5-5", "claude-sonnet-5"])
        dumped = json.dumps(result)
        self.assertNotIn(MARKER, dumped)
        self.assertNotIn("Build the metrics", dumped)

    def test_skips_symlinked_subagent_file_and_session_dir(self):
        outside = Path(self.tmp.name) / "outside"
        shutil.copytree(SUBAGENT_FIXTURE / "session-0001", outside)
        (self.dir / "session-0001" / "subagents" / "agent-link.jsonl").symlink_to(
            outside / "subagents" / "agent-b0001.jsonl"
        )
        (self.dir / "session-link").symlink_to(outside, target_is_directory=True)
        self.assertEqual(self.tools("0.16", "m0/0.16-agent-metrics"), 4)

    def test_skips_symlinked_subagents_dir(self):
        outside = Path(self.tmp.name) / "outside-sub"
        shutil.copytree(SUBAGENT_FIXTURE / "session-0001" / "subagents", outside)
        (self.dir / "session-0002").mkdir()
        (self.dir / "session-0002" / "subagents").symlink_to(outside, target_is_directory=True)
        self.assertEqual(self.tools("0.16", "m0/0.16-agent-metrics"), 4)


class SubagentMatching(unittest.TestCase):
    """Prompt and branch boundaries for whole-file attribution."""

    def write(self, lines):
        self.tmp = tempfile.TemporaryDirectory(prefix="edmate-metrics-")
        self.addCleanup(self.tmp.cleanup)
        sub = Path(self.tmp.name) / "s1" / "subagents"
        sub.mkdir(parents=True)
        (sub / "agent-x.jsonl").write_text("\n".join(json.dumps(x) for x in lines))
        return self.tmp.name

    def prompt(self, text, branch="main"):
        return [
            {"type": "user", "gitBranch": branch, "message": {"role": "user", "content": text}},
            {"type": "assistant", "gitBranch": branch, "message": {"role": "assistant", "content": []}},
        ]

    def count(self, task_id, lines, branch=None, board_ids=BOARD_IDS):
        d = self.write(lines)
        return len(list(metrics.iter_entries(d, branch or f"m0/{task_id}-x", task_id, board_ids=board_ids)))

    def test_prompt_task_id_matches(self):
        self.assertEqual(self.count("0.16", self.prompt("Build Edmate task 0.16 (metrics).")), 2)
        self.assertEqual(self.count("0.16", self.prompt("Review Task 0.16, please")), 2)
        self.assertEqual(self.count("0.16", self.prompt("for task 0.16")), 2)

    def test_prompt_short_id_does_not_match_longer(self):
        self.assertEqual(self.count("0.1", self.prompt("Build Edmate task 0.16.")), 0)
        self.assertEqual(self.count("0.1", self.prompt("Build task 0.1.2 now")), 0)
        self.assertEqual(self.count("0.1", self.prompt("Build task 10.1 now")), 0)

    def test_prompt_long_id_does_not_match_shorter(self):
        self.assertEqual(self.count("0.16", self.prompt("Build Edmate task 0.1.")), 0)

    def test_prompt_id_without_task_word_does_not_match(self):
        self.assertEqual(self.count("0.16", self.prompt("see 0.16 notes")), 0)

    def test_only_first_user_message_is_the_prompt(self):
        lines = self.prompt("Build something.") + [
            {"type": "user", "gitBranch": "main", "message": {"role": "user", "content": "task 0.16"}}
        ]
        self.assertEqual(self.count("0.16", lines), 0)

    def test_prompt_as_text_blocks(self):
        lines = self.prompt([{"type": "text", "text": "Build Edmate task 0.16."}])
        self.assertEqual(self.count("0.16", lines), 2)

    def test_work_branch_with_and_without_letter(self):
        for b in ("work-5.7", "work-5.7c"):
            self.assertEqual(self.count("5.7", self.prompt("x", branch=b)), 2, b)

    def test_prompt_parent_id_does_not_match_lettered_sibling(self):
        self.assertEqual(self.count("0.16", self.prompt("Review Edmate task 0.16a now")), 0)
        self.assertEqual(self.count("0.16", self.prompt("Review Edmate task 0.16A now")), 0)
        self.assertEqual(self.count("0.16a", self.prompt("Review Edmate task 0.16a now")), 2)
        self.assertEqual(self.count("0.16", self.prompt("Review Edmate task 0.16. Thanks")), 2)

    def test_work_branch_of_lettered_board_task_not_counted_for_parent(self):
        self.assertEqual(self.count("0.16", self.prompt("x", branch="work-0.16a")), 0)
        self.assertEqual(self.count("5.7", self.prompt("x", branch="work-5.7b")), 0)
        self.assertEqual(self.count("5.7b", self.prompt("x", branch="work-5.7b")), 2)

    def test_work_branch_phase_letter_counts_when_not_a_board_id(self):
        self.assertEqual(self.count("7.7", self.prompt("x", branch="work-7.7a")), 2)
        self.assertEqual(self.count("7.7", self.prompt("x", branch="work-7.7b")), 2)

    def test_no_board_falls_back_to_exact_work_branch(self):
        for ids in (None, frozenset()):
            self.assertEqual(self.count("7.7", self.prompt("x", branch="work-7.7a"), board_ids=ids), 0)
            self.assertEqual(self.count("7.7", self.prompt("x", branch="work-7.7"), board_ids=ids), 2)

    def test_work_branch_boundaries(self):
        for b in ("work-5.7bc", "work-5.71", "work-5.7.1", "work-5.7B", "xwork-5.7"):
            self.assertEqual(self.count("5.7", self.prompt("x", branch=b)), 0, b)
        self.assertEqual(self.count("0.1", self.prompt("x", branch="work-0.16f")), 0)

    def test_task_branch_matches_whole_file(self):
        lines = self.prompt("x") + [{"type": "assistant", "gitBranch": "m0/5.7-x"}]
        self.assertEqual(self.count("5.7", lines), 3)

    def test_no_task_id_only_branch(self):
        d = self.write(self.prompt("Build task 5.7", branch="main"))
        self.assertEqual(list(metrics.iter_entries(d, "m0/5.7-x")), [])

    def test_bad_lines_and_non_dict_content_are_safe(self):
        d = self.write([{"type": "user", "message": "not a dict"}, {"gitBranch": "work-5.7"}])
        with open(Path(d) / "s1" / "subagents" / "agent-x.jsonl", "a") as fh:
            fh.write("\nnot json\n")
        self.assertEqual(len(list(metrics.iter_entries(d, "m0/5.7-x", "5.7"))), 2)


class BoardIds(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="edmate-metrics-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_reads_ids_from_board(self):
        (self.root / "docs" / "board").mkdir(parents=True)
        (self.root / "docs" / "board" / "tasks.yaml").write_text(
            "decisions:\n  x:\n    id: nope\ntasks:\n- id: '0.16'\n  title: a\n- id: \"0.16a\"\n- id: 7.7\n"
        )
        self.assertEqual(metrics.read_board_ids(self.root), frozenset({"0.16", "0.16a", "7.7"}))

    def test_missing_board_is_none(self):
        self.assertIsNone(metrics.read_board_ids(self.root))

    def test_unreadable_board_is_none(self):
        (self.root / "docs" / "board" / "tasks.yaml").mkdir(parents=True)  # a dir, not a file
        self.assertIsNone(metrics.read_board_ids(self.root))

    def test_collect_reads_board_when_ids_not_given(self):
        import os

        (self.root / "docs" / "board").mkdir(parents=True)
        (self.root / "docs" / "board" / "tasks.yaml").write_text("- id: '0.16'\n- id: '0.16a'\n")
        sub = self.root / "t" / "s1" / "subagents"
        sub.mkdir(parents=True)
        line = {"gitBranch": "work-0.16a", "message": {"role": "assistant", "content": [{"type": "tool_use"}]}}
        (sub / "a.jsonl").write_text(json.dumps(line))
        os.environ["EDMATE_TRANSCRIPTS_DIR"] = str(self.root / "t")
        try:
            self.assertEqual(metrics.collect(self.root, "0.16", "m0/0.16-x")["tool_calls"], 0)
            self.assertEqual(metrics.collect(self.root, "0.16a", "m0/0.16a-x")["tool_calls"], 1)
        finally:
            os.environ.pop("EDMATE_TRANSCRIPTS_DIR", None)


class RepoRootResolution(unittest.TestCase):
    """collect(".", ...) must resolve repo_root before deriving the transcript slug, so a
    relative "." root finds the same transcripts as the absolute root (and isn't silently
    all-zero)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="edmate-metrics-root-")
        self.addCleanup(self.tmp.cleanup)
        self.fake_home = Path(self.tmp.name) / "home"
        self.fake_home.mkdir()
        self.root = Path(self.tmp.name) / "repo"
        (self.root / "docs" / "tasks" / TASK_ID).mkdir(parents=True)

        home_patch = unittest.mock.patch.object(Path, "home", lambda: self.fake_home)
        home_patch.start()
        self.addCleanup(home_patch.stop)

        slug = str(self.root.resolve()).replace(os.sep, "-")
        transcripts = self.fake_home / ".claude" / "projects" / slug
        transcripts.mkdir(parents=True)
        shutil.copy(FIXTURE, transcripts / "session-a.jsonl")

        self.old_cwd = os.getcwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, self.old_cwd)

    def test_transcripts_dir_matches_for_dot_and_absolute(self):
        self.assertEqual(metrics.transcripts_dir("."), metrics.transcripts_dir(self.root))

    def test_collect_dot_matches_absolute_and_is_non_zero(self):
        dot_result = metrics.collect(".", TASK_ID, BRANCH)
        abs_result = metrics.collect(self.root, TASK_ID, BRANCH)
        self.assertEqual(dot_result, abs_result)
        self.assertGreater(dot_result["tool_calls"], 0)


if __name__ == "__main__":
    unittest.main()
