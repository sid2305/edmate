"""registry.py and `board.py registry` (task 0.18): agent registry blocks and the generated table.

Part 1 (Phase A): fixture-driven unit tests of the parser, role buckets, staleness and the
generator. Part 2 (Phase B) adds static checks on the real `.claude/agents/*.md` files.
"""
import datetime
import sys
import unittest

from helpers import HARNESS, REPO, RepoCase, require_tools, task

sys.path.insert(0, str(HARNESS / "skills" / "board"))
import registry  # noqa: E402


def setUpModule():
    require_tools()


def block(limitations="Misses async races.", misses="Skips error paths.",
          cost="not enough runs yet", reviewed="2026-10-21"):
    return (
        "## Agent registry\n"
        f"- Known limitations: {limitations}\n"
        f"- Typical misses: {misses}\n"
        f"- Average cost per run: {cost}\n"
        f"- Last reviewed: {reviewed}\n"
    )


def agent(name, registry_block=None, extra=""):
    front = f"---\nname: {name}\ndescription: test agent\n---\n\n## Edmate notes\n- x\n\n"
    return front + (block() if registry_block is None else registry_block) + extra


class ParseAgentBlock(unittest.TestCase):
    def test_good_block(self):
        got = registry.parse_agent_block(agent("planner"))
        self.assertEqual(got, {
            "known_limitations": "Misses async races.",
            "typical_misses": "Skips error paths.",
            "average_cost_per_run": "not enough runs yet",
            "last_reviewed": "2026-10-21",
        })

    def test_block_followed_by_another_section(self):
        got = registry.parse_agent_block(agent("planner", extra="\n## Later\n- Last reviewed: 1999-01-01\n"))
        self.assertEqual(got["last_reviewed"], "2026-10-21")

    def test_missing_block(self):
        self.assertIsNone(registry.parse_agent_block(agent("planner", registry_block="")))

    def test_empty_text(self):
        self.assertIsNone(registry.parse_agent_block(""))

    def test_missing_field(self):
        text = block().replace("- Typical misses: Skips error paths.\n", "")
        self.assertIsNone(registry.parse_agent_block(text))

    def test_empty_field(self):
        self.assertIsNone(registry.parse_agent_block(block(misses="")))
        self.assertIsNone(registry.parse_agent_block(block(misses="   ")))

    def test_duplicate_field(self):
        self.assertIsNone(registry.parse_agent_block(block() + "- Typical misses: again\n"))

    def test_bad_date(self):
        self.assertIsNone(registry.parse_agent_block(block(reviewed="21 Oct 2026")))
        self.assertIsNone(registry.parse_agent_block(block(reviewed="2026-13-01")))

    def test_fields_outside_the_section_do_not_count(self):
        text = "## Other\n" + block().split("\n", 1)[1]
        self.assertIsNone(registry.parse_agent_block(text))

    def test_unicode_and_pipes_kept(self):
        got = registry.parse_agent_block(block(limitations="Hindi/हिंदी | pipes"))
        self.assertEqual(got["known_limitations"], "Hindi/हिंदी | pipes")


def done(tid, model, metrics=None, status="done"):
    t = task(tid, status=status)
    t["model"] = model
    if metrics is not None:
        t["metrics"] = metrics
    return t


def m(tool_calls, tokens_in=0, tokens_out=0, wall=0):
    return {"tool_calls": tool_calls, "tokens_in": tokens_in, "tokens_out": tokens_out, "wall_time_seconds": wall}


class RoleModel(unittest.TestCase):
    def test_tokens(self):
        s = "plan:sonnet build:opus-5.5/medium fix:opus review:sonnet"
        self.assertEqual(registry.role_model(s, "plan"), "sonnet")
        self.assertEqual(registry.role_model(s, "build"), "opus-5.5/medium")
        self.assertEqual(registry.role_model(s, "review"), "sonnet")

    def test_missing_or_none(self):
        self.assertEqual(registry.role_model("plan:sonnet", "build"), "unknown")
        self.assertEqual(registry.role_model(None, "build"), "unknown")
        self.assertEqual(registry.role_model("rebuild:opus", "build"), "unknown")


