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
# Azure hostname-shaped string, e.g. a DCE's logs-ingestion endpoint
# (<name>.<region>-1.ingest.monitor.azure.com) or a bare *.azure.com URL.
AZURE_FQDN_RE = re.compile(r"\b[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.azure\.com\b", re.IGNORECASE)

# 169.254.169.254 is Azure's fixed link-local IMDS address, the same on every subscription --
# a documented platform constant, not a resource identifier (infra/azure/lib/monitor-ingest.sh).
ALLOWED_IPV4 = {"169.254.169.254"}

# monitor.azure.com is the fixed AAD token audience/resource URI for the Azure Monitor Logs
# Ingestion API, the same on every subscription -- a documented platform constant, not a
# resource identifier (infra/azure/lib/monitor-ingest.sh IMDS_TOKEN_URL). "2fmonitor.azure.com"
# is the same constant as it appears percent-encoded in that URL (...%2Fmonitor.azure.com%2F) --
# the trailing "2f" of the preceding %2F has no delimiter before "monitor" in the raw text, so
# the hostname regex's match includes it.
ALLOWED_AZURE_FQDN = {"monitor.azure.com", "2fmonitor.azure.com"}


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

    def test_no_azure_fqdn_hostname(self):
        hits = [
            f"{path.relative_to(ROOT)}:{n}: {m.group(0)}"
            for path in scanned_files()
            for n, line in enumerate(path.read_text().splitlines(), 1)
            for m in AZURE_FQDN_RE.finditer(line)
            if m.group(0).lower() not in ALLOWED_AZURE_FQDN
        ]
        self.assertEqual(hits, [], f"Azure hostname-shaped string found: {hits}")

    def test_azure_fqdn_pattern_catches_real_examples(self):
        # Regression guard for the regex itself (not the repo): these shapes must be caught
        # if they ever appear outside the documented placeholder/constant allowlist.
        caught = [
            "https://edmate-prod-dce-xk29.eastus-1.ingest.monitor.azure.com",
            "https://some-resource.monitor.azure.com/ingest",
        ]
        for example in caught:
            self.assertTrue(
                AZURE_FQDN_RE.search(example),
                f"expected AZURE_FQDN_RE to catch {example!r}",
            )

        # The doc's own placeholder (angle-bracket tokens, not a real hostname) must not trip it.
        placeholder = "https://<name>.<region>-1.ingest.monitor.azure.com"
        match = AZURE_FQDN_RE.search(placeholder)
        self.assertIsNotNone(match)
        self.assertNotIn(match.group(0).lower(), ALLOWED_AZURE_FQDN)
        # It matches the hostname shape (so a real value would be caught), but since the
        # placeholder itself is never committed to a scanned file, scanned_files() never sees it.

    def test_scan_path_itself_is_not_silently_empty(self):
        # A regression guard for the scan helper, not the repo: if infra/azure/ or
        # docs/azure-vm.md ever moved, scanned_files() must raise, not return [].
        files = scanned_files()
        self.assertGreater(len(files), 5)
        self.assertIn(AZURE_VM_DOC, files)


if __name__ == "__main__":
    unittest.main()
