#!/usr/bin/env python3
"""Edmate secret scan: stop credentials and personal data before they reach git (the repo is public).

  secret-scan.py --staged        scan what is about to be committed (git pre-commit hook)
  secret-scan.py --all           scan every tracked file (CI, audits)
  secret-scan.py <file>...       scan files (Claude Code edit hook)

Exit 0 = clean, 1 = findings. A line can opt out with the marker `secret-scan: allow` plus a reason,
e.g. a fake key in a test fixture. Paths matching .githooks/secret-scan-allow.txt are skipped.
"""
import fnmatch
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PATTERNS = [
    ("Anthropic API key", r"sk-ant-[A-Za-z0-9_-]{20,}"),
    ("OpenRouter API key", r"sk-or-v1-[A-Fa-f0-9]{32,}"),
    ("OpenAI API key", r"sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}"),
    ("Google API key", r"AIza[0-9A-Za-z_-]{35}"),
    ("GitHub token", r"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})"),
    ("AWS access key", r"(?:AKIA|ASIA)[0-9A-Z]{16}"),
    ("Slack token", r"xox[baprs]-[A-Za-z0-9-]{10,}"),
    ("Stripe live key", r"(?:sk|rk)_live_[A-Za-z0-9]{20,}"),
    ("Private key block", r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    ("JSON web token", r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    ("Database URL with password", r"(?:postgres(?:ql)?|redis|mysql|mongodb(?:\+srv)?)://[^\s:/@]+:(?!password@|postgres@|changeme@|\$\{)[^\s@/]{3,}@(?!localhost|127\.0\.0\.1|postgres[:/]|redis[:/]|db[:/])"),
    ("Hard-coded secret", r"(?i)\b(?:api[_-]?key|secret|token|passw(?:or)?d|master[_-]?key)\b\s*[:=]\s*['\"][A-Za-z0-9+/_\-]{16,}['\"]"),
    # .env-style line with a real-looking value and no quotes (templates such as *.example are exempt
    # from the forbidden-name rule, so a key typed into one must still be caught; 22 Oct 2026)
    ("Unquoted secret assignment", r"(?im)^\s*(?:export\s+)?[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|AUTH_TOKEN)\s*=\s*[A-Za-z0-9+/=_\-]{24,}\s*$"),
    ("Personal email", r"\b[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com\b|example\.(?:com|org|in)\b|edmate\.(?:org|in|dev)\b)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|in|org|net|io|co|edu|gov)\b"),
    ("Personal home path", r"(?:/Users|/home)/(?!runner\b|user\b|you\b|<)[a-z][a-z0-9._-]{2,}/"),
]
COMPILED = [(name, re.compile(rx)) for name, rx in PATTERNS]

# Files that must never be committed, whatever they contain.
FORBIDDEN_NAMES = [
    ".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "id_rsa*", "id_ed25519*",
    "credentials.json", "service-account*.json", "*.keystore", ".npmrc", ".netrc", "*.sqlite", "*.db",
]
FORBIDDEN_OK = ["env.example", ".env.example", "*.example"]
SKIP_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2", ".lock")


def allowlist():
    f = ROOT / ".githooks/secret-scan-allow.txt"
    if not f.exists():
        return []
    return [l.strip() for l in f.read_text().splitlines() if l.strip() and not l.startswith("#")]


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout


def scan_text(path, text):
    hits = []
    for n, line in enumerate(text.splitlines(), 1):
        if "secret-scan: allow" in line:
            continue
        for name, rx in COMPILED:
            m = rx.search(line)
            if m:
                shown = m.group(0)
                shown = shown[:6] + "…" + shown[-2:] if len(shown) > 12 and name != "Personal home path" else shown
                hits.append(f"{path}:{n}  {name}: {shown}")
                break  # one finding per line is enough to stop the commit
    return hits


def forbidden(path):
    base = Path(path).name
    if any(fnmatch.fnmatch(base, ok) for ok in FORBIDDEN_OK):
        return False
    return any(fnmatch.fnmatch(base, pat) for pat in FORBIDDEN_NAMES)


def main(argv):
    allow = allowlist()
    if argv == ["--staged"]:
        paths = [p for p in git("diff", "--cached", "--name-only", "--diff-filter=ACMR").splitlines() if p]
        read = lambda p: git("show", f":{p}")
    elif argv == ["--all"]:
        paths = [p for p in git("ls-files").splitlines() if p]
        read = lambda p: (ROOT / p).read_text(errors="ignore")
    elif argv:
        paths = argv
        read = lambda p: Path(p).read_text(errors="ignore")
    else:
        print(__doc__)
        return 1

    hits = []
    for p in paths:
        rel = str(Path(p).resolve().relative_to(ROOT)) if Path(p).is_absolute() and str(Path(p).resolve()).startswith(str(ROOT)) else p
        rel = re.sub(r"^\.claude/worktrees/[^/]+/", "", rel)
        if any(fnmatch.fnmatch(rel, g) for g in allow):
            continue
        if forbidden(rel):
            hits.append(f"{rel}  This kind of file must never be committed (secrets / local data)")
            continue
        if rel.endswith(SKIP_SUFFIXES):
            continue
        try:
            hits += scan_text(rel, read(p))
        except (OSError, UnicodeDecodeError):
            continue

    if hits:
        print("Secret scan: possible credentials or personal data found. Nothing was committed.\n")
        print("\n".join(f"  {h}" for h in hits))
        print("\nRemove it (use environment variables or the key vault), or, only for fake test data,")
        print("add `secret-scan: allow <reason>` on that line.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
