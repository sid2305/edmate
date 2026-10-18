# 1.6 handoff: Audit log helper

Status: DONE
Branch: `m1/1.6-audit-log`
Worktree: `.claude/worktrees/agent-a8cbf5fcac9cc215a` (under the main checkout)
Reviewers needed (risky path `packages/db/src/repositories/**`): security-reviewer, database-reviewer, typescript-reviewer.

## Acceptance evidence

| Part | Evidence |
|---|---|
| Config, staff and memory changes write before/after rows | `test/repositories.int.test.ts` "config, staff and memory changes write before/after rows, personal keys redacted" (real Postgres 16): `package.publish` (teacher), `teacher.verify` (staff on teacher B), `profile.reset` (student 2 x teacher A); each read back with non-personal fields intact and `name` / `email` / `displayName` as `[redacted]`. |
| Append-only | `audit.ts` exports no update/delete; int test "audit is append-only" asserts the four method names exactly; `test/scope.test.ts`'s static scan (unchanged) covers `audit.ts` and `redact-json.ts`. |
| Redaction of personal data | `test/redact-json.test.ts` (73 unit tests, table-driven: compound keys such as `studentEmail`/`parentName`/`guardianPhone`/`fullName`, whole-word `ip`/`bio`, keys that must be kept such as `subscriptionId`/`description`/`biology`, compound keys nested in objects and arrays in any case, email/phone values whatever the key, dates/decimals/uuids kept, NFKC full-width, zero-width chars, `__proto__`, depth cap, 10k-key object, non-mutation). Int test: a raw `select before, after from audit_log` contains none of the raw values. Class instances and `toJSON` are redacted as the JSON they become. |
| Scoped reads | `audit.appendForTeacher/appendForStudent/listForTeacher/listForStudent` added to `CASES`; isolation summary: `appendForTeacher cases=20 leaks=0`, `appendForStudent cases=20 leaks=0`, `listForTeacher cases=22 leaks=0`, `listForStudent cases=24 leaks=0`. Bad scopes throw `scope` before SQL (`test/scope.test.ts`, automatic). |
| Migrate up/down clean | `migrations/0002_audit_log_scope.sql` (drizzle-kit generate; ADD COLUMN / ADD CONSTRAINT / CREATE INDEX only, no DROP). `test/migrate.int.test.ts` unmodified and green. |

Commands (Postgres up via `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`, stopped after):

```
corepack pnpm turbo run build typecheck lint test --filter=@edmate/db...
→ @edmate/db: Tests 237 passed (237); Tasks: 11 successful, 11 total (fix round 1; coverage thresholds met)
coverage (json-summary, round 0): audit.ts 100/100/100/100, redact-json.ts 100/100/100/100, map.ts 100/100/100/100; total lines 100, branches 99.41

corepack pnpm turbo run build typecheck lint test     (root, after merging origin/main)
→ Tasks: 41 successful, 41 total

python3 .githooks/secret-scan.py --all
→ exit 0, no findings

corepack pnpm format:check
→ only .github/workflows/ci.yml flagged; it comes from main, untouched here
```

