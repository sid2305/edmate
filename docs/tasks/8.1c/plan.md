
# 8.1c plan: Subject change resets verification (one phase)

Board: milestone M8 · id `8.1c` (deps `8.1a`, risky). The lead renamed this task from a duplicate
`8.1b`; `8.1b` is the separate M13 task "Teacher-verification follow-ups (8.1 reviews)".

Context: `docs/tasks/8.1a/plan.md`, `docs/tasks/8.1a/handoff.md` (onboarding form,
`/api/studio/profile`, `teacherProfilesRepo`).

## Acceptance (verbatim, `docs/board/tasks.yaml` id 8.1c, M8)
"a verified teacher who changes subject is pending again; a bio-only edit leaves verified;
covered by a db integration test."

Human answer B-30 (21 Oct 2026): `teacherProfiles.update` sets `verificationStatus` back to
`pending` when the subject changes, **in the same statement**; bio and languages edits keep it;
the onboarding form says a subject change needs re-verification.

### How it is shown (paste into handoff.md)
| Item | Evidence |
|---|---|
| A verified teacher who changes subject is pending again | `teacherProfilesRepo.update` in `packages/db/src/repositories/teacher-profiles.ts`: when the patch carries `subject`, the one `UPDATE ... SET subject = $1, verification_status = case when subject <> $1 then 'pending' else verification_status end` statement compares the row's old subject to the new one and resets status only on an actual change — no separate read-then-write, no race window. `teacher-profiles.int.test.ts`: verify a teacher, change subject, assert `verification_status` is `pending` on Postgres. |
| A bio-only edit leaves verified | The same statement's `CASE` only ever fires off the `subject` branch; bio/languages are plain `SET` columns, never touching `verification_status`. `teacher-profiles.int.test.ts`: verify a teacher, update only bio (and separately only languages), assert status is still `verified`. |
| A same-value subject edit leaves verified | The `<>` comparison is false when the submitted subject equals the stored one, so re-submitting the same subject is not a "change". `teacher-profiles.int.test.ts`: verify a teacher, `update(A, { subject: <same value> })`, assert status is still `verified`. |
| The onboarding form says a subject change needs re-verification | `OnboardingForm.tsx` shows a hint under the subject field, in edit mode only, reading the fixed English text ("Changing your subject sends your profile back for re-verification."). `OnboardingForm.test.tsx`: the hint is present in edit mode and absent in create mode. |
| No contracts, no auth-file change | `git diff origin/main --stat -- packages/contracts apps/web/src/auth` is empty; only the repo method, its tests and one onboarding-form string change. |

## Design

### `packages/db/src/repositories/teacher-profiles.ts` — `update`
Replace the current `.set({...})` object literal so that, only when `p.subject !== undefined`,
`subject` and `verificationStatus` are set together:

```ts
import { sql } from 'drizzle-orm';
// ...
.set({
  ...(p.subject === undefined
    ? {}
    : {
        subject: p.subject,
        verificationStatus: sql`case when ${teacherProfiles.subject} <> ${p.subject}
          then 'pending'::teacher_verification_status
          else ${teacherProfiles.verificationStatus} end`,
      }),
  ...(p.bio === undefined ? {} : { bio: p.bio }),
  ...(p.languages === undefined ? {} : { languages: p.languages }),
})
```
One `UPDATE ... WHERE user_id = $teacherId RETURNING ...` statement, as today — the `CASE`
reads the row's pre-update `subject`/`verification_status` under the same row lock Postgres
already takes for the `UPDATE`, so there is no separate read step and no window for a concurrent
`setVerification` or another `update` to race between a read and a write (this is what "in the
same statement" buys, and what M13 task 8.1b separately flags as a general
`update`/`setVerification` hardening item — out of scope here, that is a different task id
entirely ).
No change to `UpdateInput`, `CreateInput`, column list, `translateWrite` or any other method.
No new error kind: `not_found` (no row) and `invalid` (bad patch) are unchanged, both still
checked before this statement runs.

