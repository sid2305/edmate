"""Static checks on .github/workflows/*.yml and the PR template (no runner needed): every action is
pinned by full commit SHA, permissions are minimal, the gate and labeller run main's scripts (never the
PR's), CI runs every gate, and nothing references the retired human-approved label."""
import re
import unittest

from helpers import REPO, require_tools

WF = REPO / ".github" / "workflows"
NAMES = ("ci.yml", "merge-gate.yml", "risk-label.yml")
FETCH_PR = re.compile(r'git fetch[^\n]*"\+refs/pull/\$\{\{ github\.event\.pull_request\.number \}\}/head:')


def setUpModule():
    require_tools()


def load(name):
    import yaml

    text = (WF / name).read_text()
    data = yaml.safe_load(text)
    # PyYAML reads the bare key `on` as True.
    data["on"] = data.pop(True, data.get("on"))
    return text, data


def steps(data):
    return [s for job in data["jobs"].values() for s in job.get("steps", [])]


def run_text(data):
    return "\n".join(s.get("run", "") for s in steps(data))


class Workflows(unittest.TestCase):
    def test_all_files_exist_and_parse(self):
        for n in NAMES:
            _, data = load(n)
            self.assertIn("jobs", data, n)
            self.assertIn("name", data, n)

    def test_every_action_pinned_by_full_sha(self):
        for n in NAMES:
            for s in steps(load(n)[1]):
                if "uses" in s:
                    self.assertRegex(s["uses"], r"^[\w.-]+/[\w./-]+@[0-9a-f]{40}$", f"{n}: {s['uses']}")

    def test_pins_carry_a_version_comment(self):
        for n in NAMES:
            for line in load(n)[0].splitlines():
                if re.search(r"\buses:", line):
                    self.assertRegex(line, r"@[0-9a-f]{40}\s+#\s*v\d", f"{n}: {line.strip()}")

    def test_top_level_permissions_are_explicit_and_minimal(self):
        allowed = {"ci.yml": {"contents": "read"},
                   "merge-gate.yml": {"contents": "read", "pull-requests": "read"},
                   "risk-label.yml": {"contents": "read", "issues": "write", "pull-requests": "write"}}
        for n in NAMES:
            data = load(n)[1]
            self.assertEqual(data.get("permissions"), allowed[n], n)
            for job in data["jobs"].values():
                self.assertNotIn("permissions", job, f"{n}: jobs must not widen permissions")

    def test_no_pull_request_target(self):
        for n in NAMES:
            self.assertNotIn("pull_request_target", load(n)[0], n)

    def test_no_human_approved_anywhere(self):
        for n in NAMES:
            self.assertNotIn("human-approved", load(n)[0], n)
        self.assertNotIn("human-approved", (REPO / ".github/pull_request_template.md").read_text())

    def test_checkouts_do_not_keep_credentials(self):
        for n in NAMES:
            for s in steps(load(n)[1]):
                if s.get("uses", "").startswith("actions/checkout@"):
                    self.assertIs(s.get("with", {}).get("persist-credentials"), False, n)

    def test_gate_and_labeller_run_mains_scripts(self):
        for n in ("merge-gate.yml", "risk-label.yml"):
            text, data = load(n)
            co = [s for s in steps(data) if s.get("uses", "").startswith("actions/checkout@")]
            self.assertEqual(len(co), 1, n)
            self.assertEqual(co[0]["with"].get("ref"), "main", f"{n}: must check out main, not the PR")
            self.assertEqual(co[0]["with"].get("fetch-depth"), 0, n)
            self.assertRegex(text, FETCH_PR, n)
            self.assertNotIn("pull_request.head.sha }}", run_text(data).split("git fetch")[0], n)

    def test_untrusted_pr_fields_go_through_env_not_inline(self):
        # head.ref and the title are attacker-chosen; inlining them in `run:` is script injection.
        for n in NAMES:
            data = load(n)[1]
            for s in steps(data):
                self.assertNotRegex(s.get("run", ""), r"\$\{\{\s*github\.(event\.pull_request\.(head\.ref|title|body)|head_ref)", n)

    def test_gate_runs_pr_mode_with_token(self):
        text, data = load("merge-gate.yml")
        self.assertIn("pull_request", data["on"])
        self.assertEqual(set(data["on"]["pull_request"]["types"]), {"opened", "synchronize", "reopened", "edited"})
        self.assertIn("merge_gate.py --pr", run_text(data))
        envs = [s.get("env", {}) for s in steps(data) if "merge_gate.py" in s.get("run", "")]
        self.assertEqual(envs[0].get("GH_TOKEN"), "${{ github.token }}")

    def test_job_names_match_branch_protection(self):
        self.assertEqual(load("ci.yml")[1]["name"], "CI")
        self.assertEqual(set(load("ci.yml")[1]["jobs"]), {"node", "python-harness", "secrets"})
        self.assertEqual(load("merge-gate.yml")[1]["name"], "Merge gate")
        self.assertEqual(set(load("merge-gate.yml")[1]["jobs"]), {"check"})

    def test_ci_runs_every_gate(self):
        data = load("ci.yml")[1]
        self.assertEqual(data["on"]["push"]["branches"], ["main"])
        self.assertIn("pull_request", data["on"])
        node = "\n".join(s.get("run", "") for s in data["jobs"]["node"]["steps"])
        self.assertIn("--frozen-lockfile", node)
        self.assertIn("turbo run build typecheck lint test", node)
        py = "\n".join(s.get("run", "") for s in data["jobs"]["python-harness"]["steps"])
        self.assertIn("python3 -m unittest discover -v .claude/tests", py)
        self.assertIn("python3 .githooks/secret-scan.py --all", py)
        self.assertIn("python3 docs/adr/check-headings.py", py)
        self.assertIn("-s docs/adr -p 'test_*.py'", py)

    def test_secrets_job_scans_every_pr_commit_with_mains_scanner(self):
        text, data = load("ci.yml")
        job = data["jobs"]["secrets"]
        self.assertEqual(job.get("if"), "github.event_name == 'pull_request'")
        self.assertNotIn("permissions", job)  # inherits contents: read
        self.assertIn("timeout-minutes", job)
        co = [s for s in job["steps"] if s.get("uses", "").startswith("actions/checkout@")]
        self.assertEqual(len(co), 1)
        self.assertEqual(co[0]["with"].get("fetch-depth"), 0)
        self.assertIs(co[0]["with"].get("persist-credentials"), False)
        body = "\n".join(s.get("run", "") for s in job["steps"])
        # Scanner and allow list come from main, into $RUNNER_TEMP, never the PR's copy.
        self.assertIn('git show origin/main:.githooks/secret-scan.py > "$RUNNER_TEMP/main-scanner/.githooks/secret-scan.py"', body)
        self.assertIn('git show origin/main:.githooks/secret-scan-allow.txt > "$RUNNER_TEMP/main-scanner/.githooks/secret-scan-allow.txt"', body)
        self.assertIn('--scanner "$RUNNER_TEMP/main-scanner/.githooks/secret-scan.py"', body)
        self.assertIn("--base origin/main", body)
        self.assertNotRegex(body, r"python3 \.githooks/secret-scan\.py")
        # The driver is main's once it exists there; the PR's copy only bootstraps the first PR.
        self.assertIn("git show origin/main:.github/scripts/scan-pr-commits.py", body)
        self.assertIn("set -euo pipefail", body)

    def test_existing_tree_scan_kept(self):
        py = "\n".join(s.get("run", "") for s in load("ci.yml")[1]["jobs"]["python-harness"]["steps"])
        self.assertIn("python3 .githooks/secret-scan.py --all", py)

    def test_labeller_uses_the_labeller_vocabulary(self):
        text, data = load("risk-label.yml")
        body = run_text(data)
        self.assertIn("risk_labels.py --vocabulary", body)
        self.assertIn("risk_labels.py", body.replace("risk_labels.py --vocabulary", ""))


class PrTemplate(unittest.TestCase):
    def test_sections(self):
        text = (REPO / ".github/pull_request_template.md").read_text()
        for h in ("Task", "Plan", "Handoff", "Evidence", "Risky paths touched", "Reviewers"):
            self.assertRegex(text, rf"(?m)^## {h}\b", h)


if __name__ == "__main__":
    unittest.main()
