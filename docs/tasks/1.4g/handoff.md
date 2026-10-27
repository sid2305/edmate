# Handoff: 1.4g

Status: DONE

## Summary
- `apps/web/src/auth/index.test.ts`: in the test `'linkBindingCookie: an HMAC of the address under AUTH_SECRET, not secure on http'`, pinned `Date.now()` with `vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)` before the first `linkBindingCookie` call, restored with `now.mockRestore()` in a `finally` block. No `vi.useFakeTimers()` used, per the plan. Did not use the file's existing `afterEach`/`restoreAllMocks` since none exists in this file.
  - Searched the whole file for any other test comparing two separately stamped link/confirm cookie values: none found. The other two places that call `linkBindingCookie` (line ~537 cookie setup, line ~579 one-off call compared against a request header, not against a second freshly-stamped value) only call it once per comparison, so they are not affected by the clock-boundary flake.
  - `corepack pnpm exec prettier --write` reformatted this same file to pass `--check` (pre-existing formatting drift unrelated to this change, mostly long lines wrapping); no assertions or behaviour changed, confirmed via `git diff`.
- Red/green evidence: the flake depends on a real second boundary, so it cannot be forced red on demand (per the plan). After the fix, ran `corepack pnpm --filter @edmate/web exec vitest run src/auth/index.test.ts -t "linkBindingCookie"` 50 times in a shell loop: 0/50 failures (all green, 1 passed / 26 skipped each run).

## Decisions
None.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → 10/10 tasks successful.
- `corepack pnpm exec prettier --check apps/web/src/auth/index.test.ts` → pass (after `--write`).
- `python3 .githooks/secret-scan.py --all` → clean, no output.
- 50x loop of the targeted test → 0 failures.

## Budget
Tool calls used: 13