### `apps/web/app/teacher/onboarding/OnboardingForm.tsx`
Add one hint, shown only when `profile` is truthy (edit mode — a brand-new profile has no prior
verification to reset), under the subject field:
```tsx
<label htmlFor="onboarding-subject">{t('subjectLabel')}</label>
<input
  id="onboarding-subject"
  value={subject}
  aria-describedby={profile ? 'onboarding-subject-hint' : undefined}
  onChange={(e) => setSubject(e.target.value)}
/>
{profile ? <span id="onboarding-subject-hint">{t('subjectHint')}</span> : null}
```

### `apps/web/messages/en.json`
Add one key to the existing `onboarding` namespace: `"subjectHint": "Changing your subject sends
your profile back for re-verification."` (same plain-English, one-line convention as `slugHint`/
`languagesHint`).

## Files
- **Modify:** `packages/db/src/repositories/teacher-profiles.ts` (the `update` method only),
  `packages/db/test/teacher-profiles.int.test.ts` (new cases, see Tests below),
  `apps/web/app/teacher/onboarding/OnboardingForm.tsx`,
  `apps/web/app/teacher/onboarding/OnboardingForm.test.tsx`,
  `apps/web/messages/en.json`.
- **Not touched:** `packages/db/src/repositories/teacher-profiles.test.ts` (the pure-input-check
  suite — no new input shape, so no new case needed there, though the builder may add one
  confirming a patch carrying only `subject` still passes the existing strict-object checks if it
  helps the diff read cleanly; not required), `apps/web/src/studio/profile.ts` and its tests (the
  route forwards the patch as-is already; no route change), `packages/contracts/**`,
  `packages/db/src/schema/**` (no new column, no migration — `verification_status` already has
  `pending` as a value and a default).
- **Tests first:** add the three `teacher-profiles.int.test.ts` cases (subject change resets a
  verified teacher to pending; bio-only and languages-only edits leave `verified`; a same-value
  subject edit leaves `verified`) before touching `teacher-profiles.ts`'s `update`; add the two
  `OnboardingForm.test.tsx` cases (hint shown in edit mode, absent in create mode) before the
  `OnboardingForm.tsx` edit.
- **Size:** 2 source files + 2 test files + 1 messages file = 5 files, well under the ~50-call
  budget for this task and the ~150-call default — one phase.

## Files out of bounds
- `packages/contracts/**`, `apps/web/src/auth/**`, `apps/web/src/studio/profile.ts`, the
  `/api/studio/profile` route, `packages/db/src/schema/**`, any migration file — none needed; this
  is a pure repository-logic + UI-copy change.
- `teacherProfiles.setVerification` and the publish guard
  (`assertVerifiedForPublish`) — unchanged; B-30 only names `update`.
- The separate board task `8.1b` (M13, "Teacher-verification follow-ups") and everything
  it lists (publish-guard transaction timing, `setVerification`'s own `translateWrite` use,
  verify/grant-role CLI `--user-id`, the 0016 cast note) — a different task; not touched here.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/db/src/repositories/**` → **reviewers: security-reviewer** (this task edits
  `packages/db/src/repositories/teacher-profiles.ts`). The board already marks this task
  `risk: risky`, matching the glob's own group.
- No other glob matches: `apps/web/app/teacher/onboarding/OnboardingForm.tsx` and
  `apps/web/messages/en.json` are plain UI/copy, not under `apps/web/src/auth/**` or any other
  risky prefix.
- A `risk: high` decision is required in the handoff's `## Decisions` (per the merge-gate rule for
  any risky-path PR), logging this change and naming `security-reviewer` as having reviewed it.

## Open questions
None blocking. One small builder-discretion note: whether to also add a defensive
`teacher-profiles.test.ts` (pure, no-db) case asserting a patch of `{ subject: 'X' }` alone still
parses as `invalid`-free input — optional, named above, does not change acceptance evidence.

## Status
READY.
