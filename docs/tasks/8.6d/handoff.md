# Handoff: 8.6d Package builder page (Phase D of docs/tasks/8.6/plan.md)

Status: DONE

- Branch: `m8/8.6d-package-builder` (built on local branch `work-86d`)
- Worktree: `.claude/worktrees/agent-a525d44d17dfde937`

## Summary

`/teacher/packages`: one "new package" form (two presets, "Free starter" and "Full course") plus a
card per saved package showing its monthly AI-cost estimate. The form and cards fetch
`GET/POST/PUT /api/studio/packages` (8.6c) directly with `fetch`, and import `PACKAGE_LIMITS`,
`monthlyEstimate` and `costWarning` from `apps/web/src/studio/costEstimate.ts` (not duplicated).

- `PackagesView` (client): on mount, GETs the packages list, the teacher's modules, `setup`
  (whether a style card exists) and `perTurnMicroUsd`. No style card → "Set up your style card
  first" message with a link to `/teacher/style-card`, no form shown. Otherwise shows the package
  cards (each with `about $X a month per subscriber (up to $Y)`, the share-of-price line and a
  cost warning past 25%) and the create/edit form: module checkboxes from the GET `modules`,
  skill checkboxes (every offered skill, `study_plan` excluded, Q5), help ceiling, final answers,
  daily limit, live classes, price (shown in dollars, sent as `amountMinor`), a trial-days field
  hidden at price 0, locked reply. The live estimate and warning update as the daily limit or
  price change, before Save.
- Two presets fill the form (not an immediate POST): "Free starter" ($0, explain + practice, help
  ceiling 2, `finalAnswers: 'after_attempt'`, 10 messages/day, 0 live classes, `lockedReply:
  'name_package'`); "Full course" (every offered skill, ceiling 3, `finalAnswers: 'allowed'`, 20
  messages/day, 2 live classes, 7-day trial, `lockedReply: 'generic'`, price **$55**, not the
  plan's example $29 — see Decisions). Both default to every module the teacher has.
- Save POSTs (new package) or PUTs (editing an existing card, loaded via its "Edit" button) with
  the exact body the API expects (no `currency`, `trialDays` only sent when the price is above 0).
  Every fetch body-read and the saving flag are wrapped `try/catch/finally` (lessons.md: "A studio
  page that trusts a 200 response gets stuck").
- `page.tsx`: `requireRole(['teacher'])` only; no database read (the client fetches everything).
  `view.tsx` gains a "Packages" nav link next to the existing teacher links.

## Files

- `apps/web/app/teacher/packages/page.tsx` (new), `PackagesView.tsx` (new), `PackagesView.test.tsx`
  (new, 10 tests), `page.test.tsx` (new, 2 tests).
- `apps/web/app/teacher/view.tsx` + `view.test.tsx` (additive: one nav link + one test).
- `apps/web/messages/en.json` (additive: `teacher.packagesLink`, and a new top-level
  `packageBuilder` namespace — not `packages`, which is already the student compare page's
  namespace; see Decisions).
- Not edited: `apps/web/src/studio/packages*.ts`, `costEstimate.ts`, `apps/web/app/api/**`,
  `apps/web/src/auth/**`, `packages/**`.

## Tests

- `corepack pnpm --filter @edmate/web exec vitest run app/teacher/packages/PackagesView.test.tsx app/teacher/packages/page.test.tsx app/teacher/view.test.tsx` → 19 passed.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` → `Tasks: 34 successful, 34 total`.
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).
- `git diff origin/main -- packages/contracts` → empty.
- `git status --short` → only `apps/web/app/teacher/view.tsx`, `view.test.tsx`, `messages/en.json`
  modified, plus the new `apps/web/app/teacher/packages/` directory; nothing out of bounds touched.

## Decisions

### 22 Oct 2026 · 8.6d "Full course" preset price is $55, not the plan's example $29 · decided by builder · risk: low
- Decided: with the plan's provisional per-turn cost (21,000 micro-USD under the real B-42 Sonnet 5
  / Haiku 4.5 prices: 5,000/500 main tokens + 4×1,200/60 small tokens) and 20 messages/day, the
  maximum monthly estimate is $12.60. At $29/month that is 44% of the price — over the 25% warning
  at the preset's own defaults. At $55/month it is 23%. Kept the daily limit at 20 (higher than
  the free preset's 10, matching "full course" being the bigger package) and raised the price
  instead, per the lead's "Full course" answer ("Phase D sets the ... daily limit (or its price) so
  the at-most estimate stays under 25%, and logs the numbers as a decision").
- Why: the plan's own example numbers ($29, 20/day) would show the cost warning on a freshly
  created default package, which the lead's answer rules out.

### 22 Oct 2026 · 8.6d "Full course"'s unlisted fields: `finalAnswers: 'allowed'`, `lockedReply: 'generic'` · decided by builder · risk: low
- Decided: the plan's Phase D file list gives "Full course" its price, skills, ceiling, daily
  limit, live classes and trial, but not `finalAnswers` or `lockedReply` (only the free preset's
  are given). Picked `'allowed'` (a paid, full package trusts the student with final answers) and
  `'generic'` (a paid package's locked-reply message is less important than the free package's,
  which exists to upsell).
- Why: both fields are required by `PackageConfigSchema`; a default had to be chosen for the
  preset to be a valid package. The human can change either later; no behaviour depends on this
  pairing yet (publish is 8.7).

### 22 Oct 2026 · 8.6d en.json uses a new `packageBuilder` namespace, not `packages` · decided by builder · risk: low
- Decided: `apps/web/messages/en.json` already has a top-level `packages` key for the student's
  package-compare page (`app/packages/[agentId]/PackageCompare.tsx`, `useTranslations('packages')`).
  The plan's Phase D text ("a new top-level `packages` key") predates that collision. Used
  `packageBuilder` instead and left the existing `packages` namespace untouched.
- Why: reusing `packages` would either silently clash with the student page's existing keys or
  require renaming that page's namespace, which is out of this phase's files.

### 22 Oct 2026 · 8.6d No `packagesClient.ts`; `PackagesView.tsx` calls `fetch` directly · decided by builder · risk: low
- Decided: unlike `uploadClient.ts` (8.2) and `styleCardClient.ts` (8.4b), this phase's plan lists
  only `page.tsx`, `PackagesView.tsx`, and the two test files as files to create — no separate
  client module. Kept the `fetch` calls, body-shaping and error-code mapping inside
  `PackagesView.tsx` itself, importing `PackageView`/`PackageDraft` only as types (`import type`,
  erased at compile time, same pattern already used by `OnboardingForm.tsx` for `@edmate/db`).
- Why: follows "only the plan's Phase D files" literally; adding an extra file was not needed for
  the tests to pass.

## Left to do

- **Manual timed walkthrough** (acceptance table: two packages in under 15 minutes). Did not bring
  up the dev stack (no `docker-compose.yml` at the repo root to start Postgres/Redis quickly within
  the 10-call allowance the brief gives this step); no timestamps recorded. The lead should run it
  on the dev stack and paste start/end timestamps here.
- No CSS file was added for `/teacher/packages` (the plan's Phase D file list doesn't include one,
  unlike uploads/style-card's own `.css` files); the page renders with plain semantic HTML only.

Tool calls used: 55
