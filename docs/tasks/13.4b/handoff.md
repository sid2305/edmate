Status: DONE

## Summary

Account-wide export and account delete (13.4 Phase C), built per `docs/tasks/13.4b/plan.md`.

- `packages/db/src/repositories/safety-alerts.ts` — added `hasOpenForStudent(studentId)`: a
  boolean-only read of whether the student has any open (unacknowledged) safety alert, across
  every teacher. Used only by the account-delete hold.
- `packages/db/test/safety-alerts.int.test.ts` — new `hasOpenForStudent` suite (no alerts /
  open / another student / acknowledged).
- `packages/db/test/repositories.int.test.ts` — added the required isolation case for the new
  method (`safetyAlerts.hasOpenForStudent`), matching the `isAcknowledged` pattern.
- `apps/web/src/export/accountExport.ts` (new) — `buildAccountExport` aggregates every live
  subscription pair (`subscriptionPairs.listLiveForStudent`) plus the student's own identity
  fields (`identity.getUser`, minus internal ids) into one JSON document; `createAccountExportHandler`
  wires it to `withRole`, attachment-disposition, no-store, 500 with name-only error logging.
- `apps/web/src/export/accountExport.test.ts` (new) — fake-backend unit tests (rule 4): per-pair
  export, account fields, missing user, empty pairs, truncation naming, do-not-leak regex,
  principal-id-only usage, 500 logging.
- `apps/web/src/account/delete.ts` (new) — `createDeleteHandler`: checks
  `safetyAlerts.hasOpenForStudent` first (409 `delete_on_hold` hold, nothing anonymised, no
  sign-out); else `identity.anonymise(principal.userId)` (404 on `not_found`/`scope`, 500 with
  name-only logging otherwise), then a separate try/catch around `signOut({redirect:false})` so a
  sign-out hiccup after a successful delete still returns 200.
- `apps/web/src/account/delete.test.ts` (new) — fake-backend unit tests covering all of the above.
- `apps/web/app/api/me/route.ts` + `.test.ts` (new) — `DELETE` guarded `['student']`, using the
  pre-declared policy row.
- `apps/web/app/api/me/export/route.ts` + `.test.ts` (new) — `GET` guarded `['student']`.

No files under `apps/web/src/auth/**`, `packages/contracts`, or `packages/db/src/identity/**`
were touched.

## Decisions

### 26 Oct 2026 · 13.4b account export scope (consents and ended subscriptions) · decided by builder · risk: high
- Decided: the account export includes only live subscription pairs
  (`subscriptionPairs.listLiveForStudent`, which excludes `status: 'ended'`) and the student's
  own identity fields (`identity.getUser`, minus `id`/`role`). It does not include consents rows
  or ended subscriptions.
- Why: the parent 13.4 Phase C text mentioned "every live/ended subscription pair" and "consents
  rows," but no consents repository exists (consents live only inside
  `packages/db/src/identity/store.ts`, out of bounds for 13.4b — another builder's file), and
  `subscriptions.ts` (the only place that could add an ended-inclusive read) is also out of
  bounds per this task's file list. Flagging `risk: high` because this names a personal-data
  surface (account export) with a real, if narrow, completeness gap: a student's export omits
  consent history and past (ended) subscriptions. Follow-up: a later task should either add a
  consents-read method and an ended-inclusive subscription read, or confirm this narrower scope
  is acceptable for the pilot.

### 26 Oct 2026 · 13.4b delete-on-hold response shape · decided by builder · risk: low
- Decided: `DELETE /api/me` returns a custom `{ error: 'delete_on_hold', message }` 409 body
  (not the standard `apiError()`/`ErrorCode` envelope) when the student has an open safety alert.
- Why: `'delete_on_hold'` is not in the `ErrorCodeSchema` enum in `packages/contracts/src/shared.ts`,
  and `packages/contracts` is out of bounds without an ADR. A one-off literal response matches
  the plan's exact wording without touching contracts.

### 26 Oct 2026 · 13.4b sign-out reuse via signOut({redirect:false}) · decided by builder · risk: low
- Decided: the delete handler calls NextAuth's `signOut({redirect: false})` directly from
  `apps/web/src/account/delete.ts` rather than adding anything to `apps/web/src/auth/**`.
- Why: `apps/web/src/auth/**` is out of bounds (another builder's area); `signOut` with
  `redirect: false` already returns a URL instead of throwing/redirecting, so it can be called
  from a Route Handler as-is. Its failure is caught separately so it can never turn an already
  -successful delete into an error response to the client.

## Gate

```
corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --filter=@edmate/web...
→ Tasks: 38 successful, 38 total (includes @edmate/db#test: 1705 passed, 4 skipped;
  @edmate/web lint/typecheck/test all green)

corepack pnpm exec prettier --check <changed files>
→ All matched files use Prettier code style! (after one --write pass for formatting)

python3 .githooks/secret-scan.py --all
→ clean, no output
```

An earlier full-graph run (`--filter=@edmate/web...`) also surfaced failures in
`@edmate/content#test` (a timing-probe test) and `@edmate/harness` (`preGuard.test.ts`) — both
in packages untouched by this task and outside its file list; not investigated further here
since they are unrelated to the diff and fixing them would mean touching files outside the plan.

## Budget

Tool calls used: 52
