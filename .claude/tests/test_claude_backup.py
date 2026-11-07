"""Board task 0.26 (docs/tasks/0.26/plan.md): scripts/claude-backup.sh's Linux IMDS/Entra path and
the switch-back (`auto` mode) statelessness, exercised with a fake `curl` and a fake `claude` on a
prepended `PATH` -- no real az/curl/claude/Azure/Foundry/Anthropic call, per the plan's "Files out
of bounds" line.
"""
import os
import stat
import tempfile
import unittest
from pathlib import Path

from helpers import require_tools, run

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "claude-backup.sh"
FIXTURE_ENV = ROOT / "scripts" / "test" / "foundry.env.fake"

FAKE_TOKEN = "FAKE-IMDS-TOKEN-VALUE-abc123"

CURL_OK = """#!/bin/bash
case "$*" in
  *cognitiveservices.azure.com*)
    echo '{"access_token":"%s"}'
    exit 0
    ;;
  *)
    exit 1
    ;;
esac
""" % FAKE_TOKEN

CURL_FAIL = """#!/bin/bash
# Simulates "not actually on an Azure VM" / role not yet granted: every URL fails.
exit 1
"""

CURL_POISON = """#!/bin/bash
# Must never run in the configured-key test: proves the IMDS path is unreached, not just stubbed.
echo "FAKE CURL CALLED UNEXPECTEDLY: $*" >&2
exit 1
"""

CLAUDE_STUB = """#!/bin/bash
# Dispatch on arguments: the probe's exact flags, or anything else (the final `exec claude "$@"`).
if [ "${1:-}" = "-p" ]; then
  case "${CLAUDE_PROBE_MODE:-ok}" in
    ok) echo ok; exit 0 ;;
    limit) echo "You have hit your limit for this period."; exit 1 ;;
    error) echo "some other, unrelated probe error"; exit 1 ;;
  esac
else
  env | grep -E '^(ANTHROPIC_|CLAUDE_CODE_USE_FOUNDRY|EDMATE_PROVIDER)' | sort
  exit 0
fi
"""


def setUpModule():
    require_tools()


def write_exec(path: Path, content: str):
    path.write_text(content)
    path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


class BackupScriptCase(unittest.TestCase):
    """Builds a temp PATH dir (fake curl/claude) and a temp foundry.env config per test."""

    curl_script = CURL_OK
    api_key = ""  # empty -> Keychain/Entra branches are exercised

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="edmate-claude-backup-")
        self.addCleanup(self.tmp.cleanup)
        self.tmp_path = Path(self.tmp.name)
        self.bin_dir = self.tmp_path / "bin"
        self.bin_dir.mkdir()
        self.log_path = self.tmp_path / "backup.log"

        write_exec(self.bin_dir / "claude", CLAUDE_STUB)
        if self.curl_script is not None:
            write_exec(self.bin_dir / "curl", self.curl_script)

        fixture = FIXTURE_ENV.read_text()
        config_text = fixture.replace(
            "ANTHROPIC_FOUNDRY_API_KEY=", f"ANTHROPIC_FOUNDRY_API_KEY={self.api_key}"
        )
        self.config_path = self.tmp_path / "foundry.env"
        self.config_path.write_text(config_text)
        self.config_path.chmod(0o600)

        self.base_env = dict(
            os.environ,
            PATH=f"{self.bin_dir}:{os.environ['PATH']}",
            HOME=str(self.tmp_path),
            EDMATE_FOUNDRY_ENV=str(self.config_path),
            EDMATE_BACKUP_LOG=str(self.log_path),
        )

    def run_backup(self, *args, env_extra=None):
        env = dict(self.base_env, **(env_extra or {}))
        return run([str(SCRIPT), *args], cwd=ROOT, env=env)

    def log_text(self):
        return self.log_path.read_text() if self.log_path.exists() else ""


class BashSyntax(unittest.TestCase):
    def test_claude_backup_parses(self):
        r = run(["bash", "-n", str(SCRIPT)], cwd=ROOT)
        self.assertEqual(r.returncode, 0, r.stderr)


