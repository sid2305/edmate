"""digest.py and `board.py digest` (task 0.19): the decision-log digest.

Part 1 (Phase A): fixture-driven unit tests of the parser and renderer, and of `board.py digest`'s
idempotent regeneration. Part 2 (Phase B) adds static checks on the real
`docs/decisions/log.md`, `docs/decisions/digest.md` and `docs/lessons.md`.
"""
import re
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


K_NEW = "21 Oct 2026 · New rule replaces old"
K_OLD = "19 Oct 2026 · Old rule"
L_NEW = f"- {K_NEW} (human, risk: high): the new rule."
L_OLD = f"- {K_OLD} (lead, risk: high; superseded by {K_NEW}): the old rule."

# Lead answer 6 scope fixtures: who decided, risk, and the routine "<id> merge:" exclusion.
E_MERGE = ("### 21 Oct 2026 · 6.2 merge: a risky change · decided by lead · risk: high\n"
           "- Decided: merge 6.2.\n")
E_YOU_LOW = ("### 18 Oct 2026 · Product name · decided by you · risk: low\n"
             "Decided: Edmate. It stays. More text.\n")
E_HUMAN = ("### 20 Oct 2026 · 1.7f pack signed by the human (B-27) · decided by human (someone) · risk: high\n"
           "- **Decided:** signed as is, e.g. no edits. Next sentence.\n")
E_TDD_HIGH = ("### 20 Oct 2026 · A guard pattern · decided by tdd-guide · risk: high\n"
              "- Decided: a pattern.\n")
E_TEAM_HIGH = ("### 20 Oct 2026 · Team note · decided by team · risk: high\n- Decided: t.\n")
E_PLANNER_HIGH = ("### 20 Oct 2026 · Plan note · decided by planner · risk: high\n- Decided: p.\n")
E_LEAD_FIX = ("### 19 Oct 2026 · 4.4 a fix-round rule · decided by lead (fix round 2, safety HIGH 1) · risk: high\n"
              "- First bullet with no label. Then more.\n")
E_LEAD_MERGED = ("### 19 Oct 2026 · 4.8 merged: guard wired · decided by lead (plan revisions) · risk: high\n"
                 "Some prose first.\n- Decided: wired the guard.\n")
E_LEAD_HIGH_IN_PAREN = ("### 20 Oct 2026 · 3.3 hard phrase only · decided by lead (risk: high)\n"
                        "- Decided: only hard phrases.\n")
SCOPE_LOG = log(E_MERGE, E_HUMAN, E_TDD_HIGH, E_TEAM_HIGH, E_PLANNER_HIGH, E_LEAD_HIGH_IN_PAREN,
                E_LEAD_FIX, E_LEAD_MERGED, E_YOU_LOW)


