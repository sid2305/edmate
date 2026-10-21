"""digest.py and `board.py digest` (task 0.19): the decision-log digest.

Part 1 (Phase A): fixture-driven unit tests of the parser and renderer, and of `board.py digest`'s
idempotent regeneration. Part 2 (Phase B) adds static checks on the real
`docs/decisions/log.md`, `docs/decisions/digest.md` and `docs/lessons.md`.
"""
import sys
import unittest

from helpers import HARNESS, RepoCase, require_tools

sys.path.insert(0, str(HARNESS / "skills" / "board"))
import digest  # noqa: E402


def setUpModule():
    require_tools()


HEADER = "# Edmate decision log\n\nIntro with a **risk: high** legend line.\n"

E_NEW = ("### 21 Oct 2026 · New rule replaces old · decided by you · risk: high\n"
         "- Decided: the new rule.\n"
         "- Supersedes: 19 Oct 2026 · Old rule · decided by lead · risk: high\n")
E_MED = ("### 20 Oct 2026 · A middling choice · decided by lead · risk: medium\n"
         "Decided: something.\n")
E_BODY_HIGH = ("### Fix round 1 — a body-marked entry\n"
               "Decided: fixed it.\n"
               "- risk: high (a risky path)\n")
E_LOW = ("### 19 Oct 2026 · A small thing · decided by builder\n"
         "Decided: x.\n"
         "risk: low\n")
E_OLD = ("### 19 Oct 2026 · Old rule · decided by lead · risk: high\n"
         "- Decided: the old rule.\n")


def log(*entries, header=HEADER):
    return header + "\n---\n\n" + "\n\n---\n\n".join(e.rstrip("\n") for e in entries) + "\n"


FIXTURE_LOG = log(E_NEW, E_MED, E_BODY_HIGH, E_LOW, E_OLD)
H_NEW = "21 Oct 2026 · New rule replaces old · decided by you · risk: high"
H_OLD = "19 Oct 2026 · Old rule · decided by lead · risk: high"
H_BODY = "Fix round 1 — a body-marked entry"


class ParseLogEntries(unittest.TestCase):
    def setUp(self):
        self.entries = digest.parse_log_entries(FIXTURE_LOG)
        self.by = {e["heading"]: e for e in self.entries}

    def test_every_entry_in_log_order(self):
        self.assertEqual([e["heading"] for e in self.entries], [
            H_NEW, "20 Oct 2026 · A middling choice · decided by lead · risk: medium", H_BODY,
            "19 Oct 2026 · A small thing · decided by builder", H_OLD])

    def test_risk_from_heading_or_body_line(self):
        self.assertEqual([e["risk"] for e in self.entries], ["high", "medium", "high", "low", "high"])

    def test_no_risk_marker_is_none(self):
        e = digest.parse_log_entries(log("### 1 Jan 2026 · Plain\nDecided: x.\n"))[0]
        self.assertIsNone(e["risk"])

    def test_risk_in_prose_line_is_not_a_marker(self):
        e = digest.parse_log_entries(log("### Plain\n- Best of 3 rounds · risk: high.\n"))[0]
        self.assertIsNone(e["risk"])

    def test_supersedes_only_on_the_entry_that_says_so(self):
        self.assertEqual(self.by[H_NEW]["supersedes"], H_OLD)
        for h in (H_OLD, H_BODY):
            self.assertIsNone(self.by[h]["supersedes"])

    def test_supersedes_tolerates_hash_prefix_and_spacing(self):
        text = log("### B · risk: high\nSupersedes:   ###  A ·  risk: high \n", "### A · risk: high\nx\n")
        self.assertEqual(digest.parse_log_entries(text)[0]["supersedes"], "A · risk: high")

    def test_body_stops_at_separator_and_next_heading(self):
        self.assertNotIn("Old rule", self.by[H_BODY]["body"])
        self.assertIn("fixed it", self.by[H_BODY]["body"])

    def test_two_headings_in_one_block_are_two_entries(self):
        # The real log has blocks like this (entries copied without a `---` between them).
        text = log("### A · risk: high\nx\n\n### B · risk: low\ny\n")
        got = digest.parse_log_entries(text)
        self.assertEqual([(e["heading"], e["risk"]) for e in got], [("A · risk: high", "high"), ("B · risk: low", "low")])

    def test_header_legend_is_not_an_entry(self):
        self.assertFalse(any("legend" in e["heading"] or "legend" in e["body"] for e in self.entries))

    def test_empty_log(self):
        self.assertEqual(digest.parse_log_entries(""), [])
        self.assertEqual(digest.parse_log_entries(HEADER + "\n---\n"), [])

    def test_heading_with_no_separator_is_malformed(self):
        with self.assertRaisesRegex(ValueError, "no closing ---"):
            digest.parse_log_entries(HEADER + "\n### A · risk: high\nDecided: x.\n")

    def test_risk_high_heading_without_space_is_malformed(self):
        with self.assertRaisesRegex(ValueError, "malformed"):
            digest.parse_log_entries(log("###A · risk: high\nx\n"))

    def test_risk_high_heading_with_empty_body_is_malformed(self):
        with self.assertRaisesRegex(ValueError, "empty"):
            digest.parse_log_entries(log("### A · risk: high\n", "### B\nx\n"))

    def test_supersedes_unknown_heading_fails(self):
        with self.assertRaisesRegex(ValueError, "Supersedes"):
            digest.parse_log_entries(log("### B · risk: high\nSupersedes: Nope\n"))


