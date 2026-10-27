# Handoff: 1.4g

Status: DONE

## Summary
- `apps/web/src/auth/index.test.ts`: in the test `'linkBindingCookie: an HMAC of the address under AUTH_SECRET, not secure on http'`, pinned `Date.now()` with `vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)` before the first `linkBindingCookie` call, restored with `now.mockRestore()` in a `finally` block. No `vi.useFakeTimers()` used, per the plan. Did not use the file's existing `afterEach`/`restoreAllMocks` since none exists in this file.
  - Searched the whole file for any other test comparing two separately stamped link/confirm cookie values: none found. The other two places that call `linkBindingCookie` (line ~537 cookie setup, line ~579 one-off call compared against a request header, not against a second freshly-stamped value) only call it once per comparison, so they are not affected by the clock-boundary flake.
  - `corepack pnpm exec prettier --write` reformatted this same file to pass `--check` (pre-existing formatting drift unrelated to this change, mostly long lines wrapping); no assertions or behaviour changed, confirmed via `git diff`.
- Red/green evidence: the flake depends on a real second boundary, so it cannot be forced red on demand (per the plan). After the fix, ran `corepack pnpm --filter @edmate/web exec vitest run src/auth/index.test.ts -t "linkBindingCookie"` 50 times in a shell loop: 0/50 failures (all green, 1 passed / 26 skipped each run).

## Decisions
### 27 Oct 2026 · 1.4g auth test clock pin approval · decided by lead · risk: high
- Decided: merge 1.4g, a test-only change in apps/web/src/auth/index.test.ts (security risk group): the linkBindingCookie test pins Date.now so its two calls stamp the same second, plus a prettier reformat of the file so the gate's prettier check passes. No source file under apps/web/src/auth changed.
- Why: the test failed PR #398's CI (a branch with no web changes) when a second boundary fell between the two calls; security-reviewer approved with no findings and confirmed every assertion is kept and the spy is restored in a finally block.
- Alternatives: fake timers (rejected in the plan: the test awaits a dynamic import); pass an explicit now through the index.ts wrapper (a source change for a test problem).
- Reversible: yes, revert the test change.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → 10/10 tasks successful.
- `corepack pnpm exec prettier --check apps/web/src/auth/index.test.ts` → pass (after `--write`).
- `python3 .githooks/secret-scan.py --all` → clean, no output.
- 50x loop of the targeted test → 0 failures.

## Budget
Tool calls used: 24 (harness count; the builder reported 17)
