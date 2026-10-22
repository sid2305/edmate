# 9.6g handoff

## Summary

Fixes the five 9.6b review findings deferred to this task, in `apps/web/src/export/` only:

1. **pdf.ts bullet byte.** The bullet is now mapped to WinAnsi `0x95` (`BULLET_CODE`/`BULLET_CHAR`)
   instead of the raw Unicode `•` (U+2022), whose low byte (`0x22`) printed as a stray quote. Its
   width (`BULLET_WIDTH`, the standard Helvetica AFM value, 350 units) is now reserved on a
   bulleted line's first wrapped line via a new `firstLineReserve` parameter on `wrap()`.
2. **pdf.ts C1 range / Latin-1 fallback.** `toWinAnsi` now strips the whole `0x80`-`0x9F` C1
   control range from input text (WinAnsiEncoding reuses those byte values for printable glyphs,
   including the bullet this module injects itself, so a real control character landing there must
   be dropped, not passed through as one of those glyphs). `widthOf`'s Latin-1 supplement fallback
   (`DEFAULT_WIDTH`) is now documented as a deliberate approximation rather than left unexplained.
3. **notes.ts answer pairing.** `answeredPairs` now pairs a question to a teacher message by exact
   timestamp equality first (`teacherQuestions.answer`'s single transaction writes a question's
   `answeredAt` and its teacher message's `createdAt` from the same `now()`, so they are
   byte-for-byte equal), falling back to the previous "nearest unused at-or-after" search only when
   no exact match exists. This fixes the case a single `answer()` call closes more than one of a
   student's questions but writes only one teacher message for them: every question sharing that
   exact timestamp now pairs to that one message, instead of the old code handing the next
   question's message to the wrong question (a real swap, verified with a red test below). No
   `packages/db`/`packages/contracts` change was needed or made — see Decisions.
4. **routes.ts double cast.** `ExportBackend`'s page-cursor type is now a real, documented
   `ExportCursor` interface (`buildExport.ts`) instead of `unknown`, restating the db repositories'
   own module-local cursor shape field-for-field (that type isn't exported through the `@edmate/db`
   barrel). `routes.ts` wires the repositories straight through with no cast at all; `as unknown as`
   no longer appears anywhere in the file.
5. **routes.ts error logging.** `fromError` now logs `[export] <error name>` via `console.error` on
   the 500 path (never the message), matching the `errorName` convention already used in
   `apps/web/src/studio/packages.ts` and `apps/web/src/discovery/rateLimit.ts`.

## Files

- `apps/web/src/export/pdf.ts`, `apps/web/src/export/pdf.test.ts`
- `apps/web/src/export/notes.ts`, `apps/web/src/export/notes.test.ts`
- `apps/web/src/export/routes.ts`, `apps/web/src/export/routes.test.ts`
- `apps/web/src/export/buildExport.ts` (new exported `ExportCursor` type only; no behaviour change)

## Tests

Each new test was run and confirmed red against the pre-fix code (via a temporary `git stash` of
only the source file, never the test file), then green after the fix:

- `pdf.test.ts`: "maps the bullet to WinAnsi 0x95 in the raw PDF stream, not a stray quote"
  (asserted byte-level on the raw PDF bytes); "counts the bullet-and-space width when wrapping, so
  a boundary item wraps to two lines" (a 40-word boundary case tuned against the Helvetica AFM
  widths in the file); "strips C1 control characters (U+0080-U+009F) from input text" (round-tripped
  through `@edmate/ingest`'s real `parsePdf`/pdf.js WinAnsi decoding, not a hand-rolled check).
- `notes.test.ts`: "pairs two questions answered close together with their own answer, not a swap"
  — two questions sharing one grouped-answer's exact timestamp and single teacher message, plus a
  third, separately-answered question with its own message and timestamp.
- `routes.test.ts`: "logs the error name (never its message) on the 500 path" — spies on
  `console.error`.

Full gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` → 34/34 tasks
green (includes `@edmate/db`, `@edmate/contracts`, `@edmate/ingest`, etc. as build deps).
`python3 .githooks/secret-scan.py --all` → clean.

## Decisions

### 22 Oct 2026 · 9.6g answeredPairs pairs by exact same-transaction timestamp, not packages/db · decided by builder · risk: low
- Decided: Fixed the question/answer pairing bug using only fields already in `ExportJson`
  (`teacherQuestions[].answeredAt`/`createdAt`, `messages[].createdAt`) by matching on exact
  timestamp equality first, instead of adding an id link. No `packages/db` or `packages/contracts`
  change was made.
- Why: `Message` has no `questionId` field and `TeacherQuestion` has no message-id field (checked
  `packages/contracts/src/turn.ts`); the db's `teacherQuestions.answer` text column exists but
  isn't selected by `listForStudent` and isn't in the contracts schema, so exposing it would need a
  `packages/contracts` schema change (ADR-gated) as well as a `packages/db` select change — out of
  scope for this task per the brief. Exact-timestamp matching is correct rather than approximate
  because `teacherQuestions.answer`'s single transaction writes both the question's `answeredAt`
  and the teacher message's `createdAt` from the same Postgres `now()`, so for any questions closed
  together they are identical, not merely close; this also correctly maps every such question to
  the one shared message a grouped answer produces, rather than only the first.
- risk: low — read-only pairing logic inside a student's own export; no new field is exposed,
  no schema changes.

### 22 Oct 2026 · 9.6g bullet width uses a fixed AFM constant, not a full table · decided by builder · risk: low
- Decided: Added one named constant (`BULLET_WIDTH = 350`, the standard Helvetica AFM value) for
  the bullet glyph's width instead of building out a full width table for the Latin-1 supplement
  range; documented `DEFAULT_WIDTH` as the deliberate fallback for the rest of that range (the
  brief's "or document the fallback" option).
- Why: the review's LOW finding and the brief treat the bullet (reachable from every `li` block)
  and the general Latin-1 fallback (reachable only for the accented/punctuation characters in that
  range, which the pilot's English-only content rarely uses) as separable in severity; the bullet's
  width is load-bearing for every bulleted line's wrap, so it gets an exact value, while the rest
  keeps the existing deliberate approximation, now documented inline.
- risk: low — wrapping accuracy only, never shown text or injection-relevant.

## Left to do

None (all five findings fixed, gate green, pushed).

Status: DONE

Tool calls used: 100 (harness count; the builder reported 58)
