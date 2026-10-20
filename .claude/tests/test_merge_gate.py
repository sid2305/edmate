"""merge_gate.py in throwaway repos: basics, lead-approved risky groups (task-id and --pr modes), wontfix."""
import json
import os
import unittest

from helpers import ENV, GOOD_HANDOFF, GOOD_REVIEW, RepoCase, board_yaml, git, require_tools, task

B = "m9/9.9-x"
HIGH = "# h\nStatus: DONE\n\n## Decisions\n### 18 Oct 2026 · 9.9 Risky change · decided by lead · risk: high\nDecided: Merge it.\n"


def setUpModule():
    require_tools()


def review(*reviewers):
    names = ", ".join(("code-reviewer", "typescript-reviewer") + reviewers)
    return f"# 9.9 review — APPROVE\nReviewers: {names}\n\n## Findings\n- [LOW] [fixed] a.ts:1 — x\n"


class GateCase(RepoCase):
    def gate(self, *args, **kw):
        r = self.repo.script("gate", *(args or ("9.9",)), **kw)
        return r.returncode, r.stdout + r.stderr

    def make(self, files, review=None, handoff=None):
        all_files = self.repo.task_files("9.9", review, handoff)
        all_files.update(files)
        return self.repo.branch(B, all_files)

    def gh_env(self, labels=(), fail=False, oid="auto", branch=B):
        """A stub `gh` on PATH that reports the PR's branch, head commit (by default the local branch
        head, read when the stub runs) and labels (which the gate ignores)."""
        bindir = self.repo.root.parent / "bin"
        bindir.mkdir(exist_ok=True)
        gh = bindir / "gh"
        if fail:
            gh.write_text("#!/bin/sh\necho 'not logged in'\nexit 1\n")
        else:
            data = {"headRefName": branch, "labels": [{"name": n} for n in labels]}
            if oid == "auto":
                data["headRefOid"] = "OID"
            elif oid is not None:
                data["headRefOid"] = oid
            text = json.dumps(data).replace('"OID"', f'"$(git rev-parse {branch})"')
            gh.write_text(f"#!/bin/sh\ncat <<EOF\n{text}\nEOF\n")
        gh.chmod(0o755)
        return dict(ENV, PATH=f"{bindir}{os.pathsep}{ENV['PATH']}")


