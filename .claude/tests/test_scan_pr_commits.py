""".github/scripts/scan-pr-commits.py: every commit in base..head is scanned with a given scanner, so a
secret added in one commit and deleted in a later one still fails CI.

Values that must trip the scanner are assembled here at runtime from pieces, so no committed file ever
contains one (the repo is public and the scanner runs on this file too).
"""
import shutil
import tempfile
import unittest
from pathlib import Path

from helpers import REPO, git, run

DRIVER = REPO / ".github" / "scripts" / "scan-pr-commits.py"


def fake_aws_key():
    # "AK" + "IA" + 16 upper-case letters: matches the scanner's AWS pattern, but only once joined.
    return "AK" + "IA" + "QWERTYUIOPASDFGH"


def fake_github_token():
    return "gh" + "p_" + "abcdefghijklmnopqrstuvwxyz0123456789"


class ScanPrCommits(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix="edmate-scan-")
        self.addCleanup(tmp.cleanup)
        base = Path(tmp.name).resolve()
        # Main's scanner lives outside the repo, as it does in CI ($RUNNER_TEMP).
        self.scanner_root = base / "main-scanner"
        (self.scanner_root / ".githooks").mkdir(parents=True)
        for rel in (".githooks/secret-scan.py", ".githooks/secret-scan-allow.txt"):
            shutil.copy(REPO / rel, self.scanner_root / rel)
        self.scanner = self.scanner_root / ".githooks" / "secret-scan.py"
        self.root = base / "repo"
        self.root.mkdir()
        git(self.root, "init", "-q", "-b", "main")
        self.write("README.md", "test\n")
        self.commit("init")
        git(self.root, "checkout", "-q", "-b", "pr")

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def remove(self, rel):
        (self.root / rel).unlink()

    def commit(self, msg="change"):
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "--no-verify", "--allow-empty", "-m", msg)
        return git(self.root, "rev-parse", "HEAD")

    def scan(self, *extra, scanner=None, base="main"):
        args = ["python3", str(DRIVER), "--scanner", str(scanner or self.scanner), "--base", base, *extra]
        return run(args, cwd=self.root)

    # --- the acceptance case -------------------------------------------------------------------------

    def test_secret_added_then_removed_fails_and_names_commit_and_path(self):
        key = fake_aws_key()
        self.write("src/config.txt", f"aws = {key}\n")
        bad = self.commit("add key")
        self.remove("src/config.txt")
        self.write("src/other.txt", "clean\n")
        self.commit("remove key")
        # The final tree is clean, so a tree-only scan would miss it.
        self.assertEqual(run(["python3", str(self.scanner), "src/other.txt"], cwd=self.root).returncode, 0)
        r = self.scan()
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn(bad, r.stdout)
        self.assertIn("src/config.txt", r.stdout)
        self.assertIn("AWS access key", r.stdout)

    def test_no_secret_value_or_fragment_in_the_log(self):
        key, tok = fake_aws_key(), fake_github_token()
        self.write("a.txt", f"{key}\n")
        self.write("b.txt", f"{tok}\n")
        self.commit("add two")
        r = self.scan()
        self.assertEqual(r.returncode, 1)
        out = r.stdout + r.stderr
        for value in (key, tok):
            self.assertNotIn(value, out)
            self.assertNotIn(value[:6], out)  # the scanner itself shows a 6-char prefix; we must not
            self.assertNotIn(value[-2:] + "\n", out)

    def test_clean_history_passes(self):
        self.write("src/a.txt", "hello\n")
        self.commit("a")
        self.write("src/a.txt", "hello again\n")
        self.commit("b")
        r = self.scan()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("2 commit", r.stdout)

    def test_no_commits_passes(self):
        r = self.scan()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("0 commit", r.stdout)

    # --- scanner rules carry over --------------------------------------------------------------------

    def test_allow_marker_respected(self):
        self.write("t.txt", f"{fake_aws_key()}  # secret-scan" + ": allow fake fixture\n")
        self.commit("fixture")
        self.assertEqual(self.scan().returncode, 0)

    def test_mains_allowlist_respected_and_pr_allowlist_ignored(self):
        key = fake_aws_key()
        # The PR tries to widen its own allow list; main's (beside the scanner) is what counts.
        self.write(".githooks/secret-scan-allow.txt", "leak.txt\n")
        self.write("leak.txt", f"{key}\n")
        self.commit("sneaky")
        r = self.scan()
        self.assertEqual(r.returncode, 1)
        self.assertIn("leak.txt", r.stdout)
        # And main's list does apply.
        with open(self.scanner_root / ".githooks/secret-scan-allow.txt", "a") as f:
            f.write("leak.txt\n")
        self.assertEqual(self.scan().returncode, 0)

    def test_forbidden_file_added_then_removed_fails(self):
        self.write(".env", "X=1\n")
        bad = self.commit("env")
        self.remove(".env")
        self.commit("rm env")
        r = self.scan()
        self.assertEqual(r.returncode, 1)
        self.assertIn(f"{bad}", r.stdout)
        self.assertIn(".env", r.stdout)

    def test_only_the_offending_commit_is_named(self):
        self.write("a.txt", "ok\n")
        good = self.commit("ok")
        self.write("b.txt", f"{fake_aws_key()}\n")
        bad = self.commit("bad")
        r = self.scan()
        self.assertIn(bad, r.stdout)
        self.assertNotIn(good, r.stdout)

    def test_file_content_as_of_that_commit(self):
        # The secret is in an intermediate version of a file that still exists at the end.
        self.write("a.txt", "v1\n")
        self.commit("v1")
        self.write("a.txt", f"v2 {fake_aws_key()}\n")
        bad = self.commit("v2")
        self.write("a.txt", "v3\n")
        self.commit("v3")
        r = self.scan()
        self.assertEqual(r.returncode, 1)
        self.assertIn(bad, r.stdout)

    # --- awkward inputs ------------------------------------------------------------------------------

    def test_odd_paths(self):
        key = fake_aws_key()
        for rel in ("dir with space/f.txt", "--all", "-x.txt", "uni/café.txt"):
            self.write(rel, f"{key}\n")
        self.commit("odd")
        r = self.scan()
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        for rel in ("dir with space/f.txt", "--all", "-x.txt", "café.txt"):
            self.assertIn(rel, r.stdout)

    def test_single_file_named_like_a_scanner_flag(self):
        self.write("--staged", f"{fake_aws_key()}\n")
        self.commit("flag")
        r = self.scan()
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("--staged", r.stdout)

    def test_deletion_only_commit_passes(self):
        git(self.root, "checkout", "-q", "main")
        self.write("a.txt", "x\n")
        self.commit("main work")
        git(self.root, "checkout", "-q", "-B", "pr", "main")
        self.remove("a.txt")
        self.commit("rm")
        self.assertEqual(self.scan().returncode, 0)

    def test_merge_commit_and_branch_history_scanned(self):
        git(self.root, "checkout", "-q", "-b", "side", "main")
        self.write("side.txt", f"{fake_aws_key()}\n")
        bad = self.commit("side add")
        self.remove("side.txt")
        self.commit("side rm")
        git(self.root, "checkout", "-q", "pr")
        self.write("pr.txt", "ok\n")
        self.commit("pr")
        git(self.root, "merge", "-q", "--no-ff", "--no-edit", "side")
        r = self.scan()
        self.assertEqual(r.returncode, 1)
        self.assertIn(bad, r.stdout)

    def test_secret_introduced_in_merge_resolution(self):
        git(self.root, "checkout", "-q", "-b", "side", "main")
        self.write("s.txt", "ok\n")
        self.commit("side")
        git(self.root, "checkout", "-q", "pr")
        self.write("p.txt", "ok\n")
        self.commit("pr")
        git(self.root, "merge", "-q", "--no-ff", "--no-commit", "side")
        self.write("evil.txt", f"{fake_aws_key()}\n")
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "--no-verify", "-m", "merge")
        merge = git(self.root, "rev-parse", "HEAD")
        r = self.scan()
        self.assertEqual(r.returncode, 1)
        self.assertIn(merge, r.stdout)
        self.assertIn("evil.txt", r.stdout)

    def test_binary_and_symlink_and_mode_change(self):
        (self.root / "img.png").write_bytes(b"\x89PNG\x00\x01" + fake_aws_key().encode())
        (self.root / "bin.dat").write_bytes(b"\x00\xff\xfe" + b"plain")
        (self.root / "link").symlink_to("README.md")
        self.commit("bin")
        self.assertEqual(self.scan().returncode, 0, "png is skipped by the scanner's suffix rule")
        (self.root / "bin.dat").chmod(0o755)
        self.commit("chmod")
        self.assertEqual(self.scan().returncode, 0)

    def test_submodule_entry_is_skipped_not_crashed(self):
        sha = git(self.root, "rev-parse", "HEAD")
        git(self.root, "update-index", "--add", "--cacheinfo", f"160000,{sha},sub")
        git(self.root, "commit", "-q", "--no-verify", "-m", "gitlink")
        r = self.scan()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_many_files_are_batched(self):
        for i in range(450):
            self.write(f"many/f{i:03}.txt", "ok\n")
        self.write("many/zz.txt", f"{fake_aws_key()}\n")
        self.commit("many")
        r = self.scan()
        self.assertEqual(r.returncode, 1)
        self.assertIn("many/zz.txt", r.stdout)

    # --- fail closed ---------------------------------------------------------------------------------

    def test_missing_scanner_is_an_error(self):
        r = self.scan(scanner=self.root / "nope.py")
        self.assertEqual(r.returncode, 2)
        self.assertIn("scanner", r.stderr.lower())

    def test_bad_base_is_an_error(self):
        r = self.scan(base="no-such-ref")
        self.assertEqual(r.returncode, 2)
        self.assertIn("no-such-ref", r.stderr)

    def test_scanner_crash_is_an_error(self):
        broken = self.scanner_root / ".githooks" / "broken.py"
        broken.write_text("import sys\nsys.exit(3)\n")
        self.write("a.txt", "ok\n")
        self.commit("a")
        r = self.scan(scanner=broken)
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)

    def test_unparseable_finding_is_hidden_not_echoed(self):
        noisy = self.scanner_root / ".githooks" / "noisy.py"
        noisy.write_text("import sys\nprint('  weird line SECRETVALUE')\nsys.exit(1)\n")
        self.write("a.txt", "ok\n")
        sha = self.commit("a")
        r = self.scan(scanner=noisy)
        self.assertEqual(r.returncode, 1)
        self.assertNotIn("SECRETVALUE", r.stdout + r.stderr)
        self.assertIn(sha, r.stdout)

    def test_usage_error(self):
        r = run(["python3", str(DRIVER)], cwd=self.root)
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()
