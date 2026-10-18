#!/usr/bin/env python3
"""Scan every commit of a PR with a given secret scanner (CI job `secrets`, task 0.9).

  scan-pr-commits.py --scanner <path/to/secret-scan.py> --base <ref> [--head <ref>]

For each commit in base..head (oldest first), the files that commit added or changed are written, as of
that commit, into a temp dir under their repo-relative paths, and the scanner is run on them there. The
scanner reads its allow list from beside itself (`<scanner dir>/secret-scan-allow.txt`), so CI passes main's
scanner and main's allow list; the PR's copies are never used. A secret added in one commit and deleted in
a later one therefore still fails.

Findings are reported as commit, path, line and finding type only: no secret value, not even the masked
fragment the scanner prints locally.

Exit 0 = clean, 1 = findings, 2 = error (bad ref, missing or crashing scanner). Stdlib only.
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

BATCH = 200
FLAGS = {"--all", "--staged"}  # the scanner's own modes; a lone file with that name must not trigger one
HIT = re.compile(r"^  (?P<loc>.+:\d+)  (?P<name>[A-Za-z][A-Za-z -]*): ")
FORBIDDEN = re.compile(r"^  (?P<loc>.+)  (?P<name>This kind of file must never be committed)\b")


class Error(Exception):
    pass


def git(*args):
    r = subprocess.run(["git", *args], capture_output=True)
    if r.returncode:
        raise Error(f"git {' '.join(args)} failed: {r.stderr.decode(errors='replace').strip()}")
    return r.stdout


def safe(text):
    """Make attacker-chosen text (paths) one printable line: no newlines or workflow-command tricks."""
    return "".join(c if c.isprintable() else f"\\x{ord(c) & 0xFF:02x}" for c in text)


def commits(base, head):
    for ref in (base, head):
        if subprocess.run(["git", "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"],
                          capture_output=True).returncode:
            raise Error(f"not a commit: {ref}")
    return git("rev-list", "--reverse", f"{base}..{head}").decode().split()


def changed(sha):
    """Paths added/changed/renamed/type-changed by `sha`; for a merge, against each parent."""
    out = git("diff-tree", "-r", "-m", "--root", "-z", "--no-commit-id", "--name-only",
              "--diff-filter=ACMRT", sha)
    return sorted({os.fsdecode(p) for p in out.split(b"\0") if p})


def blobs(sha):
    """{path: blob id} for every blob in the commit's tree (gitlinks and trees are left out)."""
    entries = {}
    for rec in git("ls-tree", "-r", "-z", "--full-tree", sha).split(b"\0"):
        if not rec:
            continue
        meta, path = rec.split(b"\t", 1)
        _mode, kind, oid = meta.split(b" ")
        if kind == b"blob":
            entries[os.fsdecode(path)] = oid.decode()
    return entries


def materialise(sha, paths, dest):
    tree = blobs(sha)
    written = []
    for p in paths:
        if p not in tree:
            continue  # submodule entry: nothing to scan
        target = (dest / p).resolve()
        if dest not in target.parents:
            raise Error(f"unsafe path in {sha}: {safe(p)}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(git("cat-file", "blob", tree[p]))
        written.append(p)
    return written


def run_scanner(scanner, cwd, paths):
    """Return the sanitised findings for `paths` (relative to cwd); raise Error if the scanner fails."""
    findings = []
    for i in range(0, len(paths), BATCH):
        batch = paths[i:i + BATCH]
        if len(batch) == 1 and batch[0] in FLAGS:
            batch = ["./" + batch[0]]
        r = subprocess.run([sys.executable, str(scanner), *batch], cwd=cwd, capture_output=True, text=True,
                           errors="replace")
        if r.returncode == 0:
            continue
        if r.returncode != 1:
            raise Error(f"scanner exited {r.returncode}: {r.stderr.strip()[-500:]}")
        found = []
        for line in r.stdout.splitlines():
            m = HIT.match(line) or FORBIDDEN.match(line)
            if m:
                found.append(f"{safe(m['loc'])}  {m['name']}")
            elif line.startswith("  "):
                found.append("(finding details hidden)")
        findings += found or ["(scanner reported findings; details hidden)"]
    return findings


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--scanner", required=True, type=Path)
    ap.add_argument("--base", required=True)
    ap.add_argument("--head", default="HEAD")
    args = ap.parse_args(argv)
    sys.stdout.reconfigure(errors="backslashreplace")
    scanner = args.scanner.resolve()
    try:
        if not scanner.is_file():
            raise Error(f"scanner not found: {scanner}")
        shas = commits(args.base, args.head)
        failed, files = 0, 0
        with tempfile.TemporaryDirectory(prefix="scan-pr-commits-") as tmp:
            for n, sha in enumerate(shas):
                dest = Path(tmp).resolve() / str(n)
                dest.mkdir()
                paths = materialise(sha, changed(sha), dest)
                files += len(paths)
                findings = run_scanner(scanner, dest, paths) if paths else []
                if findings:
                    failed += 1
                    print(f"commit {sha}:")
                    print("\n".join(f"  {f}" for f in findings))
    except Error as e:
        print(f"scan-pr-commits: {e}", file=sys.stderr)
        return 2
    print(f"Scanned {len(shas)} commit(s), {files} file version(s), with the given scanner.")
    if failed:
        print(f"{failed} commit(s) add secrets or forbidden files. Deleting them in a later commit is not "
              "enough: rewrite the branch history (and rotate any real credential).")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
