# Plan: 8.7q — storable() caps size before redacting, not after

## Acceptance (verbatim)
"storable() refuses an oversized value with RepositoryError invalid before calling
redactPersonalData; a test proves redaction is not called for it."

How it will be shown: a unit test in packages/db/test/audit.test.ts spies on
`redactPersonalData` (vi.mock with the real implementation wrapped in `vi.fn`, imported from
`../src/repositories/redact-json.js`) and asserts that calling `audit.appendForTeacher` (and
`appendForStudent`) with an oversized `before`/`after` value throws `RepositoryError('invalid',
method)` while the spy's call count stays 0. Both calls reject before any database access (same
pattern this file already uses for scope/invalid checks against the unreachable test pool), so
the test needs no real database and runs in the plain unit/typecheck/lint/test gate.

## The fix
`storable()` in `packages/db/src/repositories/audit.ts` currently does:
`JSON.stringify(redactPersonalData(JSON.parse(plain)))` and only then checks
`AUDIT_JSON_MAX_LENGTH` — so an oversized `plain` is redacted in full (cost, and the whole
raw value is walked by the regex-based redactor) before it is refused. Add one early check,
right after `plain` is computed and before `JSON.parse`/`redactPersonalData` run:

```
if (plain.length > AUDIT_JSON_MAX_LENGTH) throw new RepositoryError('invalid', method);
```

Keep the existing post-redaction check (`redacted.length > AUDIT_JSON_MAX_LENGTH`) exactly as
it is — it still guards the stored value in the case redaction grows a value that was under the
pre-cap.

### Pre-cap threshold: same constant, no headroom
The pre-cap reuses `AUDIT_JSON_MAX_LENGTH` itself (10,000), not a larger number. Reasoning to
put in the comment above `storable()`:
- Every caller's `before`/`after` is a small, fixed structured shape (`VerifyAfter`,
  `SubjectChange`, config/profile deltas) — nothing in this codebase sends anything close to
  10,000 raw characters today. A raw value already over the cap is abnormal regardless of how
  much of it is personal-data-shaped text, so refusing it before paying for redaction costs
  nothing legitimate.
- Redaction can lengthen a value (`REDACTED` is a fixed 10-character placeholder, which can be
  longer than the short real value it replaces, such as a brief personal-key value or a short
  matched contact string), but only by a few characters per match — it never needs *more*
  headroom than the final cap already allows for, because the existing post-redaction check
  (unchanged) is what actually enforces the stored-value limit. The pre-check's job is only to
  stop clearly oversized raw input from reaching the redactor at all, not to predict the exact
  post-redaction length.
- Redaction mostly *shrinks* a value (a long matched contact string or personal-key value becomes
  a fixed 10-character placeholder), so a raw value over the cap that is mostly personal-data
  text could in theory have redacted down under the cap. Using the same constant means that
  (very unlikely, and already out of scope per this repository's own rule that raw personal text
  should never reach these columns — README rule 9, "this only catches what slips in") case is
  now rejected pre-redaction instead of being redacted and accepted. This is accepted as the
  simplest, safest MVP choice; note it as a `## Decisions` line in the handoff so it is visible,
  not a silent behaviour change.

### Error message
`RepositoryError('invalid', method)` carries no payload content today and stays that way —
no change needed to keep the error free of personal data.

## Files to create/modify
- `packages/db/src/repositories/audit.ts` — the one-line pre-check in `storable()`, and an
  update to the doc comment directly above `storable()` (lines ~76-81) describing both checks
  and the no-headroom choice above.
- `packages/db/test/audit.test.ts` — the existing unit test file for this repository's
  no-SQL-reached error paths (it already exercises `audit.find*ForStaff` against an unreachable
  pool). Add:
  1. `vi.mock('../src/repositories/redact-json.js', ...)` wrapping the real `redactPersonalData`
     in `vi.fn()` (keep every other export real).
  2. A test calling `repos.audit.appendForTeacher({ teacherId: TEACHER }, { ...a valid entry
     shape..., before: 'x'.repeat(AUDIT_JSON_MAX_LENGTH + 1) })` (import `AUDIT_JSON_MAX_LENGTH`
     from `../src/repositories/audit.js` or `../src/index.js`), asserting the rejection is
     `RepositoryError('invalid', 'audit.appendForTeacher')` and
     `vi.mocked(redactPersonalData).mock.calls.length === 0` afterwards.
  3. The same shape for `appendForStudent` with an oversized `after` (or `before`), and scope
     `{ teacherId: TEACHER, studentId: STUDENT }`.
  4. Clear the spy's call count between tests (`beforeEach`/`afterEach`), since both tests share
     one mocked module instance within this file.
- `docs/tasks/8.7q/handoff.md` — written by the builder at the end, with `Status:`, `##
  Decisions` (the no-headroom pre-cap choice, `risk: high` per the board entry) and the tool
  calls used.

## Files out of bounds
Everything else in `packages/db`, named explicitly because this task sits next to several other
builders' work: `packages/db/src/index.ts`, `packages/db/src/repositories/index.ts`,
`packages/db/src/repositories/messages.ts`, `sessions.ts`, `subscriptions.ts`,
`usage-ledger.ts`, `migrate.ts`, `migrations/**`, `identity/**`, and
`packages/db/test/repositories.int.test.ts` (which already has its own, unrelated oversized-value
int-test coverage for `audit.appendForTeacher`/`appendForStudent` — those existing assertions
keep passing unmodified under this fix, since an oversized raw value still ends up `invalid`
either way).

## Tests first
Write the two new `audit.test.ts` cases (and the `vi.mock` spy wiring) before touching
`audit.ts`; confirm they fail against the current code (redaction still runs, so the spy *is*
called) before making the one-line change in `storable()` that makes them pass.

## Risky paths touched
- `packages/db/src/repositories/audit.ts` matches `packages/db/src/repositories/**` in
  `.claude/skills/merge-gate/risk-paths.txt` → required reviewer: `security-reviewer`.
- `packages/db/test/audit.test.ts` and `docs/tasks/8.7q/handoff.md` match no glob in
  risk-paths.txt.
This task is already `risk: high` on the board (8.7p's deferred finding); the handoff must log a
`## Decisions` line with `risk: high` (the merge decision, plus the pre-cap-headroom choice
above) for the digest.

## Gate
`corepack pnpm turbo run typecheck lint test --filter=...@edmate/db` and
`python3 .githooks/secret-scan.py --all`. No int/DB tests needed for this change (the new tests
are unit-only, same pool-unreachable pattern as the rest of `audit.test.ts`), but the filter
still runs the package's existing int tests in CI as usual.

## Open questions
None — the pre-cap threshold choice above is this plan's one open design question, and it is
decided (same constant, no headroom), with the reasoning recorded for the handoff's decision
log rather than left to the human.

## Budget
Budget: 20 tool calls (1 phase, packages/db)

## Allowed tools
Read, Grep, Glob, Edit, Bash (test and secret-scan only)

## Exit conditions
Status: DONE once both new unit tests pass, the full `--filter=...@edmate/db`
typecheck/lint/test gate is green, and the secret scan is clean. Status: PARTIAL past about 20
tool calls, or if making the tests pass turns out to need touching any out-of-bounds file listed
above (stop and hand back instead).
