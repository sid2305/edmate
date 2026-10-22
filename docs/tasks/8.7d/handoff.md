# 8.7d handoff: studio publish API and /teacher/publish page (8.7 Phase D)

Status: DONE

- Branch: `m8/8.7d-publish-page` (built locally as `work-87d`)
- Worktree: `.claude/worktrees/agent-a64a34abaf6988d28`
- Plan: `docs/tasks/8.7/plan.md` (Phase D)
- Tool calls used: 84 (harness count; the builder reported 62)

## Summary

A teacher can now publish from the studio and see the gate results.

- `POST /api/studio/publish` (body: a strict `{}`) checks the teacher is verified, takes the agent from the teacher's packages, and pins the newest style card, the default course, the newest signed prompt-pack set, `MODEL_MIX.paid` and the release judge. It then calls `publish.startRun` and, after that commits, puts the run on the gate queue. It answers 202 `{ runId }`.
- If the queue refuses the job, the run is finished `error` with the code `enqueue_failed` and the answer is 503, so the run never sits `queued` until the stale rule closes it.
- `GET /api/studio/publish` returns `{ run: null }` or the latest run: `{ runId, status, changes, groups, errorCode, failedCases[], scorecard, startedAt, finishedAt, publishedAt }`. Failed cases are read only for a `failed` run, and only through the teacher-scoped `publish.failedCases`.
- `/teacher/publish` shows five states: idle, running, passed, failed and error.
  - Running: the page polls, with one request in flight at a time.
  - Passed: the published time and the scorecard.
  - Failed: the groups that did not pass, with the empty-group (B-40) reason shown as is, then the failed cases grouped by gate group (case id, why, and the teacher's own question for their own cases).
  - Error: a plain message per code.
- Every reply goes through a zod `safeParse` in `publishClient.ts`. The Publish action is try/catch/finally with a busy flag. A start error is cleared when the next start begins.
- Error copy is fixed English per reason or code. The page never shows server text, an error code or an id (the case id in the failed-cases list is the gate's case name, as the plan asks).
- The main teacher nav has a "Publish" link.

Responses and reasons:

| Case | Status | `error.code` | `reason` |
| --- | --- | --- | --- |
| Started | 202 | | |
| Body not `{}` | 400 | `validation` | |
| Body over the cap | 413 | `input_too_large` | |
| Teacher not verified (pre-check or the `startRun` re-check) | 403 | `forbidden` | `not_verified` |
| No packages | 409 | `validation` | `no_packages` |
| No style card | 409 | `validation` | `style_card_required` |
| `startRun` refused (`PublishRefusedError`) | 409 | `validation` | `gate_running`, `nothing_to_publish`, `no_packages` or `suspended` |
| Other `invalid` or `integrity` | 409 | `validation` | `conflict` |
| `not_found` | 404 | `not_found` | |
| Repo `failed`, backend not built, enqueue failed | 503 | `provider_error` | `unavailable` |
| Unknown error | 500 | `provider_error` | `internal` |

Every response is `no-store`. Logs carry fixed codes and error names only (`studio.publish_failed`, `studio.publish_unavailable`, `studio.publish_runtime_unavailable`, `studio.publish_enqueue_failed`, `studio.publish_finish_failed`).

## Files

- `apps/web/src/studio/publish.ts` (new): `createPublishHandlers`, `PublishBackend`, `PublishRunView`, `ENQUEUE_FAILED`.
- `apps/web/src/studio/publishRuntime.ts` (new): `createPublishRuntime`, `judgeModelPin`, `publishHandlers` (process wiring: the shared database, the gate queue on `REDIS_URL`).
- `apps/web/src/studio/publishClient.ts` (new): `loadLatestRun`, `startPublish`, with zod schemas.
- `apps/web/app/api/studio/publish/route.ts` (new): `GET` and `POST` behind `withRole(['teacher'])`.
- `apps/web/app/teacher/publish/page.tsx` and `PublishView.tsx` (new).
- `apps/web/app/teacher/view.tsx`: one nav link.
- `apps/web/messages/en.json`: a new top-level `publish` key only.
- Tests (new): `src/studio/publish.test.ts` (25), `src/studio/publishRuntime.test.ts` (14), `app/teacher/publish/PublishView.test.tsx` (30, RTL and jest-axe), `app/teacher/publish/page.test.tsx` (2). `app/teacher/view.test.tsx` gains one nav test.
- Not touched: `apps/web/src/auth/**`, `src/studio/packages*.ts` (the 8.6c pins are reused by calling `createPackagesRuntime`, read-only), contracts, evals, worker, db.

## Tests

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/web...
→ Tasks: 34 successful, 34 total
→ web Test Files 100 (99 passed, 1 skipped); All files 97.77 | 96.3 | 94.73 | 98.55
→ publish.ts 100 lines / 94.1 branches; publishClient.ts 100 lines / 90 branches; publishRuntime.ts covered except the v8-ignored process wiring
python3 .githooks/secret-scan.py --all → clean
```

Covered by the tests:
- **Acceptance "failures show which cases failed":** `PublishView.test.tsx` "failed" lists each failed case under its gate group with the why and the teacher's own question. `publish.test.ts` checks that GET reads failed cases teacher-scoped and only for a failed run.
- **Teacher id from the session only:** any body key is a 400 and nothing is called; every repo call gets the session scope.
- **Order:** enqueue happens after `startRun`, checked against the real runtime with fake repos and a fake queue. An enqueue failure ends the run `error`.

## Walkthrough (a pass publishes in under 1 minute)

B-40 is still open, so I used a scripted gate, not a real model. I did not bring up the full dev stack:
- the running `edmate-*` containers belong to other sessions and were left alone;
- a browser walkthrough would need a scripted-gate worker build of the image.

What I ran:
- I started my own throwaway `pgvector/pgvector:0.8.1-pg16` and `redis:7.4.6-alpine` containers (127.0.0.1:55497 and 56397, stopped afterwards).
- On them I ran the Phase C end-to-end suite, `apps/worker/test/gate/processor.int.test.ts`: real Postgres, Redis, BullMQ and the gate worker, with a scripted gate.
- I added a temporary line, not committed, to print the passed run's stored timestamps:

```
{"createdAt":"2026-10-22T12:18:13.368Z","finishedAt":"2026-10-22T12:18:13.419Z",
 "publishedAt":"2026-10-22T12:18:13.419Z","finishToPublishMs":0,"queuedToPublishMs":51}
Tests 3 passed (3)
```

`finished_at` to `published_at` is 0 ms: `goLive` sets both in one transaction. Queued to published took 51 ms with a scripted gate.

## Decisions

### 22 Oct 2026 · 8.7d the web pins the judge from EDMATE_JUDGE_MODEL without importing @edmate/evals · decided by builder · risk: low
- Decided: `publishRuntime.ts` reads `EDMATE_JUDGE_MODEL` itself, parsed the same way as `resolveJudgeModel`, and stores `<provider>:<model>` as the run's judge. The worker accepts that form. If the variable is missing or malformed, POST answers 503 and the reason `judge_model` is logged.
- Why: the worker refuses a run pinned to a different judge, so the web must pin the same one. Adding `@edmate/evals` to the web bundle for five lines of parsing is not worth it.
- risk: low

### 22 Oct 2026 · 8.7d a failed enqueue ends the run error (enqueue_failed) · decided by builder · risk: low
- Decided: if the gate job can't be queued after `startRun`, the handler calls `finishRun(error, { groups: [], errorCode: 'enqueue_failed' })` and answers 503. If that `finishRun` also fails, the failure is logged and the run waits for the stale rule.
- Why: no silent failures. Without this, a Redis blip would block the next publish (`gate_running`) for up to 2 h 15 min.
- risk: low

### 22 Oct 2026 · 8.7d publish reasons ride a top-level `reason`, as in 8.6c · decided by builder · risk: low
- Decided: `error.code` stays a contract `ErrorCode` (`forbidden`, `validation`, `not_found`, `provider_error`, `input_too_large`). The publish case is a top-level `reason` (see the table above), and the page keys its copy on it.
- Why: there is no new `ErrorCode` without an ADR, and this is the same pattern as 8.6c.
- risk: low

### 22 Oct 2026 · 8.7d the publish pins reuse the packages runtime · decided by builder · risk: low
- Decided: the newest signed prompt-pack set and `MODEL_MIX.paid` come from calling 8.6c's `createPackagesRuntime`, read-only, not from a copy. The style card is the newest one, the course comes from `courses.ensureDefault`, and the agent is the one on the teacher's packages. No packages means 409 `no_packages`; no style card means 409 `style_card_required`, both before `startRun`.
- Why: one place pins the agent, and 8.6c's files stay untouched. Side effect: a mix that can't be priced also blocks publishing (503), the same as on the packages page.
- risk: low

### 22 Oct 2026 · 8.7d the page polls every 5 s while a run is open · decided by builder · risk: low
- Decided: `/teacher/publish` polls GET every 5 s while the run is `queued` or `running`, one request at a time. A failed poll keeps the last run and shows "could not be refreshed just now". Polling stops when the run finishes or the page closes.
- Why: a gate can run up to 2 h; 5 s is cheap and feels live.
- risk: low

## Left to do

- **Dev-stack browser walkthrough** with a scripted-gate worker build: start, see running, then passed, on the real web and worker containers. Not done here (see Walkthrough). A live-model walkthrough waits on B-40.
- **"Changed since last publish" note** in the studio (lead answer Q10): needs a read that compares the current basis (material revision, package versions, style card) with the last published run. Not in Phase D's file list; suggest a small follow-up or fold it into Phase E or 13.regate.
- **Scorecard on the public teacher page:** Phase E (needs 9.2c).

### 22 Oct 2026 · 8.7d review: the pick() narrowing cast stays · decided by lead · risk: low
- Decided: the `(v as K)` cast in PublishView.tsx pick() is kept (wontfix); 8.7d's other MEDIUM and LOW review findings go to board task 8.7l.
- Why: the cast follows an `.includes()` check against the same literal list, which is the usual way to narrow in TypeScript; nothing in the deferred findings blocks a teacher from publishing.
- risk: low