class RoleBuckets(unittest.TestCase):
    def test_averages_per_role(self):
        board = {"tasks": [
            done("1.1", "plan:sonnet build:opus review:sonnet", m(10, 100, 20, 60)),
            done("1.2", "build:sonnet review:sonnet", m(30, 300, 40, 120)),
            done("1.3", "plan:sonnet build:opus", m(2)),
        ]}
        b = registry.role_buckets(board)
        self.assertEqual(b["plan"]["n"], 2)
        self.assertEqual(b["plan"]["tool_calls"], 6)
        self.assertEqual(b["build"]["n"], 3)
        self.assertEqual(b["build"]["tool_calls"], 14)
        self.assertEqual(b["review"]["n"], 2)
        self.assertEqual(b["review"]["tool_calls"], 20)
        self.assertEqual(b["review"]["tokens_in"], 200)
        self.assertEqual(b["review"]["tokens_out"], 30)
        self.assertEqual(b["review"]["wall_time_seconds"], 90)

    def test_skips_not_done_no_metrics_and_no_token(self):
        board = {"tasks": [
            done("1.1", "build:opus", m(10), status="review"),
            done("1.2", "build:opus"),
            done("1.3", None, m(99)),
            done("1.4", "fix:opus", m(99)),
            done("1.5", "build:opus", m(4)),
        ]}
        b = registry.role_buckets(board)
        self.assertEqual(b["build"], {"n": 1, "tool_calls": 4, "tokens_in": 0, "tokens_out": 0, "wall_time_seconds": 0})

    def test_role_with_no_runs_is_none(self):
        b = registry.role_buckets({"tasks": [done("1.1", "build:opus", m(5))]})
        self.assertIsNone(b["plan"])
        self.assertIsNone(b["review"])
        self.assertEqual(set(b), {"plan", "build", "review"})

    def test_empty_board(self):
        self.assertEqual(registry.role_buckets({"tasks": []}), {"plan": None, "build": None, "review": None})

    def test_missing_metric_keys_count_as_zero(self):
        b = registry.role_buckets({"tasks": [done("1.1", "build:opus", {"tool_calls": 8}),
                                             done("1.2", "build:opus", {"tokens_in": 10})]})
        self.assertEqual(b["build"]["tool_calls"], 4)
        self.assertEqual(b["build"]["tokens_in"], 5)


class IsStale(unittest.TestCase):
    today = datetime.date(2026, 10, 21)

    def test_boundaries(self):
        self.assertFalse(registry.is_stale("2026-10-21", self.today))
        self.assertFalse(registry.is_stale("2026-08-22", self.today))  # exactly 60 days
        self.assertTrue(registry.is_stale("2026-08-21", self.today))   # 61 days
        self.assertFalse(registry.is_stale("2026-12-01", self.today))  # future is not stale

    def test_custom_window_and_date_object(self):
        self.assertTrue(registry.is_stale(datetime.date(2026, 10, 10), self.today, max_days=10))
        self.assertFalse(registry.is_stale(datetime.date(2026, 10, 11), self.today, max_days=10))

    def test_unparseable_is_stale(self):
        for bad in ("", None, "soon", "2026-02-30"):
            self.assertTrue(registry.is_stale(bad, self.today), bad)


class Render(unittest.TestCase):
    board = {"tasks": [done("1.1", "plan:sonnet build:opus review:sonnet", m(10, 1000, 200, 60))]}

    def test_table_rows_sorted_and_escaped(self):
        out = registry.render({
            "tdd-guide": agent("tdd-guide", block(limitations="a | b")),
            "planner": agent("planner"),
        }, self.board)
        self.assertTrue(out.endswith("\n"))
        self.assertLess(out.index("| planner |"), out.index("| tdd-guide |"))
        self.assertIn("a \\| b", out)
        self.assertIn("2026-10-21", out)
        # role metrics table from board metrics
        self.assertIn("| build | 1 | 10 | 1000 | 200 | 60 |", out)

    def test_deterministic(self):
        files = {"planner": agent("planner"), "code-reviewer": agent("code-reviewer")}
        self.assertEqual(registry.render(files, self.board), registry.render(dict(reversed(files.items())), self.board))

    def test_no_runs_role_says_so(self):
        out = registry.render({"planner": agent("planner")}, {"tasks": []})
        self.assertIn("not enough runs yet", out)

    def test_missing_block_raises_naming_file(self):
        with self.assertRaises(ValueError) as cm:
            registry.render({"planner": agent("planner"), "broken": agent("broken", registry_block="")}, self.board)
        self.assertIn("broken", str(cm.exception))
        self.assertNotIn("planner", str(cm.exception))

    def test_no_agents_raises(self):
        with self.assertRaises(ValueError):
            registry.render({}, self.board)


