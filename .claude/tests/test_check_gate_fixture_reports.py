"""Unit tests for `.github/scripts/check_gate_fixture_reports.py` (task 7.5 Phase B): the script
that decides whether the `gate-fixtures` CI job's two `edmate gate demo` runs (good/leaky) prove
what they must, without a human eyeballing JSON reports. Written before the script (TDD)."""
import json
import subprocess
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / ".github" / "scripts" / "check_gate_fixture_reports.py"
LEAK_ID = "gen-lock-demo-package-free-direct-qr-15"


def report(pass_, failed_case_ids):
    return {"pass": pass_, "failedCaseIds": failed_case_ids}


class CheckGateFixtureReports(unittest.TestCase):
    def setUp(self):
        self.good_path = None
        self.leaky_path = None

    def write(self, tmp_path, name, data):
        p = Path(tmp_path) / name
        p.write_text(json.dumps(data))
        return p

    def run_script(self, good, leaky, leaky_exit_code, leak_case_id=LEAK_ID):
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--good",
                str(good),
                "--leaky",
                str(leaky),
                "--leaky-exit-code",
                str(leaky_exit_code),
                "--leak-case-id",
                leak_case_id,
            ],
            capture_output=True,
            text=True,
        )

    def test_good_passes_leaky_fails_on_exactly_the_leak_case(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            good = self.write(d, "good.json", report(True, []))
            leaky = self.write(d, "leaky.json", report(False, [LEAK_ID]))
            r = self.run_script(good, leaky, 1)
            self.assertEqual(r.returncode, 0, r.stderr)

    def test_fails_when_good_report_does_not_pass(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            good = self.write(d, "good.json", report(False, ["some-other-case"]))
            leaky = self.write(d, "leaky.json", report(False, [LEAK_ID]))
            r = self.run_script(good, leaky, 1)
            self.assertEqual(r.returncode, 1)
            self.assertIn("good", r.stderr.lower())

    def test_fails_when_leaky_exit_code_is_zero(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            good = self.write(d, "good.json", report(True, []))
            leaky = self.write(d, "leaky.json", report(False, [LEAK_ID]))
            r = self.run_script(good, leaky, 0)
            self.assertEqual(r.returncode, 1)
            self.assertIn("exit code", r.stderr.lower())

    def test_fails_when_leaky_report_unexpectedly_passes(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            good = self.write(d, "good.json", report(True, []))
            # Nonsensical in practice (exit 1 but pass:true) but exactly the "silent exit 0 but
            # pass:false" style bug this check exists to catch, mirrored the other way.
            leaky = self.write(d, "leaky.json", report(True, []))
            r = self.run_script(good, leaky, 1)
            self.assertEqual(r.returncode, 1)
            self.assertIn("unexpectedly passed", r.stderr.lower())

    def test_fails_when_leaky_report_fails_on_the_wrong_case_id(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            good = self.write(d, "good.json", report(True, []))
            leaky = self.write(d, "leaky.json", report(False, ["some-other-case"]))
            r = self.run_script(good, leaky, 1)
            self.assertEqual(r.returncode, 1)
            self.assertIn("failedcaseids", r.stderr.lower())

    def test_fails_when_leaky_report_fails_on_more_than_one_case(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            good = self.write(d, "good.json", report(True, []))
            leaky = self.write(d, "leaky.json", report(False, [LEAK_ID, "some-other-case"]))
            r = self.run_script(good, leaky, 1)
            self.assertEqual(r.returncode, 1)
            self.assertIn("failedcaseids", r.stderr.lower())


if __name__ == "__main__":
    unittest.main()
