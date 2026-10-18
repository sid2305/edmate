"""The hooks' remaining hard blocks (main's copies, unchanged by 0.7; these tests only run them).

The hooks have no "ask" rules any more (human decision, 18 Oct 2026); merges are checked by the gate.
"""
import unittest

from helpers import ENV, Repo, git, require_tools, run_hook


def setUpModule():
    require_tools()


class HookCase(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()
        self.addCleanup(self.repo.cleanup)
        self.env = dict(ENV, CLAUDE_PROJECT_DIR=str(self.repo.root))

    def bash(self, cmd):
        return run_hook("guard-bash.sh", {"command": cmd}, self.repo.root, self.env)[:2]

    def edit(self, rel):
        return run_hook("guard-paths.sh", {"file_path": f"{self.repo.root}/{rel}"}, self.repo.root, self.env)[0]


class GuardBash(HookCase):
    def test_force_push_denied(self):
        self.assertEqual(self.bash("git push --force origin m9/9.9-x")[0], "deny")
        self.assertEqual(self.bash("git push -f origin m9/9.9-x")[0], "deny")

    def test_push_main_allowed_when_scan_clean(self):
        self.assertIsNone(self.bash("git push origin main")[0])

    def test_push_main_denied_when_scan_flags(self):
        self.repo.write(".npmrc", "registry=x\n")  # a forbidden file name, no secret content needed
        git(self.repo.root, "add", "-f", ".npmrc")
        git(self.repo.root, "commit", "-q", "--no-verify", "-m", "npmrc")
        d, reason = self.bash("git push origin main")
        self.assertEqual(d, "deny")
        self.assertIn("Secret scan", reason)

    def test_label_denied(self):
        self.assertEqual(self.bash("gh pr edit 3 --add-label human-approved")[0], "deny")

    def test_merge_needs_number(self):
        self.assertEqual(self.bash("gh pr merge --squash")[0], "deny")

    def test_env_denied(self):
        self.assertEqual(self.bash("cat .env")[0], "deny")
        self.assertIsNone(self.bash("cat docker/env.example")[0])

    def test_no_asks(self):
        for cmd in ("git merge --squash m9/9.9-x", "git commit -m x", "echo x > packages/payments/a.ts", "corepack pnpm test"):
            with self.subTest(cmd=cmd):
                self.assertIsNone(self.bash(cmd)[0])


class GuardPaths(HookCase):
    def test_secrets_denied(self):
        for rel in (".env", "apps/web/.env.local", "keys/server.pem", "credentials.json"):
            with self.subTest(rel=rel):
                self.assertEqual(self.edit(rel), "deny")

    def test_examples_and_code_allowed(self):
        for rel in ("docker/env.example", "packages/contracts/src/x.ts", ".claude/skills/merge-gate/merge_gate.py", "content/skills/s.md"):
            with self.subTest(rel=rel):
                self.assertIsNone(self.edit(rel))


if __name__ == "__main__":
    unittest.main()
