# 8.7h handoff: audit scrubber corrupts ids (packages/db)

Status: DONE

- Branch: `m8/8.7h-audit-uuid` (built locally as `work-87h`)
- Worktree: `.claude/worktrees/agent-a3a3cb9e8b7ad9862`
- Tool calls used: 51

## Summary

`redactPersonalData` (via `redact-json.ts`, used by `audit.ts`) ran `PHONE_CANDIDATE` over every
string value, including UUID-shaped ids. A UUID's hyphen-separated groups are hex, and a group
that happens to be all digits (e.g. the first group of `12345678-90ab-4cde-8f12-1234567890ab`, or
any group of a crypto-random UUID about 1 in 40 times) matched the phone-shaped digit-run regex
and was replaced with `[redacted]`, corrupting `runId`/`entityId` values stored in `audit_log`
before/after payloads. This made the 8.7a goLive audit test flaky.

Fix: `redactString` now finds every UUID-shaped span (`\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-
[0-9a-f]{4}-[0-9a-f]{12}\b`, case-insensitive) in the string *after* email redaction, and the phone
regex's replace callback skips any candidate match that falls fully inside one of those spans. This
covers both a value that is exactly a UUID and a UUID embedded in a longer string (e.g. an audit
note). A phone number sitting right next to a UUID in the same string is still redacted, because
its match span does not fall inside the UUID span. The phone rule for ordinary digit runs in free
text (not UUID-shaped) is unchanged.

No "known id key" allowlist was added: the bug was in the value-level phone rule, not in the
key-matching rule (`SUBSTRING_TERMS`/`WORD_TERMS`), and the accept criteria (property test over
random UUIDs, phone numbers still caught) is met by the value-shape exemption alone. Keeping the
fix to one new constant (`UUID`) and two small helpers (`uuidSpans`, `coveredBy`) matches the
lead's "keep it narrow" note.

## Files

- `packages/db/src/repositories/redact-json.ts`: added `UUID`, `uuidSpans`, `coveredBy`; changed
  `redactString` to skip phone-regex matches contained in a UUID span.
- `packages/db/test/redact-json.test.ts`: added a property test over 10,000
  `crypto.randomUUID()` values, crafted UUIDs whose groups are all digits, a UUID embedded in free
  text (both cases), a phone number next to a UUID (still redacted), and a non-UUID digit run in
  free text (still redacted).

## Tests

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` — green (62 test files,
  1111+ tests incl. new ones; coverage thresholds met, including 100%/90%+ on
  `src/repositories/**` with the integration suite running against the shared local Postgres on
  127.0.0.1:55432).
- 8.7a's `publish.int.test.ts` test "publishes the agent version and every package version in one
  transaction, with audit rows" (the goLive audit test) was looped locally against a disposable
  Postgres container I started and stopped myself (`docker compose ... -p edmate-87h up/down
  postgres`, port 55432): 200/200 passed (loop not committed). An earlier loop run concurrently
  with another test run, and a later run after the shared `edmate-e2e-97a-postgres-1` container
  (another builder's, left exited) was no longer reachable, both produced unrelated infra failures
  (connection/skip errors, not test assertion failures); the clean 200/200 run above is against my
  own container, alone.
- `python3 .githooks/secret-scan.py --all` — clean.

## Decisions

### 22 Oct 2026 · 8.7h UUID-shaped values are exempt from the phone digit-run rule · decided by builder · risk: high
- Decided: in `redactPersonalData`'s string scrubber, a UUID-shaped span (whole value or embedded
  in free text, case-insensitive) is never treated as a phone-number candidate, even when one of
  its hyphen-separated groups is all digits. A phone number elsewhere in the same string, including
  right next to a UUID, is still redacted.
- Why: about 1 in 40 real UUIDs (crypto-random) have a group that is all digits, and the previous
  phone regex redacted that group, corrupting `runId`/`entityId` in audit rows. Exempting the UUID
  shape (not loosening the phone digit-run length/format rules) fixes this without weakening
  phone/PII detection for ordinary text.
- risk: high (this file is on the risky-paths list for `packages/db/src/repositories/**`; it
  changes what the audit scrubber redacts).

## Left to do

None known. If a future id format that is not a standard UUID (e.g. a prefixed id like
`run_01HXYZ...`) turns out to have the same digit-run problem, extend `uuidSpans`-style exemption
or add a named id-key allowlist (keep it in one constant, per the lead's note) rather than
loosening `PHONE_CANDIDATE`.

Status: DONE