class TestLinuxEntraPath(BackupScriptCase):
    def test_imds_token_fetched_and_set_as_auth_token_not_api_key(self):
        r = self.run_backup("--foundry")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"ANTHROPIC_FOUNDRY_AUTH_TOKEN={FAKE_TOKEN}", r.stdout)
        self.assertNotIn("ANTHROPIC_FOUNDRY_API_KEY=", r.stdout)
        self.assertIn("CLAUDE_CODE_USE_FOUNDRY=1", r.stdout)

    def test_token_never_appears_in_log_or_stderr(self):
        r = self.run_backup("--foundry")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn(FAKE_TOKEN, r.stderr)
        self.assertNotIn(FAKE_TOKEN, self.log_text())
        self.assertIn("entra-imds", r.stderr)
        self.assertIn("entra-imds", self.log_text())

    def test_failed_imds_fetch_falls_back_to_plain_entra_with_nothing_set(self):
        self.curl_script = CURL_FAIL
        self.setUp()
        r = self.run_backup("--foundry")
        self.assertEqual(r.returncode, 0, r.stderr)
        # "auth entra," (trailing comma from the say() format) so this can't match the
        # "auth entra-imds," variant too -- a mislabelling regression must fail this test.
        self.assertIn("auth entra,", r.stderr)
        self.assertNotIn("ANTHROPIC_FOUNDRY_API_KEY=", r.stdout)
        self.assertNotIn("ANTHROPIC_FOUNDRY_AUTH_TOKEN=", r.stdout)

    def test_configured_key_skips_the_imds_fetch_entirely(self):
        self.api_key = "fake-key-123"
        self.curl_script = CURL_POISON
        self.setUp()
        r = self.run_backup("--foundry")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("auth env", r.stderr)
        self.assertIn("ANTHROPIC_FOUNDRY_API_KEY=fake-key-123", r.stdout)
        self.assertNotIn("FAKE CURL CALLED UNEXPECTEDLY", r.stderr)


class TestAutoSwitchBack(BackupScriptCase):
    def test_check_mode_reports_subscription_ok(self):
        r = self.run_backup("--check", env_extra={"CLAUDE_PROBE_MODE": "ok"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("subscription OK.", r.stderr)

    def test_check_mode_reports_foundry_on_usage_limit(self):
        r = self.run_backup("--check", env_extra={"CLAUDE_PROBE_MODE": "limit"})
        self.assertEqual(r.returncode, 1, r.stderr)
        self.assertIn("the backup would start on Foundry.", r.stderr)

    def test_other_probe_error_refuses_to_switch(self):
        r = self.run_backup("--check", env_extra={"CLAUDE_PROBE_MODE": "error"})
        self.assertEqual(r.returncode, 2, r.stderr)
        r2 = self.run_backup(env_extra={"CLAUDE_PROBE_MODE": "error"})
        self.assertEqual(r2.returncode, 2, r2.stderr)
        self.assertEqual(r2.stdout, "")

    def test_auto_mode_returns_to_subscription_even_with_foundry_env_present(self):
        r = self.run_backup(env_extra={"CLAUDE_PROBE_MODE": "ok"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("EDMATE_PROVIDER=subscription", r.stdout)
        self.assertNotIn("CLAUDE_CODE_USE_FOUNDRY=1", r.stdout)

    def test_auto_mode_starts_foundry_on_usage_limit(self):
        r = self.run_backup(env_extra={"CLAUDE_PROBE_MODE": "limit"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"ANTHROPIC_FOUNDRY_AUTH_TOKEN={FAKE_TOKEN}", r.stdout)
        self.assertNotIn("ANTHROPIC_FOUNDRY_API_KEY=", r.stdout)
        self.assertIn("CLAUDE_CODE_USE_FOUNDRY=1", r.stdout)
        self.assertIn("EDMATE_PROVIDER=foundry", r.stdout)


if __name__ == "__main__":
    unittest.main()
