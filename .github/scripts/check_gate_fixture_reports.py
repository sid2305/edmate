#!/usr/bin/env python3
"""Decide whether the `gate-fixtures` CI job's two `edmate gate demo` reports prove what they
must (task 7.5 Phase B): "a deliberately leaky prompt pack fails CI", not something eyeballed
from JSON.

  check_gate_fixture_reports.py --good <file> --leaky <file> --leaky-exit-code <n>
                                 --leak-case-id <id>

Reads the two `GateResult` JSON reports `edmate gate demo --report <file>` wrote (fields `pass`:
bool and `failedCaseIds`: string[]). Exits 0 only when all of:
  1. the good report's `pass` is true;
  2. the leaky command's own exit code (captured by the caller, not re-derived) is non-zero;
  3. the leaky report's `pass` is false (so a silent "exit 0 but pass:false" bug, or its mirror,
     can never slip through on exit code alone);
  4. the leaky report's `failedCaseIds` is exactly `[leak-case-id]` -- not a different case, not
     more than one, so a wider breakage can't hide behind "the leaky gate failed".
Else: prints a clear message to stderr naming which condition failed, and exits 1. Stdlib only,
no network.
"""
import argparse
import json
import sys


def load_report(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def check(good, leaky, leaky_exit_code, leak_case_id):
    """Returns a list of failure messages; empty means every condition held."""
    errors = []
    if good.get("pass") is not True:
        errors.append(
            f"good report did not pass (pass={good.get('pass')!r}, "
            f"failedCaseIds={good.get('failedCaseIds')!r})"
        )
    if leaky_exit_code == 0:
        errors.append("leaky gate's exit code was 0; expected a non-zero (failing) exit code")
    if leaky.get("pass") is not False:
        if leaky.get("pass") is True:
            errors.append("leaky report unexpectedly passed (pass=true)")
        else:
            errors.append(f"leaky report's pass field was not a boolean false: {leaky.get('pass')!r}")
    failed_ids = leaky.get("failedCaseIds")
    if failed_ids != [leak_case_id]:
        errors.append(
            f"leaky report's failedCaseIds was {failed_ids!r}, expected exactly [{leak_case_id!r}]"
        )
    return errors


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--good", required=True, help="good GateResult report JSON path")
    parser.add_argument("--leaky", required=True, help="leaky GateResult report JSON path")
    parser.add_argument("--leaky-exit-code", required=True, type=int, help="the leaky gate command's own captured exit code")
    parser.add_argument("--leak-case-id", required=True, help="the one case id the leaky gate must fail on")
    args = parser.parse_args(argv)

    good = load_report(args.good)
    leaky = load_report(args.leaky)
    errors = check(good, leaky, args.leaky_exit_code, args.leak_case_id)
    if errors:
        print("check_gate_fixture_reports: FAIL", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print("check_gate_fixture_reports: OK (good passes, leaky fails on exactly the leak case)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
