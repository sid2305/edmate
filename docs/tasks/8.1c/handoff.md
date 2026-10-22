# 8.1c handoff: a subject change resets teacher verification

Status: DONE
Branch: `m8/8.1c-subject-reverify`
Worktree: `.claude/worktrees/agent-a762078b8bb2e9422`
Tool calls used: 24

## Summary
`teacherProfiles.update` now sends a profile back to `pending` when the subject actually changes,
in the same `UPDATE` statement (`verification_status = case when subject <> $new then 'pending'
else verification_status end`). Postgres evaluates every `SET` expression against the pre-update
row under the row lock the `UPDATE` takes, so there is no read-then-write window and no new lock
(no lock-order change against `setVerification`). Bio and languages edits never touch the status;
re-submitting the stored subject (also after the schema's trim) is not a change. The onboarding
form shows "Changing your subject sends your profile back for re-verification." under the subject
field in edit mode only, linked by `aria-describedby`.

## Files
- `packages/db/src/repositories/teacher-profiles.ts` (the `update` method and its doc comment; `sql` import)
- `packages/db/test/teacher-profiles.int.test.ts` (new `update: a subject change resets verification` block)
- `apps/web/app/teacher/onboarding/OnboardingForm.tsx` (hint + `aria-describedby`)
- `apps/web/app/teacher/onboarding/OnboardingForm.test.tsx` (hint in edit mode, absent in create mode)
- `apps/web/messages/en.json` (one key: `onboarding.subjectHint`)

## Tests
Written first and seen failing (3 reset cases red before the repository change; the edit-mode
hint case red before the form change).
- `TEST_DATABASE_URL=<own container> corepack pnpm vitest run test/teacher-profiles.int.test.ts`
  (packages/db) → before: `Tests 3 failed | 30 passed (33)`; after: `Tests 33 passed (33)`.
  Cases: verified → subject change → `pending` (other teacher stays `verified`, publish guard now
  refuses); subject + bio → `pending`; rejected → subject change → `pending`; pending stays
  pending; bio-only, languages-only, same subject, same subject with spaces, same subject + bio →
  still `verified` and the publish guard still passes.
- `corepack pnpm vitest run app/teacher/onboarding/OnboardingForm.test.tsx` (apps/web) →
  `Tests 15 passed (15)`.
- Full gate: GATE_RESULT

### How it is shown
| Item | Evidence |
|---|---|
| A verified teacher who changes subject is pending again | `teacherProfilesRepo.update` in `packages/db/src/repositories/teacher-profiles.ts`: when the patch carries `subject`, the one `UPDATE ... SET subject = $1, verification_status = case when subject <> $1 then 'pending' else verification_status end` statement compares the row's old subject to the new one and resets status only on an actual change — no separate read-then-write, no race window. `teacher-profiles.int.test.ts`: verify a teacher, change subject, assert `verification_status` is `pending` on Postgres. |
| A bio-only edit leaves verified | The same statement's `CASE` only ever fires off the `subject` branch; bio/languages are plain `SET` columns, never touching `verification_status`. `teacher-profiles.int.test.ts`: verify a teacher, update only bio (and separately only languages), assert status is still `verified`. |
| A same-value subject edit leaves verified | The `<>` comparison is false when the submitted subject equals the stored one, so re-submitting the same subject is not a "change". `teacher-profiles.int.test.ts`: verify a teacher, `update(A, { subject: <same value> })`, assert status is still `verified`. |
| The onboarding form says a subject change needs re-verification | `OnboardingForm.tsx` shows a hint under the subject field, in edit mode only, reading the fixed English text ("Changing your subject sends your profile back for re-verification."). `OnboardingForm.test.tsx`: the hint is present in edit mode and absent in create mode. |
| No contracts, no auth-file change | `git diff origin/main --stat -- packages/contracts apps/web/src/auth` is empty; only the repo method, its tests and one onboarding-form string change. |

## Deviations
None from the plan. Extra int cases beyond the plan's three (subject + bio, rejected, pending,
same subject with spaces) pin the edges of the rule.

## Decisions

### 22 Oct 2026 · 8.1c Subject change resets verification in the same UPDATE · decided by builder · risk: high
- Decided: `teacherProfiles.update` sets `verification_status` to `pending` inside the same `UPDATE` as the subject change, via a `CASE` on the row's old subject; no extra read, no new lock, so the repository's lock order is unchanged. Touches the risky path `packages/db/src/repositories/**`; reviewer: security-reviewer.
- Why: human answer B-30; a single statement leaves no window for a concurrent `setVerification` to be overwritten or skipped.
- risk: high

### 22 Oct 2026 · 8.1c A rejected teacher who changes subject returns to pending · decided by builder · risk: medium
- Decided: the `CASE` resets any status (not only `verified`) to `pending` on a real subject change, so a rejected teacher who changes subject re-enters the staff queue.
- Why: matches the plan's statement as written; a new subject is a new claim staff should look at, and `pending` grants nothing (the publish guard still refuses). If the human prefers rejected to stick, it is a one-word change to the `CASE`.
- risk: medium

### 22 Oct 2026 · 8.1c "Same subject" means equal after the schema's trim, case-sensitive · decided by builder · risk: low
- Decided: the comparison runs on the zod-trimmed input with SQL `<>`, so "  Maths  " equals "Maths" but "maths" counts as a change.
- Why: the stored value is already trimmed; case-folding would be a new rule the spec didn't make, and erring towards re-verification is the safe side.
- risk: low

## Left to do
None for this task. The broader `update`/`setVerification` hardening stays with M13 task 8.1b.