class Basics(GateCase):
    def test_normal_change_passes(self):
        self.make({"apps/cli.ts": "x\n"})
        code, out = self.gate()
        self.assertEqual(code, 0, out)
        self.assertIn("RESULT: PASS", out)

    def test_no_branch_on_board(self):
        self.repo.write("docs/board/tasks.yaml", board_yaml([task("9.9")]))
        self.repo.commit("no branch")
        code, out = self.gate()
        self.assertEqual(code, 1)
        self.assertIn("has no branch on the board", out)

    def test_usage(self):
        code, out = self.gate("a", "b")
        self.assertEqual(code, 1)
        self.assertIn("merge_gate.py <task-id>", out)

    def test_branch_without_changes(self):
        git(self.repo.root, "branch", B)
        code, out = self.gate()
        self.assertEqual(code, 1)
        self.assertIn("no changes against main", out)

    def test_missing_handoff(self):
        self.repo.branch(B, {"apps/cli.ts": "x\n", "docs/tasks/9.9/review.md": GOOD_REVIEW.format(tid="9.9")})
        code, out = self.gate()
        self.assertEqual(code, 1)
        self.assertIn("handoff.md is missing", out)

    def test_handoff_without_decisions(self):
        self.make({"apps/cli.ts": "x\n"}, handoff="# h\nStatus: DONE\n")
        code, out = self.gate()
        self.assertEqual(code, 1)
        self.assertIn("no '## Decisions' section", out)

    def test_missing_review(self):
        self.repo.branch(B, {"apps/cli.ts": "x\n", "docs/tasks/9.9/handoff.md": GOOD_HANDOFF.format(tid="9.9")})
        code, out = self.gate()
        self.assertEqual(code, 1)
        self.assertIn("review.md is missing", out)

    def test_status_missing_fails(self):
        self.make({"apps/cli.ts": "x\n"}, handoff="# h\n\n## Decisions\nNone\n")
        code, out = self.gate()
        self.assertEqual(code, 1)
        self.assertIn("no 'Status:' line", out)

    def test_status_partial_fails(self):
        self.make({"apps/cli.ts": "x\n"}, handoff="# h\nStatus: PARTIAL\n\n## Decisions\nNone\n")
        code, out = self.gate()
        self.assertEqual(code, 1)
        self.assertIn("Status is 'PARTIAL', not DONE", out)

    def test_status_blocked_fails(self):
        self.make({"apps/cli.ts": "x\n"}, handoff="# h\n- **Status:** BLOCKED (waiting on human)\n\n## Decisions\nNone\n")
        code, out = self.gate()
        self.assertEqual(code, 1)
        self.assertIn("not DONE", out)

    def test_status_bold_done_passes(self):
        self.make({"apps/cli.ts": "x\n"}, handoff="# h\n- **Status:** DONE (fix round 1 applied)\n\n## Decisions\nNone\n")
        self.assertEqual(self.gate()[0], 0)

    def test_status_composite_subtask_done_passes(self):
        # A parent handoff covering lettered sub-tasks in one composite status line (e.g. 4.0).
        handoff = "# h\n**Status:** 9.9b DONE (PR #1); 9.9a DONE pending sign-off\n\n## Decisions\nNone\n"
        self.make({"apps/cli.ts": "x\n"}, handoff=handoff)
        self.assertEqual(self.gate()[0], 0)

    def test_status_partial_in_prose_not_matched(self):
        # Mentioning another status word mid-sentence (not as a Status: line) must not confuse the check.
        handoff = "# h\nStatus: DONE\n\n## Decisions\nNone\nDecided: builders stop at `Status: PARTIAL` mid-build.\n"
        self.make({"apps/cli.ts": "x\n"}, handoff=handoff)
        self.assertEqual(self.gate()[0], 0)

    def test_changes_requested(self):
        self.make({"apps/cli.ts": "x\n"}, review="# 9.9 review — CHANGES_REQUESTED\nReviewers: code-reviewer\n")
        code, out = self.gate()
        self.assertEqual(code, 1)
        self.assertIn("verdict is not APPROVE", out)

    def test_no_reviewers_line(self):
        self.make({"apps/cli.ts": "x\n"}, review="# 9.9 review — APPROVE\n")
        code, out = self.gate()
        self.assertEqual(code, 1)
        self.assertIn("which reviewers ran", out)

    def test_open_medium(self):
        self.make({"apps/cli.ts": "x\n"}, review=review() + "- [MEDIUM] [open] apps/cli.ts:3 — x\n")
        code, out = self.gate()
        self.assertEqual(code, 1)
        self.assertIn("still [open]", out)

    # MVP first (human decision, 20 Oct 2026): a HIGH may be [deferred <id>] to a task on the board.
    def test_high_deferred_to_board_task_ok(self):
        self.repo.write("docs/board/tasks.yaml", board_yaml([task("9.9", branch=B), task("9.10", status="todo")]))
        self.repo.commit("board: 9.10")  # on main, where the gate reads the board
        self.make({"apps/cli.ts": "x\n"}, review=review() + "- [HIGH] [deferred 9.10] apps/cli.ts:3 — x\n")
        code, out = self.gate()
        self.assertEqual(code, 0, out)

    def test_high_deferred_to_unknown_task_fails(self):
        self.make({"apps/cli.ts": "x\n"}, review=review() + "- [HIGH] [deferred 9.10] apps/cli.ts:3 — x\n")
        code, out = self.gate()
        self.assertEqual(code, 1, out)
        self.assertIn("9.10 is not on the board", out)

    def test_open_high_fails(self):
        self.make({"apps/cli.ts": "x\n"}, review=review() + "- [HIGH] [open] apps/cli.ts:3 — x\n")
        code, out = self.gate()
        self.assertEqual(code, 1, out)
        self.assertIn("a HIGH finding is [open]", out)

    def test_critical_must_be_fixed(self):
        self.repo.write("docs/board/tasks.yaml", board_yaml([task("9.9", branch=B), task("9.10", status="todo")]))
        self.repo.commit("board: 9.10")
        self.make({"apps/cli.ts": "x\n"}, review=review() + "- [CRITICAL] [deferred 9.10] apps/cli.ts:3 — x\n")
        code, out = self.gate()
        self.assertEqual(code, 1, out)
        self.assertIn("CRITICAL must be fixed", out)

    def test_pr_mode_keeps_task_letter(self):
        b = "m3/3.11d-x"
        self.repo.write("docs/board/tasks.yaml", board_yaml([task("9.9", branch=B), task("3.11d", branch=b)]))
        self.repo.commit("board: 3.11d")
        self.repo.branch(b, {**self.repo.task_files("3.11d"), "apps/cli.ts": "x\n"})
        code, out = self.gate("--pr", "5", env=self.gh_env(branch=b))
        self.assertEqual(code, 0, out)
        self.assertIn("3.11d", out)

    def test_deferred_medium_ok(self):
        self.make({"apps/cli.ts": "x\n"}, review=review() + "- [MEDIUM] [deferred 9.10] apps/cli.ts:3 — x\n")
        self.assertEqual(self.gate()[0], 0)

    def test_pr_mode_normal_change(self):
        self.make({"apps/cli.ts": "x\n"})
        code, out = self.gate("--pr", "5", env=self.gh_env())
        self.assertEqual(code, 0, out)
        self.assertIn("(PR #5)", out)

    def test_pr_mode_gh_failure(self):
        code, out = self.gate("--pr", "5", env=self.gh_env(fail=True))
        self.assertEqual(code, 1)
        self.assertIn("cannot read PR 5", out)


