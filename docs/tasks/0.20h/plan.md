# Plan: 0.20h — local e2e failures and the global-setup warm-up hardening

Status: READY (lead plan, 27 Oct 2026)

Background: docs/tasks/0.20g/handoff.md (Summary, "Unrelated finding"). In 10 fresh local runs of `corepack pnpm --filter @edmate/web e2e`, `full-flow.spec.ts` "discover: search, open the teacher page, choose a package" timed out (30 s, inside its own `navigateUntil`/`toPass` wrapper) 10 of 10 times, and `teacher-packages-walkthrough.spec.ts` "create the first/second package from preset" failed 6 of 10. Both pass in CI, which starts from an empty database.

Files: `apps/web/e2e/**` and `docs/tasks/0.20h/handoff.md`. No risky paths.

## Part 1 — find the cause (write it down first)
1. Build once (`corepack pnpm --filter @edmate/web build`), then run each failing spec alone (`corepack pnpm --filter @edmate/web e2e <spec>`) and read the Playwright error, trace and screenshot under `apps/web/test-results/`.
2. Decide which it is: (a) rows left in the local dev database by earlier runs (for example many teachers or packages with the same name, so the search result or the preset step finds the wrong row or a duplicate), or (b) a real app bug that CI's empty database hides.
3. Write the cause, with the evidence (error text, the selector or row involved), in the handoff before changing anything.

## Part 2 — fix
- (a) Local data: make the specs independent of leftover rows, for example by giving the rows each run creates a unique suffix and selecting by it, or by scoping assertions to this run's own rows. **Never delete or reset the dev database or any rows the run did not create**, and never run docker, docker compose or psql. Keep `localDatabaseGuard.ts` as it is.
- (b) App bug: do not fix it in this task. Write the cause and the smallest fix you'd suggest in the handoff, set `Status: BLOCKED (app bug: <one line>)`, and still do Part 3.

## Part 3 — global-setup.ts hardening (0.20g review MEDIUM/LOW)
Give each warm-up `fetch` in `apps/web/e2e/global-setup.ts` an `AbortSignal.timeout(...)` (use a named constant, about 60 s, under the webServer timeout), and run the warm-ups with `Promise.all` (each still best-effort: a failure or timeout is caught and ignored, as today). Keep the existing comment's reasoning.

## Proof
Both specs pass in 5 fresh local runs in a row (separate `e2e` invocations, not `--repeat-each`), and the whole e2e suite passes once. Record the run results in the handoff.

## Gate
`corepack pnpm turbo run typecheck lint --filter=@edmate/web`; the e2e runs above; prettier --check on the changed files; `python3 .githooks/secret-scan.py --all`.

Budget: 60 tool calls.
