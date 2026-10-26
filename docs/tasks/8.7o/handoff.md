# 8.7o handoff

Status: DONE

## Summary

`EMAIL` in `packages/db/src/repositories/redact-json.ts` ran in quadratic time on adversarial
input (a long run of local-part characters with no following `@...domain`), because the local
part's `[\p{L}\p{N}._%+-]+` let the engine retry a match attempt from every position in the run.

Fix: added a leading negative lookbehind, `(?<![\p{L}\p{N}._%+-])`, so a match attempt can only
start where the previous character is not itself a local-part character. This does not change any
match: every character between a run's start and a later position inside the same run is itself a
local-part character, so if a match exists starting inside the run, the leftmost match starting
from the run's start ends at the same place; `String.replace` already takes the leftmost-starting
match, so dropping the inner start points changes no output, only how many start points the engine
tries. Full reasoning is written as a comment on the (now exported, test-only) `EMAIL` constant.

Checked the domain part (`[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}`) separately: timing
tests on `'x@' + 'a.'.repeat(300_000)` and `'x@' + 'a-'.repeat(300_000)` confirm it is not
super-linear and needed no change.

Changed files:
- `packages/db/src/repositories/redact-json.ts` — `EMAIL` regex gets the lookbehind and is now
  exported (test-only; not re-exported from `src/repositories/index.ts` or `src/index.ts`, so the
  package's public API is unchanged) with a comment explaining why the fix preserves output and
  why the domain part needed no change.
- `packages/db/test/redact-json.test.ts` — new `describe('EMAIL linear time (8.7o)', ...)` block:
  - Timing tests (6 cases: local-part run with/without trailing `@`, dotted local-part run
    with/without trailing `@`, dotted domain, dashed domain), each asserting under 100ms and that
    the output equals the input (none of these inputs contains a full, redactable email, so a
    timing pass must not mask a correctness regression).
  - A differential test against a test-only `OLD_EMAIL` constant (the pre-fix regex) on every
    existing email string from the test file's other cases.
  - A differential property test, 2,000 seeded (mulberry32) random strings (alphabet
    `abcABC012._%+-@ `, length up to 60), comparing old vs new regex output.

## Measured times (local run, informational; CI bound is the loose 100ms in the test)
All 6 timing cases finished in low single-digit milliseconds after the fix (pre-fix, the local-part
run cases alone took seconds to minutes depending on length; not measured exactly since the
pre-fix code was reverted before the final run — the original plan's cited ~8s at 120k characters
for a 200k/300k-character run would be far worse, consistent with O(n^2)).

## Decisions

### 25 Oct 2026 · 8.7o EMAIL export is test-only · decided by builder · risk: low
- Decided: export `EMAIL` from `redact-json.ts` itself (not from `src/repositories/index.ts` or
  `src/index.ts`) so the differential test can import it directly from the module path, instead of
  adding it to the package's public API.
- Why: the plan needed a way for the test to compare old-vs-new regex output on exactly the EMAIL
  pattern (not the full `redactString` pipeline, which also runs PHONE_CANDIDATE/UUID/etc. and
  would make a differential comparison meaningless). A module-local export reached by its file
  path keeps the package's public surface (`src/index.ts`) unchanged.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` — PASS (80 test files,
  1710 passed, 4 skipped; `redact-json.ts` coverage 100/100/100/100).
- `corepack pnpm exec prettier --check packages/db/src/repositories/redact-json.ts packages/db/test/redact-json.test.ts` — PASS.
- `python3 .githooks/secret-scan.py --all` — PASS (no output, clean).

## Budget
Tool calls used: 19
