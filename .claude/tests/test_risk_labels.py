"""risk_labels.py in throwaway repos: one `needs:<reviewer>` label per reviewer a touched risk group
requires (risk-paths.txt, read through merge_gate.py), database-reviewer for destructive migrations,
and `risk:touched` when any label applies."""
import unittest

from helpers import RepoCase, git, require_tools

B = "m9/9.9-x"


def setUpModule():
    require_tools()


class Labels(RepoCase):
    def labels(self, files, branch=B):
        self.repo.branch(branch, files)
        r = self.repo.script("labels", branch)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return r.stdout.split()

    def test_payments_needs_security(self):
        self.assertEqual(self.labels({"packages/payments/x.ts": "x\n"}), ["needs:security-reviewer", "risk:touched"])

    def test_prompt_pack_needs_safety(self):
        self.assertEqual(self.labels({"content/prompt-packs/x.md": "x\n"}), ["needs:safety-reviewer", "risk:touched"])

    def test_harness_hooks_need_security(self):
        self.assertEqual(self.labels({".claude/hooks/x.sh": "x\n"}), ["needs:security-reviewer", "risk:touched"])

    def test_github_needs_security(self):
        self.assertEqual(self.labels({".github/workflows/x.yml": "x\n"}), ["needs:security-reviewer", "risk:touched"])

    def test_contracts_need_three_reviewers(self):
        self.assertEqual(
            self.labels({"packages/contracts/x.ts": "x\n"}),
            ["needs:architect", "needs:security-reviewer", "needs:typescript-reviewer", "risk:touched"],
        )

    def test_several_groups_union_without_duplicates(self):
        got = self.labels({"packages/payments/x.ts": "x\n", ".github/a.yml": "x\n", "content/skills/s.md": "x\n"})
        self.assertEqual(got, ["needs:safety-reviewer", "needs:security-reviewer", "risk:touched"])

    def test_normal_file_has_no_labels(self):
        self.assertEqual(self.labels({"apps/cli/src/x.ts": "x\n"}), [])

    def test_destructive_migration_adds_database_reviewer(self):
        got = self.labels({"packages/db/migrations/0002_drop.sql": "DROP TABLE students;\n"})
        self.assertEqual(got, ["needs:database-reviewer", "risk:touched"])

    def test_destructive_migration_on_top_of_a_path_group(self):
        got = self.labels({"packages/db/src/repositories/migrations/0003.sql": "DELETE FROM x;\n"})
        self.assertEqual(got, ["needs:database-reviewer", "needs:security-reviewer", "risk:touched"])

    def test_additive_migration_is_not_risky(self):
        self.assertEqual(self.labels({"packages/db/migrations/0002_add.sql": "CREATE TABLE t (id int);\n"}), [])

    def test_deleted_risky_file_still_counts(self):
        self.repo.write("packages/payments/old.ts", "x\n")
        self.repo.commit("add old")
        git(self.repo.root, "checkout", "-q", "-b", B)
        git(self.repo.root, "rm", "-q", "packages/payments/old.ts")
        self.repo.commit("rm old")
        git(self.repo.root, "checkout", "-q", "main")
        r = self.repo.script("labels", B)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(r.stdout.split(), ["needs:security-reviewer", "risk:touched"])

    def test_deleted_migration_matches_the_gate(self):
        # Like merge_gate.py, a migration is judged by its content on the branch; a deleted one has none.
        self.repo.write("packages/db/migrations/0001.sql", "DROP TABLE x;\n")
        self.repo.commit("add migration")
        git(self.repo.root, "checkout", "-q", "-b", B)
        git(self.repo.root, "rm", "-q", "packages/db/migrations/0001.sql")
        self.repo.commit("rm migration")
        git(self.repo.root, "checkout", "-q", "main")
        r = self.repo.script("labels", B)
        self.assertEqual((r.returncode, r.stdout.split()), (0, []))

    def test_vocabulary_lists_every_possible_label(self):
        r = self.repo.script("labels", "--vocabulary")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(
            r.stdout.split(),
            ["needs:architect", "needs:database-reviewer", "needs:safety-reviewer",
             "needs:security-reviewer", "needs:typescript-reviewer", "risk:touched"],
        )

    def test_vocabulary_never_has_human_approved(self):
        r = self.repo.script("labels", "--vocabulary")
        self.assertNotIn("human-approved", r.stdout)

    def test_missing_branch_fails(self):
        r = self.repo.script("labels", "m9/nope")
        self.assertEqual(r.returncode, 1)
        self.assertIn("no changes against main", r.stdout + r.stderr)

    def test_glob_without_reviewers_fails_closed(self):
        txt = self.repo.root / ".claude/skills/merge-gate/risk-paths.txt"
        txt.write_text("orphan/**\n" + txt.read_text())
        self.repo.commit("orphan glob")
        self.repo.branch(B, {"orphan/x.ts": "x\n"})
        r = self.repo.script("labels", B)
        self.assertEqual(r.returncode, 1)
        self.assertIn("no '# reviewers:' line", r.stdout + r.stderr)

    def test_usage(self):
        r = self.repo.script("labels")
        self.assertEqual(r.returncode, 2)
        self.assertIn("risk_labels.py <branch>", r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