# One sample path per risk group and the reviewers it needs (from risk-paths.txt).
GROUPS = [
    # Safety group: code-reviewer only until the pilot gate (MVP first, 20 Oct 2026); 13.3 restores safety-reviewer.
    ("packages/harness/src/guardrails/g.ts", ("code-reviewer",)),
    ("content/locales/in/pack.yaml", ("code-reviewer",)),
    ("packages/harness/src/access/filter.ts", ("security-reviewer",)),
    ("packages/payments/src/ledger.ts", ("security-reviewer",)),
    ("apps/web/app/api/webhooks/pay.ts", ("security-reviewer",)),
    ("apps/web/src/auth/session.ts", ("security-reviewer",)),
    ("packages/gateway/src/keys/vault.ts", ("security-reviewer",)),
    ("packages/db/src/repositories/students.ts", ("security-reviewer",)),
    ("packages/contracts/src/x.ts", ("architect", "security-reviewer", "typescript-reviewer")),
    ("docs/adr/0009-x.md", ("architect", "security-reviewer", "typescript-reviewer")),
    (".claude/agents/x.md", ("security-reviewer",)),
    (".github/workflows/ci.yml", ("security-reviewer",)),
]
SAFETY_REVIEW = {"docs/tasks/9.9/safety-review.md": "# safety review — APPROVE\n"}