class DigestScope(unittest.TestCase):
    """Lead answer 6: (a) every human decision at any risk, (b) risk: high lead decisions that
    are not a routine `<id> merge:` entry. Builder, tdd-guide, planner and team entries are out."""

    def setUp(self):
        self.by = {e["heading"]: e for e in digest.parse_log_entries(SCOPE_LOG + "")}
        self.fixture = {e["heading"]: e for e in digest.parse_log_entries(FIXTURE_LOG)}

    def kept(self, by):
        return sorted(digest.digest_key(h) for h, e in by.items() if digest.in_digest(e))

    def test_scope_filter(self):
        self.assertEqual(self.kept(self.by), sorted([
            "20 Oct 2026 · 1.7f pack signed by the human (B-27)",
            "20 Oct 2026 · 3.3 hard phrase only",
            "19 Oct 2026 · 4.4 a fix-round rule",
            "19 Oct 2026 · 4.8 merged: guard wired",
            "18 Oct 2026 · Product name"]))

    def test_fixture_log_scope(self):
        # medium lead, builder, and an entry with no `decided by` at all are out.
        self.assertEqual(self.kept(self.fixture), sorted([K_NEW, K_OLD]))

    def test_who(self):
        self.assertEqual(digest.decided_by(self.fixture[H_NEW]), "human")
        self.assertEqual(digest.decided_by(self.fixture[H_OLD]), "lead")
        human = [e for e in self.by.values() if "1.7f" in e["heading"]][0]
        self.assertEqual(digest.decided_by(human), "human")

    def test_team_lead_forms_are_lead(self):
        # Fix round 1 (security-reviewer MEDIUM): "team lead" used to parse as "team".
        for who in ("team lead", "the team lead", "the lead", "Team Lead (plan Q2)",
                    "team lead on security-reviewer's fix round 1", "Claude (lead), at your request"):
            e = digest.parse_log_entries(log(f"### 1 Jan 2026 · X · decided by {who} · risk: high\n- Decided: y.\n"))[0]
            self.assertEqual(digest.decided_by(e), "lead", who)
            self.assertTrue(digest.in_digest(e), who)
        e = digest.parse_log_entries(log("### 1 Jan 2026 · X · decided by the human (B-1) · risk: low\n- Decided: y.\n"))[0]
        self.assertEqual(digest.decided_by(e), "human")

    def test_first_named_role_decides(self):
        for heading, who in (("decided by planner, accepted by team lead", "planner"),
                             ("decided by tdd-guide (lead's 4.2 note) and lead (fix round)", "tdd-guide"),
                             ("decided by builder (tdd-guide)", "builder"),
                             ("decided by team", "team"),
                             ("decided by plan (lead-approved), built by tdd-guide", "plan")):
            e = {"heading": f"1 Jan 2026 · X · {heading} · risk: high", "risk": "high", "body": ""}
            self.assertEqual(digest.decided_by(e), who, heading)

    def test_team_lead_high_entry_is_rendered(self):
        entries = digest.parse_log_entries(log(
            "### 2 Jan 2026 · 8.2 document delete · decided by team lead · risk: high\n- Decided: delete it. More.\n",
            "### 1 Jan 2026 · 3.11e lead signs · decided by the team lead (plan Q2) · risk: high\n- Decided: signed.\n"))
        text = digest.render_digest(entries)
        self.assertIn("- 2 Jan 2026 · 8.2 document delete (lead, risk: high): delete it.", text)
        self.assertIn("- 1 Jan 2026 · 3.11e lead signs (lead, risk: high): signed.", text)

    def test_summary_joins_wrapped_decided_line(self):
        e = {"body": "- Decided: signed (`reviewedOn:\n  2026-10-21`); it applies. Later.\n- Why: x.\n"}
        self.assertEqual(digest.summary(e), "signed (`reviewedOn: 2026-10-21`); it applies.")
        e = {"body": "- Decided: one\n- Two.\n"}
        self.assertEqual(digest.summary(e), "one")

    def test_human_case_insensitive(self):
        e = digest.parse_log_entries(log("### 1 Jan 2026 · X · Decided by You · risk: low\nDecided: y.\n"))[0]
        self.assertTrue(digest.in_digest(e))

    def test_digest_key_drops_who_and_risk(self):
        self.assertEqual(digest.digest_key(H_NEW), K_NEW)
        self.assertEqual(digest.digest_key("20 Oct 2026 · 3.3 hard phrase only · decided by lead (risk: high)"),
                         "20 Oct 2026 · 3.3 hard phrase only")
        self.assertEqual(digest.digest_key("No date · decided by you"), "No date")

    def test_summary_is_first_sentence_of_decided_line(self):
        human = [e for e in self.by.values() if "1.7f" in e["heading"]][0]
        self.assertEqual(digest.summary(human), "signed as is, e.g. no edits.")
        merged = [e for e in self.by.values() if "4.8" in e["heading"]][0]
        self.assertEqual(digest.summary(merged), "wired the guard.")

    def test_summary_falls_back_to_first_bullet_then_empty(self):
        fix = [e for e in self.by.values() if "4.4" in e["heading"]][0]
        self.assertEqual(digest.summary(fix), "First bullet with no label.")
        self.assertEqual(digest.summary({"body": "just prose"}), "")

    def test_summary_empty_decided_line_takes_next_line(self):
        e = {"body": "- Decided:\n\n  - Feedback turns get a frame. More.\n  - Second.\n"}
        self.assertEqual(digest.summary(e), "Feedback turns get a frame.")

    def test_summary_does_not_split_on_abbreviations(self):
        e = {"body": "Decided: a merchant of record (e.g. Paddle) in the US. Then more."}
        self.assertEqual(digest.summary(e), "a merchant of record (e.g. Paddle) in the US.")
        e = {"body": "Decided: one region, i.e. Ohio, for now. Later."}
        self.assertEqual(digest.summary(e), "one region, i.e. Ohio, for now.")

    def test_summary_redacts_reviewer_handles_and_repo_owner(self):
        e = {"body": "Decided: signed (`reviewed_by: someone1`, `reviewedBy: someone1`) as is."}
        self.assertEqual(digest.summary(e), "signed (`reviewed_by: <human>`, `reviewedBy: <human>`) as is.")
        e = {"body": "Decided: The code is on github.com/someone1/edmate (public)."}
        self.assertEqual(digest.summary(e), "The code is on GitHub (public).")
        e = {"body": "Decided: signed (a). reviewed_by is set to someone1 for now."}
        self.assertEqual(digest.summary(e), "signed (a). reviewed_by is set to <human> for now.")
        e = {"body": "Decided: approved; reviewed_by: someone1."}
        self.assertEqual(digest.summary(e), "approved; reviewed_by: <human>.")

    def test_summary_capped(self):
        e = {"body": "Decided: " + "word " * 100}
        s = digest.summary(e)
        self.assertLessEqual(len(s), digest.SUMMARY_MAX)
        self.assertTrue(s.endswith("…"))


