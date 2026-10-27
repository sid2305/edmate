# 0.20e handoff

Status: DONE

## Summary
Made `packages/db/test/retrieval-leak.int.test.ts` hold up under machine load, per plan:
- SLO block ("SLO (ADR-0007 point 6)"): now runs up to 6 rounds (was 3), stopping at the first
  passing round; pauses 2 s (`sleep(2_000)`) before each retry after a failed round. Bound kept at
  p95 <= 50 ms, p99 <= 100 ms, 300 calls/round, same warm-up and corpus. Comment updated to "Best
  of 6 rounds"; test timeout raised from 120 s to 240 s.
- Hung-database check (`a hung database is { hit: true } after leakTimeoutMs`): bound raised from
  1,000 ms to 3,000 ms, with a one-line comment explaining why any finite bound proves the timeout
  fired and 3 s gives room for a starved event loop.
- Prettier reformatted a few pre-existing lines in the same file (no logic change) when run with
  `--write` to satisfy the gate's prettier check.
- No other file changed; nothing under `packages/db/src` touched.

Changed: `packages/db/test/retrieval-leak.int.test.ts`, `docs/tasks/0.20e/handoff.md`.

## Proof it still catches a regression (not committed)
Temporarily wrapped the per-call timing in the SLO loop with `await sleep(60)` before each
`leakCheck` call, ran the SLO test alone, then removed the delay. Output (all 6 rounds missed):

```
leakCheck SLO round 6: p95 72.9 ms, p99 75.2 ms
AssertionError: all 6 rounds missed the SLO (p95 <= 50 ms, p99 <= 100 ms) -- round 1: p95 67.3 ms,
p99 73.4 ms; round 2: p95 67.5 ms, p99 70.4 ms; round 3: p95 72.6 ms, p99 82.0 ms; round 4: p95
73.0 ms, p99 76.3 ms; round 5: p95 73.5 ms, p99 81.9 ms; round 6: p95 72.9 ms, p99 75.2 ms:
expected false to be true
```

## Decisions
None (the plan made every call; prettier's reformat of pre-existing lines is mechanical, not a
decision).

### 26 Oct 2026 · 0.20e budget overrun · decided by lead · risk: low
- Decided: accept 32 tool calls against a plan budget of 15.
- Why: the regression proof needed extra SLO runs against the shared dev database, and each run is slow. The diff is one test file.

## Gate
- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db`
  → 8/8 tasks successful (typecheck, lint, test all pass; retrieval-leak.int.test.ts included,
  25/25 passed).
- Ran `test/retrieval-leak.int.test.ts` two further times standalone (3 total runs including the
  one above):
  - Run 2: 25 passed (25), 14.32 s
  - Run 3: 25 passed (25), 102.62 s
- `corepack pnpm exec prettier --check packages/db/test/retrieval-leak.int.test.ts` → pass (after
  `--write`).
- `python3 .githooks/secret-scan.py --all` → clean, no findings.

## Budget
Tool calls used: 32 (harness count; the builder reported 20)