class RiskyGroups(GateCase):
    """Risky branches: 0 with the group's reviewers and a risk: high entry, 1 otherwise. Never 3."""

    def files(self, path):
        files = {path: "x\n"}
        if "safety-reviewer" in dict(GROUPS)[path]:
            files.update(SAFETY_REVIEW)
        return files

    def fresh(self):
        if git(self.repo.root, "branch", "--list", B):
            git(self.repo.root, "branch", "-D", B)

    def modes(self):
        return [("task", ("9.9",), None), ("pr", ("--pr", "5"), self.gh_env())]

    def test_pass_with_reviewers_and_risk_high(self):
        for path, needed in GROUPS:
            for mode, args, env in self.modes():
                with self.subTest(path=path, mode=mode):
                    self.fresh()
                    self.make(self.files(path), review=review(*needed), handoff=HIGH)
                    code, out = self.gate(*args, env=env)
                    self.assertEqual(code, 0, out)
                    self.assertIn(f"risky {path}", out)
                    self.assertIn("lead-approved", out)

    def test_each_missing_reviewer_fails(self):
        for path, needed in GROUPS:
            for missing in needed:
                for mode, args, env in self.modes():
                    with self.subTest(path=path, missing=missing, mode=mode):
                        self.fresh()
                        kept = [r for r in needed if r != missing]
                        # typescript-reviewer is a default reviewer in review(); drop it explicitly.
                        text = review(*kept)
                        if missing == "typescript-reviewer":
                            text = text.replace("typescript-reviewer", "code-reviewer")
                        elif missing == "code-reviewer":  # also a default in review()
                            text = text.replace("code-reviewer, ", "")
                        self.make(self.files(path), review=text, handoff=HIGH)
                        code, out = self.gate(*args, env=env)
                        self.assertEqual(code, 1, out)
                        self.assertIn(f"Reviewers: is missing {missing}", out)

    def test_missing_risk_high_fails(self):
        for path, needed in GROUPS:
            for mode, args, env in self.modes():
                with self.subTest(path=path, mode=mode):
                    self.fresh()
                    medium = HIGH.replace("risk: high", "risk: medium")
                    self.make(self.files(path), review=review(*needed), handoff=medium)
                    code, out = self.gate(*args, env=env)
                    self.assertEqual(code, 1, out)
                    self.assertIn("risk: high", out)

    def test_label_does_not_replace_reviewers(self):
        self.make({".claude/x": "x\n"}, handoff=HIGH)
        code, out = self.gate("--pr", "5", env=self.gh_env(["human-approved"]))
        self.assertEqual(code, 1, out)
        self.assertIn("missing security-reviewer", out)

    def test_lists_every_gap(self):
        self.make({"packages/contracts/src/x.ts": "x\n", ".claude/x": "x\n"},
                  review="# r — APPROVE\nReviewers: code-reviewer\n")
        code, out = self.gate()
        self.assertEqual(code, 1, out)
        for who in ("architect", "security-reviewer", "typescript-reviewer"):
            self.assertIn(f"missing {who}", out)
        self.assertIn("risk: high", out)

    def test_union_across_groups(self):
        files = {"packages/contracts/src/x.ts": "x\n", "content/skills/s.md": "x\n"}
        # review() always lists code-reviewer, which the skills group now needs; write the line by hand.
        text = "# r — APPROVE\nReviewers: typescript-reviewer, architect, security-reviewer\n"
        self.make(files, review=text, handoff=HIGH)
        code, out = self.gate()
        self.assertEqual(code, 1, out)
        self.assertIn("missing code-reviewer", out)
        self.fresh()
        self.make(files, review=review("architect", "security-reviewer"), handoff=HIGH)
        self.assertEqual(self.gate()[0], 0)

    def test_reviewer_word_match(self):
        text = "# r — APPROVE\nReviewers: architecture-bot, security-reviewers, typescript-reviewer (opus)\n"
        self.make({"packages/contracts/src/x.ts": "x\n"}, review=text, handoff=HIGH)
        code, out = self.gate()
        self.assertEqual(code, 1, out)
        self.assertIn("missing architect", out)
        self.assertIn("missing security-reviewer", out)
        self.assertNotIn("missing typescript-reviewer", out)

    def test_risk_high_outside_decisions_ignored(self):
        handoff = "# h\nStatus: DONE\n\n## Decisions\nNone\n\n## Notes\n### 9.9 note · risk: high\n"
        self.make({".claude/x": "x\n"}, review=review("security-reviewer"), handoff=handoff)
        self.assertEqual(self.gate()[0], 1)

    # Until the pilot gate the safety group needs no safety-review.md (MVP first, 20 Oct 2026). When 13.3
    # restores `safety-reviewer` in risk-paths.txt, these two flip back to code 1 + "safety-review.md is missing".
    def test_safety_path_passes_without_safety_review(self):
        self.make({"apps/worker/src/alerts/a.ts": "x\n"}, review=review("code-reviewer"), handoff=HIGH)
        code, out = self.gate()
        self.assertEqual(code, 0, out)
        self.assertNotIn("safety-review.md", out)

    def test_locales_pass_without_safety_review(self):
        self.make({"content/locales/in/p.yaml": "x\n"}, review=review("code-reviewer"), handoff=HIGH)
        code, out = self.gate()
        self.assertEqual(code, 0, out)
        self.assertNotIn("safety-review.md", out)

    def test_destructive_migration(self):
        files = {"packages/db/migrations/0002.sql": "DROP TABLE students;\n"}
        self.make(files, handoff=HIGH)
        code, out = self.gate()
        self.assertEqual(code, 1, out)
        self.assertIn("drops or deletes data", out)
        self.assertIn("missing database-reviewer", out)
        self.fresh()
        self.make(files, review=review("database-reviewer"), handoff=HIGH)
        self.assertEqual(self.gate()[0], 0)

    def test_safe_migration_not_risky(self):
        self.make({"packages/db/migrations/0002.sql": "CREATE TABLE t (id int);\n"})
        code, out = self.gate()
        self.assertEqual(code, 0, out)
        self.assertNotIn("risky", out)

    def test_glob_without_reviewers_line_fails_closed(self):
        rp = self.repo.root / ".claude/skills/merge-gate/risk-paths.txt"
        rp.write_text("# no reviewers line\nsecret/**\n")
        self.repo.commit("risk paths")
        self.make({"secret/x": "x\n"}, handoff=HIGH)
        code, out = self.gate()
        self.assertEqual(code, 1, out)
        self.assertIn("no '# reviewers:' line", out)

    def test_never_exit_3(self):
        self.make({".claude/x": "x\n", "packages/payments/a.ts": "x\n"})
        self.assertNotEqual(self.gate()[0], 3)


