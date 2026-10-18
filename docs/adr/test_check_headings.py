"""Tests for check-headings.py. Run: python3 -m unittest discover -s docs/adr -p 'test_*.py'"""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("check-headings.py")
HEADINGS = ["Status", "Date", "Context", "Decision", "Alternatives", "Consequences", "Reviewers"]


def adr(headings):
    return "# ADR-0001: Test\n\n" + "".join(f"## {h}\ntext\n\n" for h in headings)


def run(files):
    with tempfile.TemporaryDirectory() as d:
        for name, body in files.items():
            Path(d, name).write_text(body, encoding="utf-8")
        p = subprocess.run([sys.executable, str(SCRIPT), d], capture_output=True, text=True)
        return p.returncode, p.stdout + p.stderr


class CheckHeadings(unittest.TestCase):
    def test_all_headings_in_order_passes_silently(self):
        code, out = run({"0001-a.md": adr(HEADINGS)})
        self.assertEqual((code, out), (0, ""))

    def test_missing_heading_fails_and_names_file_and_heading(self):
        code, out = run({"0001-a.md": adr([h for h in HEADINGS if h != "Alternatives"])})
        self.assertEqual(code, 1)
        self.assertIn("0001-a.md", out)
        self.assertIn("missing: Alternatives", out)

    def test_out_of_order_fails(self):
        swapped = ["Date", "Status"] + HEADINGS[2:]
        code, out = run({"0002-b.md": adr(swapped)})
        self.assertEqual(code, 1)
        self.assertIn("0002-b.md", out)
        self.assertIn("out of order", out)

    def test_template_is_skipped(self):
        code, out = run({"0000-template.md": "# nothing\n", "0001-a.md": adr(HEADINGS)})
        self.assertEqual((code, out), (0, ""))

    def test_non_adr_files_are_ignored(self):
        code, _ = run({"README.md": "# no headings\n", "notes-0001.md": "x\n"})
        self.assertEqual(code, 0)

    def test_heading_text_inside_a_line_does_not_count(self):
        body = adr([h for h in HEADINGS if h != "Reviewers"]) + "See ## Reviewers below\n"
        code, out = run({"0003-c.md": body})
        self.assertEqual(code, 1)
        self.assertIn("missing: Reviewers", out)

    def test_deeper_heading_does_not_count(self):
        body = adr(HEADINGS[:-1]) + "### Reviewers\n"
        code, out = run({"0003-c.md": body})
        self.assertEqual(code, 1)
        self.assertIn("missing: Reviewers", out)

    def test_reports_every_bad_file(self):
        code, out = run({"0001-a.md": adr(HEADINGS[1:]), "0002-b.md": adr(HEADINGS[:-1])})
        self.assertEqual(code, 1)
        self.assertIn("0001-a.md", out)
        self.assertIn("0002-b.md", out)

    def test_missing_directory_fails(self):
        p = subprocess.run([sys.executable, str(SCRIPT), "/nonexistent-adr-dir"], capture_output=True, text=True)
        self.assertEqual(p.returncode, 1)
        self.assertIn("not a directory", p.stdout + p.stderr)

    def test_default_dir_is_the_real_adr_folder(self):
        p = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True)
        self.assertEqual((p.returncode, p.stdout + p.stderr), (0, ""))


if __name__ == "__main__":
    unittest.main()