class StandingRules(unittest.TestCase):
    def test_parses_bullets_and_ignores_other_lines(self):
        text = f"# Standing rules\n\nIntro.\n\n- Keep it new. (cites: {H_NEW})\n"
        self.assertEqual(digest.parse_standing_rules(text), [("Keep it new.", H_NEW)])

    def test_bullet_without_citation_fails(self):
        with self.assertRaisesRegex(ValueError, "cites"):
            digest.parse_standing_rules("- An invented rule.\n")

    def test_none(self):
        self.assertEqual(digest.parse_standing_rules(""), [])
        self.assertEqual(digest.parse_standing_rules(None), [])


class RenderDigest(unittest.TestCase):
    def setUp(self):
        self.entries = digest.parse_log_entries(FIXTURE_LOG)

    def test_only_risk_high_newest_first(self):
        text = digest.render_digest(self.entries)
        lines = [l for l in text.splitlines() if l.startswith("- ")]
        self.assertEqual(lines, [f"- {H_NEW}", f"- {H_BODY}", f"- {H_OLD} (superseded by {H_NEW})"])
        self.assertNotIn("middling", text)
        self.assertNotIn("small thing", text)

    def test_sections_and_no_rules_placeholder(self):
        text = digest.render_digest(self.entries)
        self.assertIn("## Standing rules\n", text)
        self.assertIn("## Risk-high decisions\n", text)
        self.assertIn("None yet.", text)
        self.assertTrue(text.endswith("\n"))

    def test_standing_rules_rendered_verbatim(self):
        text = digest.render_digest(self.entries, [("Keep it new.", H_NEW)])
        self.assertIn(f"- Keep it new. (cites: {H_NEW})", text)
        self.assertNotIn("None yet.", text)

    def test_rule_citing_unknown_heading_refused(self):
        with self.assertRaisesRegex(ValueError, "not a risk: high heading"):
            digest.render_digest(self.entries, [("Invented.", "21 Oct 2026 · Nothing like this")])

    def test_rule_citing_non_high_heading_refused(self):
        with self.assertRaisesRegex(ValueError, "not a risk: high heading"):
            digest.render_digest(self.entries, [("Mid.", "20 Oct 2026 · A middling choice · decided by lead · risk: medium")])

    def test_duplicate_heading_listed_once(self):
        entries = digest.parse_log_entries(log(E_OLD, E_OLD))
        self.assertEqual(digest.render_digest(entries).count(f"- {H_OLD}"), 1)

    def test_deterministic(self):
        self.assertEqual(digest.render_digest(self.entries), digest.render_digest(self.entries))


class IsMissing(unittest.TestCase):
    def setUp(self):
        self.entries = digest.parse_log_entries(FIXTURE_LOG)

    def test_rendered_digest_has_nothing_missing(self):
        self.assertEqual(digest.is_missing(self.entries, digest.render_digest(self.entries)), [])

    def test_dropped_line_is_reported(self):
        text = digest.render_digest(self.entries).replace(f"- {H_BODY}\n", "")
        self.assertEqual(digest.is_missing(self.entries, text), [H_BODY])

    def test_substring_match_does_not_count(self):
        text = digest.render_digest(self.entries).replace(f"- {H_BODY}\n", f"- {H_BODY} extra words\n")
        self.assertEqual(digest.is_missing(self.entries, text), [H_BODY])

    def test_superseded_marking_counts_as_present(self):
        text = f"- {H_NEW}\n- {H_BODY}\n- {H_OLD} (superseded by {H_NEW})\n"
        self.assertEqual(digest.is_missing(self.entries, text), [])


class BoardDigest(RepoCase):
    def out(self):
        return self.repo.root / "docs" / "decisions" / "digest.md"

    def test_writes_digest_and_is_idempotent(self):
        self.repo.write("docs/decisions/log.md", FIXTURE_LOG)
        r = self.repo.script("board", "digest")
        self.assertEqual(r.returncode, 0, r.stderr)
        first = self.out().read_bytes()
        self.assertIn(f"- {H_OLD} (superseded by {H_NEW})".encode(), first)
        r = self.repo.script("board", "digest")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.out().read_bytes(), first)

    def test_reads_standing_rules_file(self):
        self.repo.write("docs/decisions/log.md", FIXTURE_LOG)
        self.repo.write("docs/decisions/standing-rules.md", f"# Standing rules\n\n- Keep it new. (cites: {H_NEW})\n")
        r = self.repo.script("board", "digest")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"- Keep it new. (cites: {H_NEW})", self.out().read_text())

    def test_malformed_log_fails_and_writes_nothing(self):
        self.repo.write("docs/decisions/log.md", HEADER + "\n### A · risk: high\nDecided: x.\n")
        r = self.repo.script("board", "digest")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no closing ---", r.stderr)
        self.assertFalse(self.out().exists())

    def test_bad_rule_keeps_previous_digest(self):
        self.repo.write("docs/decisions/log.md", FIXTURE_LOG)
        self.assertEqual(self.repo.script("board", "digest").returncode, 0)
        before = self.out().read_bytes()
        self.repo.write("docs/decisions/standing-rules.md", "- Invented. (cites: Nothing)\n")
        r = self.repo.script("board", "digest")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("refusing", r.stderr)
        self.assertEqual(self.out().read_bytes(), before)

    def test_leaves_no_bytecode_behind(self):
        self.repo.write("docs/decisions/log.md", FIXTURE_LOG)
        self.assertEqual(self.repo.script("board", "digest").returncode, 0)
        self.assertEqual(list(self.repo.root.rglob("__pycache__")), [])


if __name__ == "__main__":
    unittest.main()