class FixRound1(GateCase):
    """Security-review findings on the first version of the gate."""

    def fresh(self):
        if git(self.repo.root, "branch", "--list", B):
            git(self.repo.root, "branch", "-D", B)

    def test_non_ascii_path_is_risky(self):
        self.make({"content/prompt-packs/caf\u00e9.md": "x\n"},
                  review="# r \u2014 APPROVE\nReviewers: typescript-reviewer\n", handoff=HIGH)
        code, out = self.gate()
        self.assertEqual(code, 1, out)
        self.assertIn("risky content/prompt-packs/caf\u00e9.md", out)
        self.assertIn("missing code-reviewer", out)

    def test_rename_out_of_risky_path(self):
        self.repo.write("packages/contracts/src/x.ts", "export const x = 1;\n")
        self.repo.commit("contracts on main")
        git(self.repo.root, "checkout", "-q", "-b", B)
        (self.repo.root / "src").mkdir()
        git(self.repo.root, "mv", "packages/contracts/src/x.ts", "src/x.ts")
        for rel, text in self.repo.task_files("9.9", handoff=HIGH).items():
            self.repo.write(rel, text)
        self.repo.commit("move")
        git(self.repo.root, "checkout", "-q", "main")
        code, out = self.gate()
        self.assertEqual(code, 1, out)
        self.assertIn("risky packages/contracts/src/x.ts", out)
        self.assertIn("missing architect", out)

    def test_unparseable_findings_fail(self):
        for line in ("- [HIGH] src/a.ts:1 — leak", "- [CRITICAL] [acknowledged] src/a.ts:1 — leak",
                     "- [low] [maybe] a.ts — x", "* [MEDIUM]: no state",
                     "[HIGH] src/a.ts:1 — leak", "  [CRITICAL] src/a.ts:1 — leak"):
            with self.subTest(line=line):
                self.fresh()
                self.make({"apps/cli.ts": "x\n"}, review=review() + line + "\n")
                code, out = self.gate()
                self.assertEqual(code, 1, out)
                self.assertIn("no valid state", out)

    def test_pr_head_must_match(self):
        self.make({"apps/cli.ts": "x\n"})
        code, out = self.gate("--pr", "5", env=self.gh_env())
        self.assertEqual(code, 0, out)
        code, out = self.gate("--pr", "5", env=self.gh_env(oid="0" * 40))
        self.assertEqual(code, 1, out)
        self.assertIn("PR head 0000000", out)
        code, out = self.gate("--pr", "5", env=self.gh_env(oid=None))
        self.assertEqual(code, 1, out)
        self.assertIn("head commit", out)

    def test_destructive_migrations(self):
        cases = {
            "packages/db/migrations/0002.sql": "ALTER TABLE students DROP COLUMN email;",
            "packages/db/migrations/0003.sql": "DROP VIEW v;",
            "packages/db/migrations/0004.sql": "DROP MATERIALIZED VIEW mv;",
            "packages/db/migrations/0005.sql": "DROP TYPE t;",
            "packages/db/migrations/0006.sql": "DROP FUNCTION f;",
            "packages/db/migrations/0007.sql": "UPDATE students SET email = NULL;",
            "packages/db/migrations/0008.sql": "delete from students;",
            "packages/db/migrations/0009.ts": "await sql`DROP TABLE students`;",
            "migrations/0010.js": "knex.raw('TRUNCATE students')",
            "packages/db/drizzle/migrations/0011.sql": "DROP TABLE x;",
        }
        for path, body in cases.items():
            with self.subTest(path=path):
                self.fresh()
                self.make({path: body + "\n"}, handoff=HIGH)
                code, out = self.gate()
                self.assertEqual(code, 1, out)
                self.assertIn("drops or deletes data", out)
                self.assertIn("missing database-reviewer", out)

    def test_safe_migration_with_cascade(self):
        self.make({"packages/db/migrations/0002.sql": "CREATE TABLE t (id int REFERENCES s ON DELETE CASCADE);\n"})
        self.assertEqual(self.gate()[0], 0)

    def test_githooks_need_security_reviewer(self):
        self.make({".githooks/pre-commit": "x\n"}, handoff=HIGH)
        code, out = self.gate()
        self.assertEqual(code, 1, out)
        self.assertIn("missing security-reviewer", out)
        self.fresh()
        self.make({".githooks/pre-commit": "x\n"}, review=review("security-reviewer"), handoff=HIGH)
        self.assertEqual(self.gate()[0], 0)

    def test_reviewers_exact_list(self):
        bad = [
            "Reviewers: code-reviewer, security-reviewer skipped",
            "Reviewers: code-reviewer; security-reviewer",
            "Reviewers: code-reviewer, not security-reviewer",
        ]
        for line in bad:
            with self.subTest(line=line):
                self.fresh()
                self.make({".claude/x": "x\n"}, review=f"# r — APPROVE\n{line}\n", handoff=HIGH)
                code, out = self.gate()
                self.assertEqual(code, 1, out)
                self.assertIn("missing security-reviewer", out)

    def test_reviewers_model_suffix_ok(self):
        text = "# r — APPROVE\nReviewers: code-reviewer (sonnet), security-reviewer (opus)\n"
        self.make({".claude/x": "x\n"}, review=text, handoff=HIGH)
        code, out = self.gate()
        self.assertEqual(code, 0, out)

    def test_reviewers_in_code_fence_ignored(self):
        text = "# r — APPROVE\n```\nReviewers: security-reviewer\n```\nReviewers: code-reviewer\n"
        self.make({".claude/x": "x\n"}, review=text, handoff=HIGH)
        code, out = self.gate()
        self.assertEqual(code, 1, out)
        self.assertIn("missing security-reviewer", out)

    def test_only_first_reviewers_line(self):
        text = "# r — APPROVE\nReviewers: code-reviewer\nReviewers: security-reviewer\n"
        self.make({".claude/x": "x\n"}, review=text, handoff=HIGH)
        self.assertEqual(self.gate()[0], 1)

    def test_risk_high_must_end_heading(self):
        handoff = "# h\nStatus: DONE\n\n## Decisions\n### 18 Oct 2026 · 9.9 not risk: high really · risk: low\nDecided: x.\n"
        self.make({".claude/x": "x\n"}, review=review("security-reviewer"), handoff=handoff)
        code, out = self.gate()
        self.assertEqual(code, 1, out)
        self.assertIn("risk: high", out)

    def test_risk_high_trailing_space_ok(self):
        handoff = "# h\nStatus: DONE\n\n## Decisions\n### 18 Oct 2026 · 9.9 x · risk: high  \nDecided: x.\n"
        self.make({".claude/x": "x\n"}, review=review("security-reviewer"), handoff=handoff)
        self.assertEqual(self.gate()[0], 0)


