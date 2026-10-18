#!/usr/bin/env python3
"""Check that every ADR (docs/adr/NNNN-*.md, not the template) has the template's headings, in order.

Usage: python3 docs/adr/check-headings.py [adr-dir]
Exit 0 and print nothing when all ADRs pass; exit 1 and list each file's problems otherwise.
"""
import re
import sys
from pathlib import Path

HEADINGS = ["Status", "Date", "Context", "Decision", "Alternatives", "Consequences", "Reviewers"]
ADR_NAME = re.compile(r"^\d{4}-.+\.md$")
TEMPLATE = "0000-template.md"


def problems(text):
    found = [line[3:].strip() for line in text.splitlines() if line.startswith("## ")]
    found = [h for h in found if h in HEADINGS]
    out = [f"missing: {h}" for h in HEADINGS if h not in found]
    present = [h for h in HEADINGS if h in found]
    firsts = list(dict.fromkeys(found))
    if firsts != present:
        out.append(f"out of order: found {', '.join(firsts)}; expected {', '.join(present)}")
    return out


def main(argv):
    adr_dir = Path(argv[1]) if len(argv) > 1 else Path(__file__).resolve().parent
    if not adr_dir.is_dir():
        print(f"check-headings: {adr_dir} is not a directory")
        return 1
    failed = False
    for path in sorted(adr_dir.iterdir()):
        if path.name == TEMPLATE or not ADR_NAME.match(path.name):
            continue
        for p in problems(path.read_text(encoding="utf-8")):
            print(f"{path.name}: {p}")
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
