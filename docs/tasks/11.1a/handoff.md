# 11.1a handoff — live classes repository (Phase A)

## Summary

Adds the `liveClasses` repository to `packages/db`, per `docs/tasks/11.1/plan.md`'s "Phase A".
In-app, pull-based only (decision B-45, 22 Oct 2026): no email/SMS, no background job
(`packages/queue/**` and `apps/worker/**` are untouched). No migration was needed: `live_classes`
and `class_questions` already existed in the schema from migration 0001.

- `create(scope, { title, link, startsAt, packageIds })` — a teacher schedules one of their own
  live classes, attached to 1..20 of their own packages. `link` must be an http(s) URL and
  `startsAt` a future timestamp (`invalid`); any package id that isn't the scope's own is
  `not_found`, key-share locked in the same transaction as the insert (same shape as
  `packages.ts`'s `checkModules`). Writes one `live_class.schedule` audit row.
- `listForTeacher(scope)` — the scope's own classes, soonest first.
- `listUpcomingForStudent(scope, { now? })` — the scope's own teacher's classes that have not
  started, attached to the base package of the scope's own live (`trial`/`active`) subscription
  only (lead answer Q2, 22 Oct 2026); `paused`/`past_due`/`ended` see nothing. Each row carries a
  window label (`reminder_24h`/`reminder_1h`/`starting_soon`/`later`).

**Window label**: computed in exactly one place — `windowLabel()` in
`packages/db/src/repositories/live-classes.ts` (lines 42-48), called only from
`listUpcomingForStudent`. `options.now` overrides the clock for deterministic tests only.

## Files

- `packages/db/src/repositories/live-classes.ts` (new) — the repository.
- `packages/db/src/repositories/index.ts` — registered `liveClasses` in `createRepositories()`
  (own two lines) and re-exported its public types/constants (own export block at the end).
- `packages/db/src/repositories/README.md` — new "Live classes (task 11.1a)" section.
- `packages/db/test/repositories.int.test.ts` — three new `CASES` entries
  (`liveClasses.create`, `liveClasses.listForTeacher`, `liveClasses.listUpcomingForStudent`), their
  `beforeAll` fixtures (a shared per-teacher live class, plus a per-pair dedicated package +
  version + live class so `listUpcomingForStudent`'s coarser-than-one-pair entitlement can still
  be checked exclusively per pair), and a dedicated self-contained acceptance test covering the
  full trial/active/past_due/paused/ended/wrong-package/no-subscription/past-class scenario and
  every window label.
- `packages/db/test/scope.test.ts` — no edit needed (fully generic; its 135 tests automatically
  cover the 3 new methods' bad-scope sweep).

## Tests

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` — green (26/26 tasks),
  100% statement/branch/line coverage on `src/repositories/**` (project threshold).
- `packages/db/test/repositories.int.test.ts` against a disposable Postgres container
  (`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`,
  stopped afterward with `docker compose -f docker/compose.yaml stop postgres`; the running
  `edmate-*` stack was never touched) — 130/130 isolation cases pass, including the 3 new ones
  and the dedicated acceptance test.
- `python3 .githooks/secret-scan.py --all` — clean.

## Decisions

### 22 Oct 2026 · 11.1a new `liveClasses` repository on a risky path · decided by builder · risk: high
- Decided: `packages/db/src/repositories/live-classes.ts` is a new repository on the risky path
  `packages/db/src/repositories/**`. It follows the existing repository rules exactly (scope
  validated first, ownership checked inside the write's own transaction, audit row written,
  driver errors scrubbed by `guardAll`), reviewed against `packages.ts`/`audit.ts`'s established
  shapes.
- Why: any new file under `packages/db/src/repositories/**` is risky-path by the merge gate's
  rules; this one owns a new data-access surface (a teacher's live classes and a student's
  entitlement to them), so a reviewer should confirm the isolation guarantees before merge.
- risk: high

### 22 Oct 2026 · 11.1a live-class reminders are in-app only for now (B-45) · decided by lead · risk: medium
- Decided: live class reminders are in-app, pull-based only for now — no email/SMS, no background
  job.
- Why: keeps Phase A inside `packages/db` only, with no new dependency on `packages/queue` or
  `apps/worker`, matching the lead's current-focus priority of a testable product fast.
- risk: medium

## Left to do

Nothing outstanding for Phase A. Phases B/C of task 11.1 (per `docs/tasks/11.1/plan.md`) are out
of scope for this handoff.

Status: DONE

Tool calls used: 148 (harness count; the builder reported about 45)
