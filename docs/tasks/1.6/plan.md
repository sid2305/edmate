# 1.6 plan: Audit log helper

Board: `board.py show 1.6` · Milestone M1 · deps: 1.1 (done), M0 (done) · branch `m1/1.6-audit-log` · risk: **risky** (`packages/db/src/repositories/**`).

## Acceptance (verbatim, `docs/board/tasks.yaml`)
Title: "Audit log helper."
Accept: "config, staff and memory changes write before/after rows."

Spec it must honour:
- Build plan § Data model: `audit_log` | actor, action, target, before/after, ts | Config, staff and memory changes. "Teacher-owned rows carry `teacher_id`; student rows carry `student_id`; repositories require the right scope."
- Build plan § Staff console: "Every action audited." PRD: "Student control: view, reset and export what the agent remembers; every change audited" (6.5); "approve/reject audited; unverified teachers stay unpublished" (12.1); reports/takedowns/regulated-subject/safety-alert tasks (12.2–12.5) all depend on 1.6.
- `packages/db/src/schema/operations.ts:141`: "Config, staff and memory changes. Append-only by convention (enforced in 1.6)."
- `packages/db/src/repositories/README.md` rules 1–9 (scope first, validated before SQL, scope in the same statement, fail closed, rows leave as contract-shaped, ownership columns immutable, no raw SQL/deletes, no personal details) — 1.2's pattern, reused, not changed.
- 1.2 review deferral: `audit_log.before/after` left `unknown` (no contract type) — 1.6 owns it (`docs/tasks/1.1/plan.md`'s jsonb table; 1.2 plan's deferral list).
- CLAUDE.md rule 5: the repo is public; no real student data, teacher uploads or personal details, ever, including in `before`/`after`.

### How it is shown (paste into handoff.md)
| Part | Evidence |
|---|---|
| Config, staff and memory changes write before/after rows | `test/repositories.int.test.ts` (real Postgres): one append per category — a config change (teacher scope, e.g. `package.publish`), a staff change (teacher scope, e.g. `teacher.verify`, actor role `staff`), a memory change (student scope, e.g. `profile.reset`) — each with a representative `before`/`after` object; a matching list read returns the row with `before`/`after` redacted and intact for non-personal fields. |
| Append-only | No `update`/`delete` method is exported (`src/repositories/audit.ts`); `test/scope.test.ts`'s existing static check (no `sql.raw(`, no `.delete(` anywhere under `src/repositories/`) already scans the new file — unmodified, still green. |
| Redaction of personal data | `test/redact-json.test.ts` (unit, no DB): nested objects/arrays with denylisted keys (any case) become `'[redacted]'`; non-denylisted keys and primitives are untouched; depth cap on adversarial input. Int test: an append whose `before` carries `email`/`name` stores the redacted form, never the raw value (checked with a raw `select` against the test DB). |
| Scoped reads (teacher and student) | Same int test, reusing 1.2's isolation grid: `audit.listForTeacher`/`listForStudent` added to `CASES`; another teacher's or student's rows read as empty; a bad scope throws `scope` before SQL (`test/scope.test.ts`, automatic). |
| Migrate up/down clean | `test/migrate.int.test.ts` is unmodified but table/column/index-agnostic (`latestSnapshot()`): the new migration's columns and indexes are asserted automatically once `drizzle-kit generate` regenerates the snapshot. |
| Gates | `corepack pnpm turbo run build typecheck lint test --filter=@edmate/db...` with Postgres up; coverage of `src/repositories/audit.ts` and `src/repositories/redact-json.ts` pasted. Secret scan clean. |

## Design

