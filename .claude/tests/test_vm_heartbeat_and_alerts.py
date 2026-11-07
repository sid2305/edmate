"""Phase A of board task 0.25 (docs/tasks/0.25/plan.md): heartbeat.sh, the post-commit hook, and
the four monitor-*.sh az scripts, all exercised in DRY_RUN=1 / stub mode -- no real az, curl,
docker or systemctl call, per the plan's "Allowed tools" line.
"""
import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path

from helpers import ENV, git, require_tools, run

ROOT = Path(__file__).resolve().parents[2]
AZURE = ROOT / "infra" / "azure"
HOOKS_DIR = ROOT / ".githooks"
FIXTURES = AZURE / "test"


def setUpModule():
    require_tools()


class BashSyntax(unittest.TestCase):
    def test_every_new_script_parses(self):
        scripts = sorted(AZURE.rglob("*.sh")) + [HOOKS_DIR / "post-commit"]
        self.assertGreater(len(scripts), 5)
        for script in scripts:
            with self.subTest(script=script.relative_to(ROOT)):
                r = run(["bash", "-n", str(script)], cwd=ROOT)
                self.assertEqual(r.returncode, 0, r.stderr)


class HeartbeatScript(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="edmate-heartbeat-")
        self.addCleanup(self.tmp.cleanup)
        self.state_dir = Path(self.tmp.name) / "state"
        self.base_env = dict(ENV, HOME=self.tmp.name, EDMATE_STATE_DIR=str(self.state_dir))

    def run_heartbeat(self, extra_env=None):
        env = dict(self.base_env, **(extra_env or {}))
        return run([str(AZURE / "heartbeat.sh")], cwd=ROOT, env=env)

    def test_no_monitor_env_writes_local_file_only(self):
        r = self.run_heartbeat({"EDMATE_MONITOR_ENV_FILE": str(Path(self.tmp.name) / "absent.env")})
        self.assertEqual(r.returncode, 0, r.stderr)
        state_file = self.state_dir / "heartbeat"
        self.assertTrue(state_file.exists())
        line = state_file.read_text().strip()
        self.assertRegex(line, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        self.assertNotIn("http", r.stdout)
        self.assertNotIn("http", r.stderr)

    def test_dry_run_with_monitor_env_reads_placeholders_and_prints_imds_url_never_a_token(self):
        r = self.run_heartbeat({
            "EDMATE_MONITOR_ENV_FILE": str(FIXTURES / "monitor.env.fake"),
            "DRY_RUN": "1",
        })
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout
        self.assertIn("https://fake-dce.eastus2-1.ingest.monitor.azure.com", out)
        self.assertIn("dcr-00000000000000000000000000000000", out)
        self.assertIn("Custom-EdmateHeartbeat_CL", out)
        self.assertIn("169.254.169.254", out)
        self.assertIn("Bearer <token>", out)
        self.assertNotIn("Bearer ey", out)
        state_file = self.state_dir / "heartbeat"
        self.assertTrue(state_file.exists(), "DRY_RUN must still write the local heartbeat file")

    def test_malformed_monitor_env_degrades_gracefully_not_abort(self):
        """Finding 1 (docs/tasks/0.25b/plan.md): a monitor.env line whose command substitution
        fails must make monitor_post_row return 0 with a one-line stderr note, not abort the
        caller under set -e."""
        r = self.run_heartbeat({"EDMATE_MONITOR_ENV_FILE": str(FIXTURES / "monitor.env.malformed")})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("monitor-ingest: monitor.env failed to source (malformed); skipping", r.stderr)
        state_file = self.state_dir / "heartbeat"
        self.assertTrue(state_file.exists(), "the local heartbeat write must still happen")

    def test_malformed_monitor_env_unset_variable_degrades_gracefully(self):
        """Finding 1's nounset half: a required field that references an undefined shell
        variable must not trip `set -u` and abort; it degrades to the missing-field skip."""
        r = self.run_heartbeat({"EDMATE_MONITOR_ENV_FILE": str(FIXTURES / "monitor.env.malformed-unset")})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("monitor-ingest: monitor.env is missing a field; skipping", r.stderr)
        state_file = self.state_dir / "heartbeat"
        self.assertTrue(state_file.exists(), "the local heartbeat write must still happen")

    def test_curl_calls_have_a_bounded_timeout(self):
        """Finding 2: both curl invocations in monitor-ingest.sh must have --max-time, so a
        network stall cannot hang the unsupervised backgrounded heartbeat.sh process. A static
        check -- there is no live network stall to simulate in this sandbox."""
        text = (AZURE / "lib" / "monitor-ingest.sh").read_text()
        self.assertEqual(text.count("--max-time"), 2, "expected exactly two --max-time curl flags")


class MonitorScripts(unittest.TestCase):
    def setUp(self):
        self.env = dict(
            ENV,
            DRY_RUN="1",
            EDMATE_RG="edmate-test-rg",
            EDMATE_VM="edmate-test-vm",
            EDMATE_WORKSPACE="edmate-test-ws",
            EDMATE_DCE="edmate-test-dce",
            EDMATE_DCR="edmate-test-dcr",
            EDMATE_ACTION_GROUP="edmate-test-oncall",
        )

    def run_script(self, name, *args, env=None):
        return run([str(AZURE / name), *args], cwd=ROOT, env=env if env is not None else self.env)

    def test_monitor_setup_dry_run(self):
        r = self.run_script("monitor-setup.sh")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout + r.stderr
        for expect in ("edmate-test-ws", "edmate-test-dce", "edmate-test-dcr",
                       "EdmateHeartbeat_CL", "Monitoring Metrics Publisher"):
            self.assertIn(expect, out)

    def test_monitor_action_group_refuses_without_phone_or_email(self):
        env = dict(self.env)
        env.pop("EDMATE_ONCALL_PHONE", None)
        env.pop("EDMATE_ONCALL_EMAIL", None)
        r = self.run_script("monitor-action-group.sh", env=env)
        self.assertEqual(r.returncode, 2)
        self.assertIn("phone", r.stderr.lower())

    def test_monitor_action_group_dry_run(self):
        r = self.run_script("monitor-action-group.sh", "1 5550100", "fake@example.invalid")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout + r.stderr
        for expect in ("5550100", "fake@example.invalid", "edmate-test-oncall"):
            self.assertIn(expect, out)

    def test_monitor_vm_down_alert_dry_run(self):
        r = self.run_script("monitor-vm-down-alert.sh")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout + r.stderr
        for expect in ("VmAvailabilityMetric", "edmate-test-vm", "--severity 1", "edmate-test-oncall"):
            self.assertIn(expect, out)

    def test_monitor_heartbeat_alert_dry_run(self):
        r = self.run_script("monitor-heartbeat-alert.sh")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout + r.stderr
        for expect in ("EdmateHeartbeat_CL", "ago(2h)", "edmate-test-oncall", "edmate-test-ws"):
            self.assertIn(expect, out)

    def test_monitor_budget_alert_refuses_without_email(self):
        env = dict(self.env)
        env.pop("EDMATE_ONCALL_EMAIL", None)
        r = self.run_script("monitor-budget-alert.sh", env=env)
        self.assertEqual(r.returncode, 2)
        self.assertIn("EDMATE_ONCALL_EMAIL", r.stderr)

    def test_monitor_setup_real_path_uses_resolved_ids_not_literal_strings(self):
        """Finding 4 (docs/tasks/0.25b/plan.md): with DRY_RUN=0, ensure_dcr()/grant_identity()
        must feed the real `az` calls the *resolved* ids, not the literal escaped string
        "$(az ... )". Proven with a fake `az` stub on PATH -- no real az/curl/docker/systemctl
        call, per the plan's "Out of bounds" line."""
        tmp = tempfile.TemporaryDirectory(prefix="edmate-fake-az-")
        self.addCleanup(tmp.cleanup)
        tmp_path = Path(tmp.name)
        log_file = tmp_path / "az-calls.log"
        stub = tmp_path / "az"
        stub.write_text(
            "#!/bin/bash\n"
            "args=(\"$@\")\n"
            "case \"$*\" in\n"
            "  *'account show'*)\n"
            "    [[ \" $* \" == *'--query name'* ]] && echo fake-subscription-name\n"
            "    exit 0 ;;\n"
            "  *'--query id -o tsv'*workspace*|*workspace*'--query id -o tsv'*)\n"
            "    echo fake-ws-id-0; exit 0 ;;\n"
            "  *'--query id -o tsv'*endpoint*|*endpoint*'--query id -o tsv'*)\n"
            "    echo fake-dce-id-0; exit 0 ;;\n"
            "  *'--query identity.principalId -o tsv'*)\n"
            "    echo fake-principal-id-0; exit 0 ;;\n"
            "  *'rule show'*'--query id -o tsv'*)\n"
            "    echo fake-dcr-id-0; exit 0 ;;\n"
            "  *'create'*|*'role assignment create'*)\n"
            "    printf '%s\\n' \"$*\" >> \"" + str(log_file) + "\"\n"
            "    exit 0 ;;\n"
            "  *'-o none'*)\n"
            "    exit 1 ;;\n"
            "  *)\n"
            "    exit 0 ;;\n"
            "esac\n"
        )
        stub.chmod(0o755)

        env = dict(
            os.environ,
            DRY_RUN="0",
            PATH=f"{tmp_path}:{os.environ['PATH']}",
            EDMATE_RG="edmate-test-rg",
            EDMATE_VM="edmate-test-vm",
            EDMATE_WORKSPACE="edmate-test-ws",
            EDMATE_DCE="edmate-test-dce",
            EDMATE_DCR="edmate-test-dcr",
        )
        r = self.run_script("monitor-setup.sh", env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(log_file.exists(), "no az create/role-assignment call was logged")
        calls = log_file.read_text()

        rule_create = [line for line in calls.splitlines() if "data-collection rule create" in line]
        self.assertEqual(len(rule_create), 1)
        rule_file_path = rule_create[0].split("--rule-file")[1].split()[0]
        rule_body = Path(rule_file_path).read_text()
        self.assertIn("fake-ws-id-0", rule_body)
        self.assertIn("fake-dce-id-0", rule_body)
        self.assertNotIn('"$(az', rule_body)

        role_create = [line for line in calls.splitlines() if "role assignment create" in line]
        self.assertEqual(len(role_create), 1)
        self.assertIn("fake-principal-id-0", role_create[0])
        self.assertIn("fake-dcr-id-0", role_create[0])
        self.assertNotIn('"$(az', role_create[0])
        self.assertNotIn("$(az", role_create[0])

    def test_monitor_budget_alert_dry_run(self):
        env = dict(self.env, EDMATE_ONCALL_EMAIL="fake@example.invalid", EDMATE_MONTHLY_CREDIT="90")
        r = self.run_script("monitor-budget-alert.sh", env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout + r.stderr
        for expect in ("90", "50", "80", "100", "fake@example.invalid", "Monthly"):
            self.assertIn(expect, out)


class BlockersWatch(unittest.TestCase):
    def setUp(self):
        self.env = dict(
            ENV,
            DRY_RUN="1",
            EDMATE_MONITOR_ENV_FILE=str(FIXTURES / "monitor.env.fake"),
        )

    def run_watch(self, fixture):
        env = dict(self.env, EDMATE_BLOCKERS_FILE=str(FIXTURES / fixture))
        return run([str(AZURE / "blockers-watch.sh")], cwd=ROOT, env=env)

    def test_open_entries_post_a_bare_count_never_entry_text(self):
        r = self.run_watch("blockers-open.md")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout + r.stderr
        self.assertIn('"Source":"blocker:2"', out)
        self.assertNotIn("fake blocker", out)

    def test_only_resolved_entries_posts_nothing(self):
        r = self.run_watch("blockers-resolved.md")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("monitor-ingest", r.stdout + r.stderr)

    def test_missing_blockers_file_exits_zero_and_posts_nothing(self):
        env = dict(self.env, EDMATE_BLOCKERS_FILE=str(Path(ROOT) / "no-such-blockers.md"))
        r = run([str(AZURE / "blockers-watch.sh")], cwd=ROOT, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("monitor-ingest", r.stdout + r.stderr)


class SystemdUnits(unittest.TestCase):
    def test_service_and_timer_have_required_stanzas(self):
        service = (AZURE / "edmate-blockers-watch.service").read_text()
        for stanza in ("[Unit]", "[Service]", "[Install]"):
            self.assertIn(stanza, service)
        self.assertIn("ExecStart=", service)

        timer = (AZURE / "edmate-blockers-watch.timer").read_text()
        for stanza in ("[Unit]", "[Timer]", "[Install]"):
            self.assertIn(stanza, timer)
        self.assertIn("OnCalendar=", timer)
        self.assertIn("Timezone=", timer)


class PostCommitHook(unittest.TestCase):
    """A throwaway repo, never the real one, with a stubbed heartbeat.sh (helpers.Repo is built
    for the merge-gate fixtures; this hook needs its own minimal repo plus a git-hooks dir)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="edmate-postcommit-")
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name) / "repo"
        self.repo.mkdir()
        git(self.repo, "init", "-q", "-b", "main")

        hooks_dir = self.repo / ".githooks"
        hooks_dir.mkdir()
        shutil.copy(HOOKS_DIR / "post-commit", hooks_dir / "post-commit")
        os.chmod(hooks_dir / "post-commit", 0o755)
        git(self.repo, "config", "core.hooksPath", ".githooks")

        azure_dir = self.repo / "infra" / "azure"
        azure_dir.mkdir(parents=True)
        self.marker = self.repo / "heartbeat-called"
        stub = f"#!/bin/bash\ntouch '{self.marker}'\nexit \"${{EDMATE_TEST_STUB_EXIT:-0}}\"\n"
        (azure_dir / "heartbeat.sh").write_text(stub)
        os.chmod(azure_dir / "heartbeat.sh", 0o755)

        (self.repo / "README.md").write_text("x\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "--no-verify", "-m", "init")
        self.marker.unlink(missing_ok=True)

    def commit(self, rel, text, env=None):
        p = self.repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        git(self.repo, "add", "-A")
        return run(["git", "commit", "-q", "--no-verify", "-m", f"touch {rel}"], cwd=self.repo, env=env or ENV)

    def wait_for_marker(self, timeout=2.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.marker.exists():
                return True
            time.sleep(0.02)
        return False

    def test_fires_only_on_a_board_commit(self):
        r = self.commit("docs/board/tasks.yaml", "tasks: []\n")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(self.wait_for_marker(), "heartbeat.sh stub was not called for a board commit")

    def test_does_not_fire_on_an_unrelated_commit(self):
        r = self.commit("other.txt", "x\n")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(self.wait_for_marker(timeout=0.3), "heartbeat.sh stub fired for a non-board commit")

    def test_commit_exit_code_is_zero_even_when_the_stub_fails(self):
        env = dict(ENV, EDMATE_TEST_STUB_EXIT="1")
        r = self.commit("docs/board/tasks.yaml", "tasks: [later]\n", env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        # Drain the backgrounded stub before tearDown's tmp.cleanup() removes the repo dir --
        # otherwise the stub can still be writing the marker file mid-rmtree.
        self.wait_for_marker()


if __name__ == "__main__":
    unittest.main()
