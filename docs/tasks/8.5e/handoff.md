# Task 8.5e handoff: teacher test-chat page (8.5 Phase C)

Status: DONE
Tool calls used: 46

- Branch: `m8/8.5e-test-chat-ui` (built on local branch `work-85e`)
- Worktree: `.claude/worktrees/agent-ab86a684e39c08223`
- Plan: `docs/tasks/8.5/plan.md`, Phase C (and its lead answers). Only `apps/web` changed. No edits to
  `src/auth/**`, `src/chat/**`, `src/turn/**`, `src/studio/{index,routes,runtime,profile,files}.ts`,
  `src/studio/packages*.ts`, `costEstimate.ts`, `src/studio/questions/**` or `app/api/**`.
  `messages/en.json` is additive only (one new top-level `testChat` key).

## Summary

`/teacher/test-chat/[agentId]` lets a teacher pick one of their agent's packages (drafts too),
chat with the agent as a student on it would, mark a finished reply wrong and save a correction.
The correction form is inline under the reply: a module picker (the teacher's outline modules), the
student's question (pre-filled, editable), the agent's answer (shown read-only, sent as
`badAnswer`) and the correct answer. Saving POSTs `{ moduleId, question, badAnswer,
correctedAnswer }` to `/api/studio/corrections` and shows "Correction saved" with no reload.

The chat reuses the student chat's `reduceTurn`/`initialTurn`, `MessageBubble`, `Composer`,
`SourcesList`, `HintButton` and notices through read-only imports, so provisional text, `replace`,
fixed error text and retry behave as in the student chat. Switching package aborts the turn, clears
the thread and starts a new preview session on the next send.

Every async action settles (lessons: "a studio page that trusts a 200"): the clients check
`res.ok` and the body shape with zod and return an error code on a network failure, a non-2xx or a
malformed 2xx; the view also catches a thrown start or save; the form's busy flag is cleared in
`finally`, so "Saving…" never sticks.

### Manual walk-through
1. Open `/teacher/test-chat/<agentId>` as the agent's teacher. With no previewable package the page
   says "This agent has no package to test yet…" (no chat, no link).
2. Pick a package in "Package" (the first is preselected).
3. Type a question and press Enter: `POST /api/studio/agents/<agentId>/test-sessions {packageId}`,
   then `POST /api/studio/test-sessions/<id>/turns` (SSE); the reply streams in as provisional.
4. When the reply is done, click "Mark wrong" under it: the form opens with the question and the
   agent's answer filled in.
5. Choose the module, type the correct answer, click "Save correction":
   `POST /api/studio/corrections`. On 201 the form closes and "Correction saved…" shows; on an
   error the form stays open with a fixed error line.
6. The next similar question is answered from the new teacher note: proven at the repository layer
   by Phase A's `corrections.int.test.ts` (plan open question 3, lead-agreed), not re-proven here.

## Files

- `apps/web/app/teacher/test-chat/[agentId]/page.tsx` (new) — teacher guard, `loadTestChat`,
  empty state, `TestChatView` under a provider with only the `chat` and `testChat` strings.
- `apps/web/app/teacher/test-chat/[agentId]/page.test.tsx` (new)
- `apps/web/src/studio/testChat/loadTestChat.ts` (+ `.test.ts`) (new) — guard first, own agent
  (any status) else not found, packages via `packageVersions.listForAgent`, modules via
  `outline.getOutline` (id + title).
- `apps/web/src/studio/testChat/sendTestTurn.ts` (+ `.test.ts`) (new) — `startTestSession`,
  `sendTestTurn` (reuses `readTurnStream`/`responseError`), `submitCorrection`.
- `apps/web/src/studio/testChat/TestChatView.tsx` (+ `.test.tsx`) (new)
- `apps/web/messages/en.json` — new `testChat` namespace only.

## Tests

`corepack pnpm vitest run src/studio/testChat app/teacher/test-chat` (apps/web):

```
Tests  76 passed (76)
sendTestTurn.ts  |   97.36 |    93.75 |   88.88 |     100 |
```

New: 12 client tests (route URL and payload per call; non-2xx, network failure, non-JSON 200 and
wrong-shape 200 each settle to an error), 8 load tests (guard first, malformed id and another
teacher's agent not found before reads), 18 view tests (start on the picked package, session reuse,
"Mark wrong" only on finished replies, the exact correction payload incl. trimming and an edited
question, an earlier reply keeps its own question/answer, validation/not_found/provider_error and a
thrown save each show an error with the button usable again, "Saving…" while in flight, cancel,
no-modules state, package switch aborts and ignores late items, start failure with retry, thrown
start, hint turn, axe), 4 page tests.

`corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`:

```
@edmate/web:test:  Test Files  72 passed | 1 skipped (73)
@edmate/web:test:       Tests  1050 passed | 4 skipped (1054)
 Tasks:    34 successful, 34 total
```

`python3 .githooks/secret-scan.py --all`: clean.

## Deviations

- The empty state ("no package to test") is rendered by the page, not the view, so the view always
  has at least one package.
- The form's module picker uses the teacher's outline modules (`outline.getOutline`, id and title):
  the plan named a "module select" but no source; `modules.ids` has no titles.
- `HintButton`, `SkillCard`, `LockedNotice` and `TeacherQuestionNotice` are also read-only imports
  from `src/chat`, so a preview shows what a student would see.
- No new CSS file: the page imports the student `chat.css`; the form's own classes are unstyled
  for now.
- `TestChatView.test.tsx` uses a 20 s per-test timeout: in the full parallel turbo run two of its
  heavier jsdom tests (and unrelated existing ones) passed the 5 s default; alone they take 1-3 s.

## Decisions
### 22 Oct 2026 · 8.5e the correction form picks from the teacher's outline modules · decided by builder · risk: low
- Decided: the page loads the modules for the correction form with `outline.getOutline` in the teacher's scope (id and title); with no outline the form says to add a module first and cannot be saved.
- Why: the plan asked for a module select without naming a source; `modules.ids` gives ids only, and the outline is the teacher's own module list with titles (one course per teacher in the MVP).
- risk: low

### 22 Oct 2026 · 8.5e the question in the correction form is editable · decided by builder · risk: low
- Decided: the question is pre-filled with the preceding student message but the teacher may edit it; the agent's answer is shown read-only and sent unchanged as `badAnswer`.
- Why: a hint request's shown text ("Can I have a hint?") is a poor question for a teacher note; the bad answer must stay what the agent actually said.
- risk: low

## Left to do

- Nothing for Phase C. 8.5b's deferred findings stay with 8.5d. A nav link into the page waits for
  8.3/8.6 (plan open question 1). The form has no dedicated styles yet.