class RenderDigest(unittest.TestCase):
    def setUp(self):
        self.entries = digest.parse_log_entries(FIXTURE_LOG)

    def items(self, text):
        return [l for l in text.split("## Decisions", 1)[1].splitlines() if l.startswith("- ")]

    def test_one_line_per_entry_newest_first_with_superseded_tag(self):
        text = digest.render_digest(self.entries)
        self.assertEqual(self.items(text), [L_NEW, L_OLD])
        for gone in ("middling", "small thing", "body-marked"):
            self.assertNotIn(gone, text)

    def test_sorted_by_date_not_file_order(self):
        entries = digest.parse_log_entries(log(E_YOU_LOW, E_HUMAN, E_LEAD_FIX))
        keys = [l.split(" (", 1)[0] for l in self.items(digest.render_digest(entries))]
        self.assertEqual(keys, ["- 20 Oct 2026 · 1.7f pack signed by the human",
                                "- 19 Oct 2026 · 4.4 a fix-round rule",
                                "- 18 Oct 2026 · Product name"])

    def test_no_handle_or_who_clause_copied(self):
        text = digest.render_digest(digest.parse_log_entries(SCOPE_LOG))
        self.assertNotIn("someone", text)
        self.assertNotIn("decided by", self.items(text)[0])

    def test_sections_and_no_rules_placeholder(self):
        text = digest.render_digest(self.entries)
        self.assertIn("## Standing rules\n", text)
        self.assertIn("## Decisions\n", text)
        self.assertIn("None yet.", text)
        self.assertTrue(text.endswith("\n"))

    def test_standing_rules_rendered_verbatim(self):
        text = digest.render_digest(self.entries, [("Keep it new.", H_NEW)])
        self.assertIn(f"- Keep it new. (cites: {H_NEW})", text)
        self.assertNotIn("None yet.", text)

    def test_rule_citing_unknown_heading_refused(self):
        with self.assertRaisesRegex(ValueError, "not a digest heading"):
            digest.render_digest(self.entries, [("Invented.", "21 Oct 2026 · Nothing like this")])

    def test_rule_citing_out_of_scope_heading_refused(self):
        with self.assertRaisesRegex(ValueError, "not a digest heading"):
            digest.render_digest(self.entries, [("Mid.", "20 Oct 2026 · A middling choice · decided by lead · risk: medium")])

    def test_exact_duplicate_listed_once_but_same_heading_new_body_kept(self):
        self.assertEqual(digest.render_digest(digest.parse_log_entries(log(E_OLD, E_OLD))).count(f"- {K_OLD} ("), 1)
        other = E_OLD.replace("the old rule", "a second rule")
        self.assertEqual(digest.render_digest(digest.parse_log_entries(log(E_OLD, other))).count(f"- {K_OLD} ("), 2)

    def test_deterministic(self):
        self.assertEqual(digest.render_digest(self.entries), digest.render_digest(self.entries))


class IsMissing(unittest.TestCase):
    def setUp(self):
        self.entries = digest.parse_log_entries(FIXTURE_LOG)

    def test_rendered_digest_has_nothing_missing(self):
        self.assertEqual(digest.is_missing(self.entries, digest.render_digest(self.entries)), [])
        scope = digest.parse_log_entries(SCOPE_LOG)
        self.assertEqual(digest.is_missing(scope, digest.render_digest(scope)), [])

    def test_dropped_line_is_reported(self):
        text = digest.render_digest(self.entries).replace(L_OLD + "\n", "")
        self.assertEqual(digest.is_missing(self.entries, text), [H_OLD])

    def test_substring_match_does_not_count(self):
        text = digest.render_digest(self.entries).replace(L_NEW, f"- {K_NEW} extra (human")
        self.assertEqual(digest.is_missing(self.entries, text), [H_NEW])

    def test_out_of_scope_entries_never_missing(self):
        self.assertEqual(digest.is_missing(self.entries, ""), [H_NEW, H_OLD])