### Schema: additive migration on `audit_log` (1.1 built the table; 1.6 extends it)
The 1.1 table has `actor`, `action`, `target`, `before`, `after`, `ts` only — no way to record the actor's **role** or a **reason**, and no scope column for isolated reads. `packages/db/src/schema/operations.ts`'s `auditLog` gets four new columns, additive only (no `DROP`, so `merge_gate.py`'s `DESTRUCTIVE_SQL` check stays clean):
- `actorRole`: reuse the existing `userRole` pgEnum (`student | teacher | staff`) from `_shared.ts` — no new enum. `NOT NULL`; every append states who acted.
- `teacherId`: reuse the shared `teacherId()` helper from `users.ts` (`text`, `NOT NULL`, references `users.id`) — every audited event in the current build plan is about one teacher (config, staff action on a teacher/their content, or a student×teacher memory change); see Open questions Q3.
- `studentId`: a new **nullable** FK column (`text`, references `users.id`) — not the shared `studentId()` helper, which is `NOT NULL`. Set for memory/student-scoped events, left `null` for teacher-only ones (config, staff actions on a teacher).
- `reason`: nullable `text` — a short human-readable reason (e.g. a takedown's reason, "student requested reset"); not required for routine config changes.

New indexes: `audit_log_teacher_id_ts_idx` on (`teacherId`, `ts`) and `audit_log_teacher_id_student_id_ts_idx` on (`teacherId`, `studentId`, `ts`). The existing (`target`,`ts`) and (`actor`,`ts`) indexes from 1.1 stay (useful for the later, staff-wide trust console).

Generated with `drizzle-kit generate` (not hand-written), reviewed by `database-reviewer` for index shape. No data migration/backfill needed: nothing writes to `audit_log` yet (no caller exists before 1.6), so `NOT NULL` columns with no default are safe in every environment that will run this migration.

### Repository: `packages/db/src/repositories/audit.ts`
Four methods, following 1.2's pattern exactly (scope first, validated with `teacherScope`/`studentScope`, no raw SQL, no personal columns selected):

| Method | Scope | Read/write | Detail |
|---|---|---|---|
| `appendForTeacher(scope: TeacherScope, entry)` → `void` | Teacher | W | Inserts with `teacherId = scope.teacherId`, `studentId = null`. For config and staff changes about one teacher (teacher verification, takedowns, publish). |
| `appendForStudent(scope: StudentScope, entry)` → `void` | Student | W | Inserts with both ids from `scope`. For memory/profile changes (6.5) and staff actions on a specific student×teacher pair. |
| `listForTeacher(scope: TeacherScope, { target?, limit })` → `AuditRow[]` | Teacher | R | `teacherId = scope.teacherId` (+ optional `target` filter); newest first, capped (`AUDIT_MAX_LIMIT = 200`, same style as `messages.history`'s `HISTORY_MAX_LIMIT`). |
| `listForStudent(scope: StudentScope, { target?, limit })` → `AuditRow[]` | Student | R | `teacherId` and `studentId` both from `scope`. |

`entry` (local Zod schema, not from contracts — there is no `AuditEntry` contract type, same precedent as `sessions.ts`'s locally-defined `NewSession`): `{ actor: IdSchema, actorRole: z.enum(['student','teacher','staff']), action: z.string().min(1).max(100), target: z.string().min(1).max(200), reason?: z.string().min(1).max(500), before?: unknown, after?: unknown }`. Both writers share one internal `insertEntry()` helper so the redaction and size cap live in one place.

`before`/`after`: each is run through `redactPersonalData()` (below), then size-capped after `JSON.stringify` (10 000 chars) — oversized payloads throw `RepositoryError('invalid', method)` rather than being silently truncated (fail closed, not fail quiet). `target` keeps the existing `<kind>:<id>` convention already used by `reports`/`takedowns`/`safety_events` (e.g. `agent:ag_1`, `profile:stu_1:tch_2`); not FK-enforced (it can name any table), so it is treated as a plain, length-capped string, not validated against a particular table.

No `update`, no `delete` — matching 1.2's rule 7 ("no delete methods") and the schema comment's "append-only by convention." Enforcement is the same as every other repository: the method isn't exported, and `test/scope.test.ts`'s existing static check (grep for `sql.raw(`/`.delete(` across `src/repositories/`) already covers the new file without modification. No Postgres-level trigger or privilege REVOKE is added — the codebase has no precedent for DB-level write restriction (the app connects as one role throughout), and adding one is a larger, separate piece of work; see Open questions Q4.

### Redaction: `packages/db/src/repositories/redact-json.ts`
A small, pure, exported helper (reusable by 12.x's `staff_actions` jsonb later, which has the same personal-data concern):
```
redactPersonalData(value: unknown, depth = 0): unknown
```
Recurses into plain objects and arrays (depth-capped, e.g. 8, so adversarial input can't cause unbounded recursion — deeper structure is kept as-is rather than erroring, since this is a defense-in-depth scrub, not a validator). For object keys, a case-insensitive denylist (`email`, `phone`, `name`, `displayName`, `firstName`, `lastName`, `address`, `bio`, `photo`, `ip`, `ipAddress`) is replaced with `'[redacted]'`; every other key is kept, recursing into its value if it is itself an object/array. This is **defense in depth**, not a guarantee: callers (future tasks writing audit entries) must still avoid putting raw personal text in `before`/`after` wherever they can, per rule 9 ("no personal details"). The exact denylist is a review point — see Open questions Q2.

### Reads: scoped now; staff's cross-teacher view is 12.1's problem, not 1.6's
`listForTeacher`/`listForStudent` reuse the exact `TeacherScope`/`StudentScope` isolation the rest of `packages/db` already enforces, and get real isolation-grid test cases like every other method (no exception to README rule 1 here). The trust console (12.1, depends on 1.6) needs **staff-wide** reads across every teacher, which is a genuinely different access pattern (staff isn't scoped to one teacher) that the current isolation invariant doesn't support — 1.6 does **not** build that; it is 12.1's own, separately reviewed addition (see Open questions Q1). `packages/db/src/repositories/README.md` gets a short note recording this boundary so a future reader/reviewer isn't surprised that the trust console needs a new read path.

### `map.ts` / `createRepositories` / exports
- `map.ts`: `toAuditRow(row, method)` — maps the stored row to an `AuditRow` interface (not a contract type, same precedent as `SessionRow`): `{ id, actor, actorRole, action, target, teacherId, studentId, reason, before, after, ts }`. `before`/`after` are passed through as already-redacted JSON (`null` → omitted key, matching the `exactOptionalPropertyTypes` convention in the other mappers); no contract schema to validate against, so no `integrity` check beyond "is it the jsonb Postgres already enforced."
- `createRepositories`: add `audit: guardAll('audit', auditRepo(db))`.
- `repositories/index.ts`: export `AuditRow`, `AuditEntryInput` (the writer input type) and `redactPersonalData` alongside the other repo exports (`@edmate/db`'s root export, per 1.2's narrowed surface — no raw handle, no schema).

## Tests first (TDD: red, then green)
1. **`test/redact-json.test.ts`** (unit, no DB): denylisted keys at the top level and nested inside objects/arrays, mixed case keys, non-denylisted keys and primitives preserved, `null`/`undefined`/arrays-of-primitives pass through unchanged, depth cap on a deeply nested adversarial object.
2. **`test/repositories.int.test.ts`** (extend `CASES`, real Postgres, the existing isolation seed from 1.2 — teachers A/B, students 1/2):
   - `audit.appendForTeacher` / `audit.appendForStudent` as `WriteCase`s (model: `packageVersions.create` for the teacher-scoped one, `evidenceEvents.append` for the student-scoped one) — another scope's `teacherId`/`studentId` in the scope argument itself is covered by the existing bad-scope grid; this task adds the owns/positive-control check (actor's own append is readable back only by the actor).
   - `audit.listForTeacher` / `audit.listForStudent` as `ReadCase`s (model: `teacherQuestions.listForTeacher` / `messages.history`) — another scope's rows read as empty; `limit` 1..200 enforced, rejecting 0 and 201 with `invalid`.
   - The three "how it is shown" scenarios (config/staff/memory) as explicit cases proving real `before`/`after` payloads round-trip redacted.
   - An oversized `before` (>10 000 chars after `JSON.stringify`) throws `invalid` and writes nothing.
3. **`test/migrate.int.test.ts`**: unmodified; `expectFullSchema()` already asserts every column/index in the latest snapshot dynamically, so the new migration's columns and indexes are checked without new test code once `drizzle-kit generate` runs.
4. **`test/scope.test.ts`**: unmodified; its generic `Object.entries(repos)` iteration and static grep already cover the new file and its methods.

Then implement: `redact-json.ts` (standalone, no DB) → schema change + `drizzle-kit generate` → `map.ts`'s `toAuditRow` → `audit.ts` → wire into `index.ts`/`repositories/index.ts` → README note.

Command: `source ~/.nvm/nvm.sh && corepack pnpm turbo run build typecheck lint test --filter=@edmate/db...` with `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`.

## Files

### Create
- `packages/db/src/repositories/audit.ts`, `redact-json.ts`
- `packages/db/test/redact-json.test.ts`
- `packages/db/migrations/0002_<drizzle-kit-name>.sql` (+ `meta/0002_snapshot.json`, `meta/_journal.json` entry — all `drizzle-kit generate` output)
- `docs/tasks/1.6/handoff.md` (builder), `docs/tasks/1.6/review.md` (reviewers)

### Modify
- `packages/db/src/schema/operations.ts` (four new `auditLog` columns + two indexes)
- `packages/db/src/repositories/map.ts` (`toAuditRow`), `index.ts` (`audit` in `createRepositories`; exports), `README.md` (note on the teacher/student scope boundary vs. the later staff-wide view)
- `packages/db/test/repositories.int.test.ts` (new `CASES` entries)
- `pnpm-lock.yaml` if any dependency version shifts (unlikely — no new dependency)

### Out of bounds
- `packages/contracts/**` — no new contract type; `AuditRow`/`AuditEntryInput` are db-local, same precedent as `SessionRow`.
- Any actual caller of `audit.append*` — publish (4.x/5.x), memory reset (6.5), staff console actions (12.1–12.5) each add their own call when they land; 1.6 only builds the helper.
- Staff-wide (cross-teacher) audit reads — 12.1's own, separately reviewed addition (Open questions Q1).
- DB-level (trigger/privilege) append-only enforcement — not built; see Open questions Q4.
- `packages/harness/**`, `apps/**`, `packages/payments/**`, `.github/**`, `.claude/**`, `docs/adr/**` — untouched.

## Risky paths touched
Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
- `packages/db/src/repositories/**` (`audit.ts`, `redact-json.ts`, `map.ts`, `index.ts` changes) → group "access filter; money; sign-in, keys, keeping each teacher's and student's data apart" → **`security-reviewer`** required by the gate. Recommend also `database-reviewer` (migration/index shape) and `typescript-reviewer` (jsonb/row typing), matching 1.2's reviewer set; `review.md`'s `Reviewers:` line must name all three actually used.
- `packages/db/src/schema/operations.ts`, the new migration: not themselves a risk-paths.txt glob, but reviewed anyway (database-reviewer) since they're additive-only and the `DESTRUCTIVE_SQL` scan stays clean (no `DROP`/`ALTER … DROP`/`TRUNCATE`/`DELETE`/bare `UPDATE … SET`).
- All other planned paths (`README.md`, `test/**`, `docs/tasks/1.6/**`): no match.
- **Handoff must log a `risk: high` decision**, planned:

> ### 1.6 Audit rows are teacher-scoped (optionally also student-scoped); staff-wide reads are 12.1's addition · decided by planner · risk: high
> Decided: every `audit_log` row carries a `NOT NULL teacher_id` and the write/read methods take the same `TeacherScope`/`StudentScope` 1.2 already enforces, with no exception to "scope first, always required." `before`/`after` are redacted against a denylist before they are stored, in addition to callers' own care. No update/delete method exists. Staff's cross-teacher trust-console view is deliberately not built here.
> Why: keeps the one isolation invariant 1.2 locked in (and that `security-reviewer` checks) true for every repository method, including this one; every current use (config, staff, memory) in the build plan is teacher-anchored.
> Alternatives: an unscoped `append`/`list` pair guarded only by RBAC at the call site (rejected now — it would be the first repository exception to "scope first," and should get its own review when 12.1 actually needs it); Postgres RLS or a trigger for append-only (rejected — no existing precedent in this codebase, larger scope than this task).
> Reversible: yes — 12.1 can add a new, additively-migrated staff-wide read path without touching this one.

Other decisions to log (risk: low): reusing `userRole` for `actorRole` instead of a new enum; `studentId` nullable (teacher-only events have none); the redaction denylist and its depth/size caps; `target`'s `<kind>:<id>` convention is advisory (not FK-enforced).

## Open questions (recommendations; none blocks the build)
- **Q1. Staff's cross-teacher audit view.** The trust console (12.1) needs to see every teacher's rows, which the teacher/student scope system doesn't allow by design. Recommend: not 1.6's problem — 12.1 adds its own read path (likely RBAC-gated at the route layer, with its own review) when it lands; flag this explicitly in 12.1's plan so it isn't a surprise.
- **Q2. Redaction denylist.** The proposed list (`email, phone, name, displayName, firstName, lastName, address, bio, photo, ip, ipAddress`) is a judgement call, not exhaustive. Recommend shipping it and letting `security-reviewer` refine; it's an additive, no-migration change to extend later (it's just an array literal).
- **Q3. Is `teacherId` always present?** Every audited event in the current build plan (config, staff action on a teacher or their content, memory change) names one teacher. Recommend `NOT NULL` now; if a genuinely teacher-less platform event appears later (none exists in the build plan today), that's a small additive migration (make it nullable) at that time.
- **Q4. DB-level append-only enforcement.** The schema comment says "enforced in 1.6"; this plan enforces it at the application layer only (no exported update/delete method, same as every other repository), not with a Postgres trigger or REVOKE. Recommend accepting the application-layer enforcement as sufficient for now (consistent with `sessions`/`messages`, which also have no delete method and no DB-level trigger); a trigger-based belt-and-suspenders layer can be a separate, small hardening task if the human wants it (e.g. alongside 13.3's security review).

## READY
Nothing blocks the build. All four open questions have a recommended default; the schema change is additive-only and needs no ADR (`packages/db` schema is not one of the frozen things in rule 2 — contracts, tech stack and prompt-pack behaviour).

Before the final push: merge `origin/main`.

## Lead answers (18 Oct 2026)

- Q1–Q4: accepted as recommended (staff cross-teacher reads in 12.1; ship the proposed PII denylist for security-reviewer to refine; teacher_id NOT NULL; app-layer append-only, no update/delete exported).
- Reviewers: security-reviewer, database-reviewer, typescript-reviewer; handoff needs a risk: high entry.
- Before your final push: merge origin/main, regenerate the lockfile if it conflicts, re-run gates.
