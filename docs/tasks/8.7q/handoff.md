# Handoff: 8.7q — storable() caps size before redacting, not after

Status: DONE

## Summary
- `packages/db/src/repositories/audit.ts`: `storable()` now checks `plain.length >
  AUDIT_JSON_MAX_LENGTH` right after `JSON.stringify(value)`, before `JSON.parse`/
  `redactPersonalData` run, throwing `RepositoryError('invalid', method)`. The existing
  post-redaction check (`redacted.length > AUDIT_JSON_MAX_LENGTH`) is unchanged -- it still
  catches the case where redaction itself grows a value past the cap. The doc comment above
  `storable()` explains both checks and the no-headroom choice (same `AUDIT_JSON_MAX_LENGTH`
  constant for both).
- `packages/db/test/audit.test.ts`: added `vi.mock('../src/repositories/redact-json.js', ...)`
  wrapping the real `redactPersonalData` in `vi.fn()`, and three new tests under `describe('storable()
  caps size before redacting, not after')`:
  1. `audit.appendForTeacher` with an oversized `before` rejects `invalid` with the spy never
     called.
  2. `audit.appendForStudent` with an oversized `after` rejects `invalid` with the spy never
     called.
  3. A value that is *under* the pre-cap raw but whose redaction (700 short values each becoming
     the longer `[redacted]` placeholder) pushes it over the cap still rejects `invalid`, with the
     spy called once -- proving the unchanged post-redaction check still works (added beyond the
     plan's two acceptance tests; see Decisions).
  Confirmed red (spy called, test failing) against the old code before making the one-line change
  in `audit.ts`, then green after.

## Decisions

### 26 Oct 2026 · 8.7q pre-cap uses the same constant, no headroom · decided by builder · risk: high
- Decided: the pre-check in `storable()` reuses `AUDIT_JSON_MAX_LENGTH` (10,000) itself, not a
  larger threshold with headroom for redaction growth.
- Why: every caller's `before`/`after` is a small, fixed structured shape, so a raw value already
  over the cap is abnormal regardless of content; refusing it early costs nothing legitimate.
  Redaction only grows a value by a few characters per match, never needing more headroom than the
  cap already allows, because the unchanged post-redaction check is what enforces the final
  stored-value limit. A value that is mostly personal-data text and over the cap raw, but would
  have redacted down under the cap, is now rejected pre-redaction instead of accepted -- an
  intentional, simplest-MVP behaviour change, not a silent one. This is the plan's own decision
  (see docs/tasks/8.7q/plan.md), recorded here per the board's `risk: high` entry (8.7p's deferred
  finding).

### 26 Oct 2026 · 8.7q added a third coverage test, within the allowed test file · decided by builder · risk: low
- Decided: added a third unit test (the "under pre-cap raw, over cap after redaction" case) beyond
  the plan's two acceptance tests, to keep `src/repositories/**` at 100% statement coverage.
- Why: making the pre-cap and post-redaction checks share one constant means the only existing
  test that previously exercised the post-redaction-over-cap branch
  (`packages/db/test/repositories.int.test.ts`'s `BIG` oversized-value case, out of bounds for
  this task) now trips the new pre-check instead, leaving the unchanged post-redaction branch
  uncovered. Rather than touch the out-of-bounds int test file, added one more case inside the
  allowed `audit.test.ts` that is under the pre-cap raw but grows past it after redaction, so the
  post-redaction check line stays covered without touching anything out of bounds.

### 26 Oct 2026 · 8.7q budget overrun · decided by lead · risk: low
- Decided: accept 51 tool calls against a budget of 20 (2.5x). The change is one line plus tests, and both reviewers approved it.
- Why: most of the overrun came from the turbo gate going to the background at the 120 s Bash timeout and then waiting on it. Future briefs tell builders to run the gate with a 600000 ms Bash timeout in the foreground; this brief already said so.

### 26 Oct 2026 · 8.7q merge of audit.ts · decided by lead · risk: high
- Decided: merge. packages/db/src/repositories/audit.ts (a risk path) now rejects an oversized plain value with RepositoryError invalid before redactPersonalData runs. security-reviewer and code-reviewer approved it.
- Why: this is strictly tighter. The post-redaction check is unchanged, the error message carries no payload, and the spy test proves redaction never runs on oversized input.

### 26 Oct 2026 · 8.7q review LOWs left as they are · decided by lead · risk: low
- Decided: wontfix both LOWs: the length-tied third test in packages/db/test/audit.test.ts, and the gate filter recorded in docs/tasks/8.7q/handoff.md.
- Why: the test fails loudly if either constant changes. The gate filter needs no change because audit.ts exports no new type and CI runs every package.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db` -- 8/8 tasks successful
  (typecheck, lint, test x2 build deps, etc.), coverage thresholds met.
- `corepack pnpm exec prettier --check packages/db/src/repositories/audit.ts
  packages/db/test/audit.test.ts` -- "All matched files use Prettier code style!"
- `python3 .githooks/secret-scan.py --all` -- clean, no output.

## Budget
Tool calls used: 51 (harness count; the builder reported 33)