class BoardDigest(RepoCase):
    def out(self):
        return self.repo.root / "docs" / "decisions" / "digest.md"

    def test_writes_digest_and_is_idempotent(self):
        self.repo.write("docs/decisions/log.md", FIXTURE_LOG)
        r = self.repo.script("board", "digest")
        self.assertEqual(r.returncode, 0, r.stderr)
        first = self.out().read_bytes()
        self.assertIn(L_OLD.encode(), first)
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


# Part 2 (Phase B): static checks on the real repo, like test_registry.py's.
REPO = HARNESS.parent
REAL_LOG = REPO / "docs" / "decisions" / "log.md"
REAL_DIGEST = REPO / "docs" / "decisions" / "digest.md"
REAL_RULES = REPO / "docs" / "decisions" / "standing-rules.md"
LESSONS = REPO / "docs" / "lessons.md"
_LOG_CITE = re.compile(r'log "([^"]+)"')
_REVIEW_CITE = re.compile(r"\bdocs/tasks/[\w.-]+/review\.md\b")


class RealRepo(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.log_text = REAL_LOG.read_text()
        cls.entries = digest.parse_log_entries(cls.log_text)
        cls.digest_text = REAL_DIGEST.read_text()

    def test_every_in_scope_log_entry_is_in_the_digest(self):
        # Lead answer 6: every human decision and every non-merge risk: high lead decision.
        self.assertEqual(digest.is_missing(self.entries, self.digest_text), [])

    def test_every_decided_by_heading_has_a_known_who(self):
        # Independent of in_digest: no "decided by ..." heading may parse to an unknown who
        # (that is how "team lead" entries were silently dropped before fix round 1).
        unknown = sorted({(digest.decided_by(e), e["heading"]) for e in self.entries
                          if "decided by" in e["heading"].lower()
                          and digest.decided_by(e) not in digest.KNOWN_WHO})
        self.assertEqual(unknown, [])

    def test_team_lead_high_entries_are_in_the_digest(self):
        kept = {digest.digest_key(e["heading"]) for e in digest.digest_entries(self.entries)}
        for e in self.entries:
            h = e["heading"].lower()
            if e["risk"] == "high" and re.search(r"decided by (the )?team lead", h) \
                    and " merge:" not in h:
                self.assertIn(digest.digest_key(e["heading"]), kept)
        self.assertIn("20 Oct 2026 · 8.2 document delete and replace in packages/db/src/repositories", kept)

    def test_scope_is_not_empty_and_pins_known_entries(self):
        kept = {digest.digest_key(e["heading"]) for e in digest.digest_entries(self.entries)}
        self.assertIn("21 Oct 2026 · US is the first region; India parked", kept)
        self.assertIn("18 Oct 2026 · 4.1 The guard chain fails closed on every failure", kept)
        self.assertFalse(any(" merge: " in k for k in kept))

    def test_digest_is_up_to_date(self):
        rules = digest.parse_standing_rules(REAL_RULES.read_text())
        self.assertGreater(len(rules), 0)
        self.assertEqual(digest.render_digest(self.entries, rules), self.digest_text,
                         "run: python3 .claude/skills/board/board.py digest")

    def test_digest_copies_no_handle_or_home_path(self):
        self.assertNotIn("/Users/", self.digest_text)
        self.assertNotIn("github.com/", self.digest_text)
        self.assertNotRegex(self.digest_text, r"reviewed_?by: (?!<human>|pending)")

    def lessons(self):
        text = LESSONS.read_text()
        return re.findall(r"^## (.+?)\n(.*?)(?=^## |\Z)", text, re.M | re.S)

    def test_lessons_has_3_to_8_entries_each_with_a_source(self):
        entries = self.lessons()
        self.assertTrue(3 <= len(entries) <= 8, len(entries))
        for title, body in entries:
            src = [l for l in body.splitlines() if l.startswith("Sources: ")]
            self.assertEqual(len(src), 1, title)
            self.assertTrue(_LOG_CITE.search(src[0]) or _REVIEW_CITE.search(src[0]), title)

    def test_every_lessons_citation_resolves(self):
        headings = [l[4:] for l in self.log_text.splitlines() if l.startswith("### ")]
        for title, body in self.lessons():
            src = next(l for l in body.splitlines() if l.startswith("Sources: "))
            for cite in _LOG_CITE.findall(src):
                self.assertTrue(any(cite in h for h in headings), f"{title}: no log heading {cite!r}")
            for path in _REVIEW_CITE.findall(src):
                self.assertTrue((REPO / path).is_file(), f"{title}: no file {path}")


if __name__ == "__main__":
    unittest.main()