class BoardRegistryCommand(RepoCase):
    tasks = [done("9.9", "plan:sonnet build:opus review:sonnet", m(12, 500, 50, 30))]

    def out_path(self):
        return self.repo.root / "docs/agents/registry.md"

    def test_regenerates_idempotently(self):
        self.repo.write_agent("planner", agent("planner"))
        self.repo.write_agent("code-reviewer", agent("code-reviewer"))
        r1 = self.repo.script("board", "registry")
        self.assertEqual(r1.returncode, 0, r1.stdout + r1.stderr)
        first = self.out_path().read_bytes()
        self.assertIn(b"| code-reviewer |", first)
        self.assertIn(b"| planner |", first)
        r2 = self.repo.script("board", "registry")
        self.assertEqual(r2.returncode, 0, r2.stdout + r2.stderr)
        self.assertEqual(self.out_path().read_bytes(), first)

    def test_missing_block_fails_loudly_and_writes_nothing(self):
        self.repo.write_agent("planner", agent("planner"))
        self.repo.write_agent("code-reviewer", agent("code-reviewer", registry_block=""))
        r = self.repo.script("board", "registry")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("code-reviewer", r.stderr)
        self.assertIn("Agent registry", r.stderr)
        self.assertFalse(self.out_path().exists())

    def test_stale_existing_output_not_overwritten_on_failure(self):
        self.repo.write_agent("planner", agent("planner"))
        self.assertEqual(self.repo.script("board", "registry").returncode, 0)
        before = self.out_path().read_bytes()
        self.repo.write_agent("planner", agent("planner", registry_block=block(reviewed="bad")))
        self.assertNotEqual(self.repo.script("board", "registry").returncode, 0)
        self.assertEqual(self.out_path().read_bytes(), before)

    def test_no_agent_files_fails(self):
        r = self.repo.script("board", "registry")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no agent files", r.stderr)

    def test_leaves_no_bytecode_behind(self):
        # A __pycache__ beside board.py would be committed by `git add -A` and flagged as a
        # risky .claude/** change by the merge gate.
        self.repo.write_agent("planner", agent("planner"))
        self.assertEqual(self.repo.script("board", "registry").returncode, 0)
        self.assertEqual(list(self.repo.root.rglob("__pycache__")), [])

    def test_metrics_command_unchanged(self):
        r = self.repo.script("board", "metrics")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("opus", r.stdout)


# --- Part 2 (Phase B): static checks on the real repo -------------------------------------

REAL_AGENTS = REPO / ".claude" / "agents"
REAL_TABLE = REPO / "docs" / "agents" / "registry.md"


def real_agent_files():
    return {p.stem: p.read_text() for p in sorted(REAL_AGENTS.glob("*.md"))}


def agents_section(text):
    """The generated table's `## Agents` section only. The cost-per-role section follows the
    board's metrics, which closeouts update on main, so it is not pinned here."""
    start = text.index("## Agents")
    end = text.index("## Cost per role")
    return text[start:end]


class RealAgentBlocks(unittest.TestCase):
    def test_agents_exist(self):
        self.assertGreater(len(real_agent_files()), 0)

    def test_every_agent_has_a_fresh_complete_block(self):
        today = datetime.date.today()
        for name, text in real_agent_files().items():
            with self.subTest(agent=name):
                got = registry.parse_agent_block(text)
                self.assertIsNotNone(got, f".claude/agents/{name}.md: missing or malformed "
                                          "'## Agent registry' block")
                for field, value in got.items():
                    self.assertTrue(value.strip(), f"{name}: empty {field}")
                self.assertFalse(registry.is_stale(got["last_reviewed"], today),
                                 f".claude/agents/{name}.md: Last reviewed {got['last_reviewed']} "
                                 f"is more than {registry.STALE_DAYS} days old; re-review it")

    def test_every_agent_with_a_role_is_a_real_file(self):
        self.assertLessEqual(set(registry.AGENT_ROLES), set(real_agent_files()))

    def test_committed_table_matches_agent_blocks(self):
        self.assertTrue(REAL_TABLE.is_file(), "docs/agents/registry.md missing; run "
                                              "`python3 .claude/skills/board/board.py registry`")
        fresh = registry.render(real_agent_files(), {"tasks": []})
        self.assertEqual(agents_section(REAL_TABLE.read_text()), agents_section(fresh),
                         "docs/agents/registry.md is stale; run "
                         "`python3 .claude/skills/board/board.py registry`")

    def test_team_lead_skill_links_to_table(self):
        skill = (REPO / ".claude" / "skills" / "team-lead" / "SKILL.md").read_text()
        self.assertIn("docs/agents/registry.md", skill)


if __name__ == "__main__":
    unittest.main()
