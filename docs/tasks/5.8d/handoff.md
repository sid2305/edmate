# Task 5.8d handoff

**Status:** DONE

## What changed

Picked up the stalled builder's committed WIP (`apps/cli/src/commands/eval/liveAgent.ts` and
its test file already carried the full design from the plan: `startPayloadFor`, the
`Map<string, ChatSetup>` cache keyed by `caseId`, and the new `describe('persona role-play
cases (task 5.8d)', ...)` block with its five new tests). Two things were still broken:

1. **Typecheck**: the end-to-end test's stub judge `generateObject` returned a concrete object
   literal where `ModelGateway.generateObject<T>` needs a `Promise<T>`. Fixed by making the stub
   itself generic: `generateObject: <T>() => Promise.resolve({ pass: true, reason: 'stub' } as T)`.
2. **Test 2 and (silently) 1/3 relied on a reply text that tripped the grounding guard**: the
   file's default `scriptedChatGateway` reply (`'A variable stores a value ... [1]'`) carries a
   `[1]` citation, but a role-play turn retrieves no grounding material, so the post-guard's
   grounding check found no source to back the citation and rewrote the reply to the "not
   covered" safe fallback. `pipeline/runner.ts`'s commit step (`post.modelReply ? decided.next :
   withPersonaCount(decided.next, built.helpState)`) then correctly treats a guard-replaced reply
   as one the student never really saw from the model, so it keeps the *loaded* persona count
   instead of the one `skillStep` had just decided — the question count silently never advanced.
   This is intended production behaviour (the comment names it explicitly), not a bug in
   `liveAgent.ts`: the bug was the test's choice of reply text. Fixed by giving the three
   persona tests that make a live call (tests 1-3; test 4 throws before any gateway call; test 5
   already used a citation-free reply) a shared `ROLEPLAY_REPLY = 'Here is your next question.'`
   constant with no `[1]` marker, matching what test 5 and `chat/roleplay.integration.test.ts`
   already do.

No production code changed beyond what the stalled builder had already committed; the fix stayed
inside the test file, as the plan's exit conditions require ("a change seems needed outside the
two files" did not apply — both touched files were already in scope).

## Evidence

Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/cli --force`
→ `Tasks: 8 successful, 8 total`, `Test Files 13 passed (13)`, `Tests 148 passed (148)`, no
skips (`TEST_DATABASE_URL`/`TEST_REDIS_URL` exported so no test file skipped).

New tests, all in `apps/cli/src/commands/eval/liveAgent.test.ts`, `describe('persona role-play
cases (task 5.8d)', ...)`:
- `turn 0 sends a skill_action start carrying only the bare persona id`
- `a later call for the same caseId continues the count (the session is reused)`
- `a different caseId gets its own fresh session`
- `a malformed persona ref throws instead of silently sending a plain message`
- `one real persona case runs end to end through runSuite with failed: 0`

`python3 .githooks/secret-scan.py --all` → clean (no output).

`git diff origin/main --stat` (before merging main in) touches only
`apps/cli/src/commands/eval/liveAgent.ts` and `apps/cli/src/commands/eval/liveAgent.test.ts`
(the wider diff seen before merging main in was main having moved ahead on unrelated tasks, not
this task's own changes).

## Decisions

### 24 Oct 2026 · 5.8d persona-test reply text must carry no spurious citation · decided by builder · risk: low
- Decided: use a citation-free scripted reply (`'Here is your next question.'`) for the three
  live persona tests (1-3) instead of the file's default reply, which carries a `[1]` citation.
- Why: a role-play turn has no retrieved sources, so a reply citing `[1]` has nothing to back it;
  the grounding guard rewrites it to a safe fallback, and the runner then (correctly, by design)
  keeps the loaded persona count rather than the one just decided, since the student never saw
  the model's own reply. That's working as the pipeline intends — the test's own reply choice was
  the bug, not `liveAgent.ts` or anything in `packages/harness`.

## Budget

Tool calls used: 32
