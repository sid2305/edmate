# 8.7o plan (lead-written)

Status: READY

## Goal
`EMAIL` in `packages/db/src/repositories/redact-json.ts` (line 55) runs in quadratic time on
adversarial input such as `'a1_'.repeat(N)` (about 8 s at 120k characters). Make it linear
without letting any email address through.

## Cause
The local part `[\p{L}\p{N}._%+-]+` can start at every position of a long run of local-part
characters. When no match follows, the engine scans the rest of the run from each start: O(n²).

## Steps (test first, in `packages/db/test/redact-json.test.ts`)
1. Timing tests, red before the fix: `redactPersonalData` on `'a1_'.repeat(200_000)` (600k
   characters), on the same with one `@` at the end, and on `'a.'.repeat(300_000) + '@'` each
   finish in under 100 ms (measure with `performance.now()`; use a loose bound in CI of 100 ms per
   the accept line, and note the measured time in the handoff).
2. Fix, suggested approach (the builder may pick another linear one and must explain it): add a
   lookbehind so a local part can only start where the previous character is not a local-part
   character: `/(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@.../gu`. This changes no output: every
   character between a run's start and any later start inside the same run is itself a local-part
   character, so if a match exists from inside the run, the leftmost match from the run's start
   has the same end, and `String.replace` already takes the leftmost match. Write this reasoning
   as a short comment on the regex. Check the domain part is not also super-linear on input like
   `'x@' + 'a.'.repeat(300_000)` and `'x@' + 'a-'.repeat(300_000)`; add those inputs to step 1.
3. Differential test: keep the old regex as a test-only constant and check old and new give the
   same `String.replace(..., '[redacted]')` output on (a) every existing email test string,
   (b) at least 2,000 random strings from a small alphabet that includes letters, digits,
   `._%+-@` and spaces (seeded generator, not `Math.random`, so a failure is reproducible),
   lengths up to 60.
4. No other regex changes in this task (8.7p covers PHONE_CANDIDATE). Keep `redact-json.ts` at
   100% coverage.

## Risky paths
`packages/db/src/repositories/**` (reviewers: security-reviewer). Plus code-reviewer and
typescript-reviewer.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`
- `corepack pnpm exec prettier --check packages/db/src/repositories/redact-json.ts packages/db/test/redact-json.test.ts`
- `python3 .githooks/secret-scan.py --all` (fake addresses only, e.g. example.com / example.org)

## Budget
About 30 tool calls.
