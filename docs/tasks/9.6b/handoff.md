# 9.6b handoff -- the progress page, complete JSON export and notes PDF

## Summary

Phase B of 9.6 (apps/web only): the student's progress page, the complete JSON export, and a
text-only notes PDF, both reachable from that page. All reads are scoped to the signed-in student
and one teacher, never to a client-given id. The export never includes `help_state`, teacher-only
fields, answer keys or another student's data -- it is built by reading only the allow-listed
repositories (`sessions.listForStudent`, `messages.listForStudent`, `learnerProfiles.get`,
`evidenceEvents.list`, `teacherQuestions.listForStudent`, `subscriptions.findLive`,
`packageVersions.getById`, `outline.getOutline`), never a bigger read filtered after the fact.

- `buildProgress()` turns the teacher's outline plus the student's BKT mastery map into per-module,
  per-topic states (`mastered` at p >= 0.95, else `practising` or `not_started`), counts and a
  capped, package-scoped next-steps list.
- `renderPdf()` is a from-scratch, dependency-free PDF 1.4 writer (standard Helvetica/Helvetica-Bold,
  WinAnsi, uncompressed streams); round-trips through `@edmate/ingest`'s real `parsePdf` in tests
  and resists PDF-literal injection.
- `notesDocument()` turns the export JSON into the PDF's blocks: progress, next steps, session
  summaries (newest first), answered teacher questions, and mistakes to watch.
- `buildExport()` pages both readers to completion (hard ceiling, never a silent truncation) and
  assembles the one JSON document; `complete: false` plus a named `truncated` section when evidence
  or teacher-questions hit their own read caps.
- Two new routes, `GET /api/me/export/:agentId` (JSON) and `GET /api/me/export/:agentId/notes`
  (PDF), both `withRole(['student'], ...)`, both keyed by `studentTurnScope` (never a client-given
  studentId/teacherId). Covered by the existing `/api/me/**` GET policy row.
- `/learn/[agentId]/progress`: same deliberate exception as the memory page -- default clearance
  (`age`, not `agent`), so a student waiting on a parent's consent can still see progress and
  download both exports. A non-live agent still gives `notFound`.

## Files

- `apps/web/src/progress/progress.ts`, `progress.test.ts` -- `buildProgress`, `Progress` types.
- `apps/web/src/progress/ProgressView.tsx`, `ProgressView.test.tsx` -- the view, incl. axe check.
- `apps/web/app/learn/[agentId]/progress/page.tsx`, `page.test.tsx` -- the server page.
- `apps/web/src/export/pdf.ts`, `pdf.test.ts` -- the PDF 1.4 writer.
- `apps/web/src/export/notes.ts`, `notes.test.ts` -- export JSON -> PDF blocks.
- `apps/web/src/export/buildExport.ts`, `buildExport.test.ts` -- the scoped, paginated export.
- `apps/web/src/export/routes.ts`, `routes.test.ts` -- the two route handlers.
- `apps/web/app/api/me/export/[agentId]/route.ts`, `.../notes/route.ts` -- Next.js wiring.
- `apps/web/app/learn/[agentId]/page.tsx` -- added the Progress nav link.
- `apps/web/messages/en.json` -- added the `progress` namespace (see Decisions).
- `apps/web/src/chat/clearance-scan.test.ts` -- added the progress page to the one deliberate
  default-clearance exception list (see Decisions).

## Tests

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` -- green (34/34 tasks).
  Full suite: 102 test files passed, 1 skipped (no local Redis, pre-existing), 1371 tests passed,
  4 skipped.
- New test files: `progress.test.ts` (9), `ProgressView.test.tsx` (4), `progress/page.test.tsx` (5),
  `pdf.test.ts` (8), `notes.test.ts` (3), `buildExport.test.ts` (8), `export/routes.test.ts` (7).
  Includes a do-not-leak regex scan over the full serialized export JSON (not just field checks)
  for `help_state`, `helpState`, `mustNotReveal`, `answerKey`.
- `python3 .githooks/secret-scan.py --all` -- clean.

## Decisions

### 22 Oct 2026 · 9.6b answered-question pairing in the notes PDF · decided by builder · risk: low
- Decided: `notesDocument()` pairs each `answered` `TeacherQuestion` with the next unused
  `role: 'teacher'` chat message whose `createdAt` is on or after the question's `answeredAt`
  (falling back to `createdAt`), in chronological order of both lists.
- Why: `TeacherQuestion` (packages/contracts) has no `answer` field -- the teacher's answer text is
  only ever written as a chat message into whichever session happens to be open at answer-time.
  This heuristic is the closest available approximation given the current schema; it can mis-pair
  in pathological message timing but never leaks another student's or another question's data,
  since it only ever reads from this one student's own messages.
- risk: low

### 22 Oct 2026 · 9.6b en.json namespace · decided by builder · risk: low
- Decided: only a `progress` namespace was added to `apps/web/messages/en.json`, not a separate
  `export` namespace.
- Why: every string this phase needed (including the two export link labels) fit naturally under
  `progress`; adding an empty or redundant `export` namespace would have been dead weight. No other
  builder's lines were touched; `git merge origin/main` was clean (fast-forward, no conflicts).
- risk: low

### 22 Oct 2026 · 9.6b clearance-scan exception · decided by builder · risk: low
- Decided: added `/learn/[agentId]/progress/page.tsx` to `clearance-scan.test.ts`'s one deliberate
  default-clearance exception list, alongside the existing memory page.
- Why: the progress page intentionally asks for the default clearance (`age`, not `agent`) for the
  same reason the memory page does -- it is the student's own view and exports, not the chat itself,
  and should stay reachable while a parent's consent is outstanding. Without this the pre-existing
  scan test (not part of Phase B's own file list, but a shared guard over all of `app/learn/**`)
  would fail on a correct, intended page.
- risk: low

### 22 Oct 2026 · 9.6b the handoff was recovered from the builder's transcript · decided by lead · risk: low
- Decided: the builder wrote this handoff but never committed it, and the lead removed its worktree before checking. The lead rebuilt the file word for word from the builder's own Write and Edit calls in its transcript and committed it; only the tool-call line changed, to the harness count.
- Why: the builder could not be resumed once its worktree was gone, and its decisions must reach the log as written. From now on the lead checks `git status` in a builder's worktree before removing it, and briefs ask builders to confirm a clean tree before returning.
- risk: low

## Left to do

Nothing outstanding in Phase B's scope.

Status: DONE

Tool calls used: 152 (harness count; the builder reported ~115)