`origin/main` merged cleanly (lockfile took main's version, no conflict; `pnpm install --frozen-lockfile` clean).

## Changes

- `packages/db/src/schema/operations.ts`: `audit_log` gains `actor_role` (existing `user_role` enum, not null), `teacher_id` (not null FK), `student_id` (nullable FK), `reason` (nullable); indexes `(teacher_id, ts)` and `(student_id, teacher_id, ts)`.
- `packages/db/migrations/0002_audit_log_scope.sql` + `meta/0002_snapshot.json` + journal entry (generated).
- `packages/db/src/repositories/audit.ts`: `appendForTeacher`, `appendForStudent`, `listForTeacher`, `listForStudent`; `AUDIT_MAX_LIMIT = 200`, `AUDIT_JSON_MAX_LENGTH = 10_000`.
- `packages/db/src/repositories/redact-json.ts`: `redactPersonalData`, `REDACTED`, `REDACT_MAX_DEPTH = 8`.
- `packages/db/src/repositories/map.ts`: `AuditRow` + `toAuditRow` (schema-checked; bad stored rows throw `integrity`).
- `packages/db/src/repositories/index.ts`: `audit` in `createRepositories`; exports `AuditRow`, `AuditEntryInput`, the caps and the redaction helper.
- `packages/db/src/repositories/README.md`: audit section and the 12.1 boundary note.
- Tests: `test/redact-json.test.ts` (new), `test/repositories.int.test.ts` (4 CASES + 6 tests), `test/isolation-seed.ts` (one audit row per teacher and per pair, owner-marked).

## Deviations from the plan

- Second index is `(student_id, teacher_id, ts)`, not `(teacher_id, student_id, ts)`: 1.1's `test/schema.test.ts` requires every `student_id` column to have an index led by `student_id`. It serves `listForStudent` the same way.
- `listForTeacher` returns teacher-only rows (`student_id is null`); the plan didn't say. See decisions.
- The depth cap replaces deeper structure with `[redacted]` instead of keeping it as is (the plan's text). See decisions.
- `before`/`after` go through a JSON round trip before redaction; an actor check was added. See decisions.

## Decisions

### 18 Oct 2026 · 1.6 Audit rows are teacher-scoped (optionally also student-scoped); staff-wide reads are 12.1's addition · decided by planner · risk: high
Decided: every `audit_log` row has a not-null `teacher_id`, and the write/read methods take the same `TeacherScope`/`StudentScope` that 1.2 enforces, with no exception to "scope first, always required." `before`/`after` are redacted against a denylist before they are stored, on top of callers' own care. There is no update or delete method; append-only is enforced in the app layer only (no trigger, no REVOKE). Staff's cross-teacher trust-console view is not built here.
Why: keeps the one isolation rule 1.2 set (and that security-reviewer checks) true for every repository method; every use the build plan has today (config, staff, memory) is about one teacher.
Alternatives: an unscoped `append`/`list` pair guarded only by role checks at the call site (it would be the first exception to "scope first"; 12.1 should review that when it needs it); a Postgres trigger or RLS for append-only (no precedent here, bigger than this task).
Reversible: yes. 12.1 can add a staff-wide read path with an additive migration without touching this one.

### 18 Oct 2026 · 1.6 A teacher's audit list leaves out student rows · decided by builder · risk: high
Decided: `listForTeacher` returns only rows with no `student_id`. A student's memory changes (and staff actions on one student) are readable only in that student's scope.
Why: the plan didn't say. A student's memory is theirs (PRD 6.5), and 1.2 already hides which student asked a question from the teacher; listing student rows to the teacher would show which student did what, plus their before/after.
Alternatives: include student rows in the teacher's list (simpler, but leaks per-student activity); include them with `studentId` and before/after removed.
Reversible: yes; it is one WHERE clause.

### 18 Oct 2026 · 1.6 The actor must match the scope · decided by builder · risk: low
Decided: a `teacher` actor must be the scope's teacher, and a `student` actor must be the scope's student (so a student can't act on teacher-only rows); otherwise `scope`. `staff` may act in any scope, and the caller's role check covers whether they are allowed to.
Why: stops a row claiming that someone outside the scope made the change.
Alternatives: record any actor as given.
Reversible: yes.

### 18 Oct 2026 · 1.6 Before/after go through JSON, then redaction, then a size cap; deep structure is redacted · decided by builder · risk: low
Decided: each value is `JSON.stringify`d and parsed back before redaction, so class instances, `toJSON` and dates are plain data first. Values JSON can't hold (bigint, cycles, a bare function) and anything over 10 000 characters after redaction are `invalid`, never truncated. Objects and arrays deeper than 8 levels become `[redacted]` instead of being kept as they are.
Why: redacting before the round trip would miss personal keys on class instances and `toJSON` output. Keeping deep structure unredacted would let personal data through the defense-in-depth layer.
Alternatives: the plan's "keep deeper structure as is"; redact without the round trip.
Reversible: yes.

### 18 Oct 2026 · 1.6 Redaction matches compound keys and email/phone values (fix round 1) · decided by builder · risk: high
Decided: after NFKC, removing zero-width and other format characters, lower-casing and removing `_ - . space`, a key is redacted if it **contains** `email`, `phone`, `name`, `address` or `photo` (so `studentEmail`, `parentName`, `guardianPhone`, `fullName` and `profilePhotoUrl` are caught). The short terms `ip` and `bio` only match as a whole word of the key (camelCase or separators: `clientIp`, `IPAddress`, `ip_v4`, `teacherBio`), because as substrings they hit real keys in contracts and schema (`subscriptionId`, `description`, `piiPatterns`) and words like `biology`. Inside any string value, whatever its key, email-shaped text and phone-shaped runs (7 or more digits, with spaces, dots, dashes or brackets between them) are replaced by `[redacted]`; ISO dates and plain decimals are left alone. The allowlist is empty. Harmless keys that contain a term (`packageName`, `namespace`) are redacted on purpose, and an allowlist should only be added when a real false positive gets in the way. A code comment records that cross-script homoglyph keys (a Cyrillic `е`) get past the NFKC fold: this is defense in depth, not a guarantee.
Why: security-reviewer HIGH. The exact-key match stored raw personal data under compound keys.
Alternatives: plain substring matching for every term (redacts `subscriptionId` and `description`); exact keys only (the reviewer's finding); dropping whole strings instead of the matched parts (loses the non-personal context).
Reversible: yes. It is one file and needs no migration; rows already written keep the redaction they were stored with.

### 18 Oct 2026 · 1.6 Schema details · decided by planner · risk: low
Decided: `actor_role` reuses the `user_role` enum; `student_id` is nullable (teacher-only events have none); `reason` is optional; `target`'s `<kind>:<id>` form is advisory and not a foreign key; `AuditRow` and `AuditEntryInput` are db-local types, not contracts.
Why: plan and lead answers Q3/Q4; there is no audit contract, and adding one would need an ADR.
Alternatives: a new enum; a contract type.
Reversible: yes.
