# 9.6h review — APPROVE

Reviewers: security-reviewer (opus; also as typescript-reviewer and code-reviewer), lead

The security reviewer re-ran the db gate (26/26 tasks, 1206 tests, subscriptions.ts at 100% coverage) on a scratch clone against a disposable Postgres and removed each fix in turn: every one of the three 9.6c MEDIUMs (the cost-alarm pause can't be undone by cancel then start; resume trusts only this student's own pause row; changePackage requires a verified teacher) and the trial and tie LOWs has a test that fails without it. The start-refusal design honours a staff unpause of an existing subscription and only closes the up-to-one-day window before the next alarm run; the block can outlive the alarm only if staff change the threshold mid-month, which the handoff logs. The shared test-file edit is additive. Two new MEDIUMs sit next to this change, not in it, and are deferred to 9.6i: changePackage from paid to free skips the alarm check (moot until M10, because a paid start needs no payment yet), and the web start route words the new refusal as "you already have a package".

## Findings
- [MEDIUM] [deferred 9.6i] packages/db/src/repositories/subscriptions.ts:422 — changePackage does not apply the alarm-paused-free check, so paid start then change to free gets active free access until the next alarm run.
- [MEDIUM] [deferred 9.6i] apps/web/src/subscriptions/start.ts:48 — every `invalid` from start becomes 409 "You already have a package with this teacher", including the new alarm refusal; no route test covers it.
- [LOW] [deferred 9.6i] packages/db/src/repositories/subscriptions.ts:268 — the refusal re-read skips the verified and live joins, so a rejected teacher's or a non-live free version is `invalid` instead of `not_found` during an alarm (not reachable through the web route).
- [LOW] [deferred 9.6i] packages/db/src/repositories/subscriptions.ts:72 — the alarm marker exists only if the alarm paused at least one subscription, and a start whose snapshot predates the alarm's commit can slip in; both close at the next run.
- [LOW] [deferred 9.6i] packages/db/test/repositories.int.test.ts:4312 — no test isolates the actorRole half of the resume fix (a forged row with this student as actor but role staff or system).
- [LOW] [deferred 9.6i] packages/db/test/repositories.int.test.ts:4300 — the verified-teacher test sets the teacher rejected without a finally, so one failure cascades into the later 9.6h tests.
- [LOW] [deferred 9.6i] packages/db/src/repositories/subscriptions.ts — resume's created_at tie-break adds no order (both default to transaction time); harmless and fails closed; note for 10.3's paused_by work.