class Wontfix(GateCase):
    REVIEW = review() + "- [LOW] [wontfix] apps/cli.ts:12 — long function, see decision log.\n"

    def handoff(self, entry):
        return f"# h\nStatus: DONE\n\n## Decisions\n{entry}\n## Other\nx\n"

    def test_no_entry_fails(self):
        self.make({"apps/cli.ts": "x\n"}, review=self.REVIEW)
        code, out = self.gate()
        self.assertEqual(code, 1, out)
        self.assertIn("[wontfix] apps/cli.ts has no decision entry naming it", out)

    def test_handoff_entry_naming_basename(self):
        entry = "### 18 Oct 2026 · 9.9 Long function · decided by lead · risk: low\nDecided: Keep cli.ts as one function.\n"
        self.make({"apps/cli.ts": "x\n"}, review=self.REVIEW, handoff=self.handoff(entry))
        code, out = self.gate()
        self.assertEqual(code, 0, out)

    def test_entry_only_in_main_log(self):
        self.repo.write("docs/decisions/log.md", "# log\n\n### 18 Oct 2026 · 9.9 Long function · risk: low\nDecided: Leave apps/cli.ts long.\n")
        self.repo.commit("log")
        self.make({"apps/cli.ts": "x\n"}, review=self.REVIEW)
        code, out = self.gate()
        self.assertEqual(code, 0, out)

    def test_entry_for_other_task(self):
        entry = "### 18 Oct 2026 · 19.9 Long function · risk: low\nDecided: Keep cli.ts as one function.\n"
        self.make({"apps/cli.ts": "x\n"}, review=self.REVIEW, handoff=self.handoff(entry))
        self.assertEqual(self.gate()[0], 1)

    def test_entry_outside_decisions_section(self):
        handoff = "# h\nStatus: DONE\n\n## Decisions\nNone\n\n## Notes\n### 9.9 note\ncli.ts is long\n"
        self.make({"apps/cli.ts": "x\n"}, review=self.REVIEW, handoff=handoff)
        self.assertEqual(self.gate()[0], 1)

    def test_wontfix_without_path(self):
        self.make({"apps/cli.ts": "x\n"}, review=review() + "- [LOW] [wontfix] ... — see decision log.\n")
        code, out = self.gate()
        self.assertEqual(code, 1)
        self.assertIn("names no file", out)


if __name__ == "__main__":
    unittest.main()
