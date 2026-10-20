#!/usr/bin/env python3
"""Decide whether a set of changed paths is docs-only (CI job `node`'s skip condition, task 0.13).

  docs_only.py [--event-name NAME] [paths-file]

Reads changed paths one per line from `paths-file` (or stdin if omitted; empty lines ignored) and prints
"true" if every path is a doc (under `docs/`, a top-level `*.md` file, or a `.md` file under `.github/`)
and the list is non-empty, else "false". `--event-name schedule` always prints "false": the nightly run has
no diff to check and must run the full suite regardless of what last changed. An empty path list (no diff
could be computed, or a non-schedule event with zero changed files) also prints "false": skip only when
we're sure.

Exit code mirrors the printed value (0 = "true", 1 = "false") so a caller can use either the exit code or
the stdout line. Stdlib only, no network.
"""
import argparse
import re
import sys

DOC = re.compile(r"^(docs/.*|[^/]+\.md|\.github/.*\.md)$")


def is_docs_only(paths, event_name):
    if event_name == "schedule":
        return False
    paths = [p for p in paths if p]
    if not paths:
        return False
    return all(DOC.match(p) for p in paths)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths_file", nargs="?", help="file of changed paths, one per line; default stdin")
    parser.add_argument("--event-name", default="", help="github.event_name, e.g. 'schedule'")
    args = parser.parse_args(argv)

    if args.paths_file:
        with open(args.paths_file, encoding="utf-8") as f:
            paths = f.read().splitlines()
    else:
        paths = sys.stdin.read().splitlines()

    result = is_docs_only(paths, args.event_name)
    print("true" if result else "false")
    return 0 if result else 1


if __name__ == "__main__":
    sys.exit(main())
