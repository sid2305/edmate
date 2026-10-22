# 9.5b handoff: feedback submission and mock-interview screens

## Summary

Finished the work left by an earlier builder cut off by the usage limit (WIP commit
`2287846`, not gated): reviewed it against the plan, confirmed CSS and the e2e cases were
already present in that commit, ran the gate, merged `origin/main`, and re-ran the gate clean.
No code changes were needed beyond what the WIP commit already contained.

- `apps/web/src/chat/SkillLauncher.tsx`: added a "Get feedback" toggle (`feedbackActive`,
  `onToggleFeedback`, `aria-pressed`) and a mock-interview persona picker (`onStartMockInterview`,
  hardcoded `job-interview`/`viva` buttons, Q1).
- `apps/web/src/chat/MockInterviewControls.tsx` (new): Pause/Stop buttons, rendered only while
  `activeSkill === 'mock_interview'`; send ordinary `message` turns with literal text `/pause`
  and `stop`.
- `apps/web/src/chat/ChatView.tsx`: added `feedbackPending` (one-shot, cleared after the next
  Composer send, never persisted as `activeSkill`); widened `activeSkill`'s reset effect so
  `mock_interview` (which never emits a `skill` TurnEvent, Q2) survives a turn with no skill
  cards and is cleared only by `stopMockInterview`; `submit`'s carry-along rule now also tags a
  plain `message` with `skill: 'mock_interview'` while that skill is active (practice/feedback
  still never carry onto a plain message); `sendMessage` wraps the Composer's `onSend` to apply
  the feedback tag and clear it.
- `apps/web/src/chat/chat.css`: styles for the launcher row, the `aria-pressed` feedback toggle,
  the persona-picker row and the pause/stop controls row (mobile-first, no new framework).
- `apps/web/messages/en.json`: added `chat.feedback.toggle`, `chat.mockInterview.{launcher,
  personas.job-interview, personas.viva, start, pause, stop}` (additive only).
- `apps/web/e2e/skills.spec.ts`: extended with the feedback case (toggle, submit, verdict text
  renders) and the mock-interview case (persona pick, an answer, `/pause`, `stop`, plus the
  existing locked-notice case for an unentitled persona).

## Files

- Modified: `apps/web/src/chat/SkillLauncher.tsx` (+ test), `apps/web/src/chat/ChatView.tsx`
  (+ test), `apps/web/src/chat/chat.css`, `apps/web/messages/en.json`,
  `apps/web/e2e/skills.spec.ts`.
- Created: `apps/web/src/chat/MockInterviewControls.tsx` (+ test).

## Tests

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` -> 34/34 tasks
  successful; web suite green (practice/feedback/mock-interview specs all pass, `jest-axe` zero
  violations on the new controls per `ChatView.test.tsx`).
- `python3 .githooks/secret-scan.py --all` -> clean, no output.
- `apps/web/e2e/skills.spec.ts` was extended per the plan (feedback case; persona pick, answer,
  `/pause`, `stop`; unentitled-persona locked case) but **not run**: no Postgres is listening on
  the compose port this suite needs (`TEST_DATABASE_URL`, `127.0.0.1:55432`) in this worktree,
  same gap 9.5a reported. For the lead to run against the compose stack:
  `docker compose -f docker-compose.test.yml up -d && corepack pnpm --filter @edmate/web exec
  playwright test e2e/skills.spec.ts`.

## Decisions

### 22 Oct 2026 · 9.5b Mock interview carries onto a plain Composer message; feedback and practice never do · decided by builder · risk: low
- Decided: `submit`'s carry-along rule tags a plain `message` turn with `skill: 'mock_interview'`
  while that skill is active (an interview answer is typed in the ordinary Composer, per the
  plan — there is no dedicated answer form), but a plain message never carries `practice` or
  `feedback` along. `activeSkill`'s reset effect keeps `mock_interview` across a turn with no
  skill cards (since it never emits one, Q2) and only `stopMockInterview` clears it.
- Why: matches the plan's stated shape exactly (practice/feedback have their own trigger per
  turn; mock interview's answer is an ordinary typed message) without reusing the 9.5a bug this
  task's own lessons.md entry warns about — this keeps the same "every state that tags outgoing
  turns has a stated reset point, with a test for the turn after it" rule, just with a different
  reset trigger (Stop, not the next plain message) because mock interview's whole point is that
  typing stays in-skill until the student presses Stop.
- risk: low

### 22 Oct 2026 · 9.5b Reused the WIP commit from the cut-off builder as-is · decided by builder · risk: low
- Decided: reviewed the uncommitted WIP commit (`2287846`) line-by-line against the Phase B plan
  and the 9.5a review's two HIGHs before accepting it; made no further code changes since it
  already matched the plan (feedback one-shot tag, mock-interview carry/reset, CSS, and the
  e2e cases were all present) and passed the full gate on the first run.
- Why: avoids throwing away correct work just because the prior builder was cut off mid-note;
  the gate (typecheck/lint/test, secret scan) is the objective check, and it was green before
  and after the `origin/main` merge.
- risk: low

## Left to do

- Run `apps/web/e2e/skills.spec.ts` against the compose Postgres stack (command above) — the
  lead or a follow-up session with that stack available should confirm the three e2e cases pass.

Status: DONE
Tool calls used: 15
