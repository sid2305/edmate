"""Stands in for "nothing in the repo names the subscription, IP or account" (board task 0.25's
accept line) on every future PR, not just this one. Greps every committed file under
infra/azure/** (except infra/azure/test/, the dry-run tests' own obviously-fake fixtures -- see
docs/tasks/0.25/plan.md "Tests first" item 4) and docs/azure-vm.md for a subscription-GUID shape,
a real IPv4 literal, or a filled-in on-call phone/email. Fails loudly (never silently skips --
docs/lessons.md "a check that silently skips looks like a pass") if a file it expects to scan is
missing.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AZURE_DIR = ROOT / "infra" / "azure"
AZURE_VM_DOC = ROOT / "docs" / "azure-vm.md"
EXCLUDED_DIR = AZURE_DIR / "test"

GUID_RE = re.compile(r"\b[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b")
IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
ONCALL_FILLED_RE = re.compile(r"\b(?:EDMATE_ONCALL_PHONE|EDMATE_ONCALL_EMAIL)=(\S.*)$")

# 169.254.169.254 is Azure's fixed link-local IMDS address, the same on every subscription --
# a documented platform constant, not a resource identifier (infra/azure/lib/monitor-ingest.sh).
ALLOWED_IPV4 = {"169.254.169.254"}


def scanned_files():
    """Every file under infra/azure/** (excluding the test/ fixtures dir) plus docs/azure-vm.md.
    Raises instead of returning an empty/partial list when something expected is missing, so a
    broken scan path fails the test loudly rather than silently passing."""
    if not AZURE_DIR.is_dir():
        raise AssertionError(f"expected {AZURE_DIR} to exist and be a directory")
    if not AZURE_VM_DOC.is_file():
        raise AssertionError(f"expected {AZURE_VM_DOC} to exist")
    files = [
        p for p in AZURE_DIR.rglob("*")
        if p.is_file() and EXCLUDED_DIR not in (p, *p.parents)
    ]
    if not files:
        raise AssertionError(f"found no files under {AZURE_DIR} -- the scan path is broken")
    files.append(AZURE_VM_DOC)
    return files


class NoAzureIdentifiers(unittest.TestCase):
    def test_no_subscription_guid_shape(self):
        hits = [
            f"{path.relative_to(ROOT)}:{n}: {line.strip()}"
            for path in scanned_files()
            for n, line in enumerate(path.read_text().splitlines(), 1)
            if GUID_RE.search(line)
        ]
        self.assertEqual(hits, [], f"subscription-GUID-shaped string found: {hits}")

    def test_no_real_ipv4_literal(self):
        hits = [
            f"{path.relative_to(ROOT)}:{n}: {m.group(0)}"
            for path in scanned_files()
            for n, line in enumerate(path.read_text().splitlines(), 1)
            for m in IPV4_RE.finditer(line)
            if m.group(0) not in ALLOWED_IPV4
        ]
        self.assertEqual(hits, [], f"IPv4 literal found (not the documented IMDS address): {hits}")

    def test_no_filled_in_oncall_contact(self):
        hits = [
            f"{path.relative_to(ROOT)}:{n}: {line.strip()}"
            for path in scanned_files()
            for n, line in enumerate(path.read_text().splitlines(), 1)
            if ONCALL_FILLED_RE.search(line)
        ]
        self.assertEqual(hits, [], f"a filled-in EDMATE_ONCALL_PHONE/EDMATE_ONCALL_EMAIL value found: {hits}")

    def test_scan_path_itself_is_not_silently_empty(self):
        # A regression guard for the scan helper, not the repo: if infra/azure/ or
        # docs/azure-vm.md ever moved, scanned_files() must raise, not return [].
        files = scanned_files()
        self.assertGreater(len(files), 5)
        self.assertIn(AZURE_VM_DOC, files)


if __name__ == "__main__":
    unittest.main()
