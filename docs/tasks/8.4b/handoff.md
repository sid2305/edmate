# Handoff: 8.4b Style card studio page (Phase B of docs/tasks/8.4/plan.md)

Status: DONE

- Branch: `m8/8.4b-style-card-page` (built on local branch `work-84b`)
- Worktree: `.claude/worktrees/agent-aebf94b022ac8d43e`
- Tool calls used: 32

## What changed
- `apps/web/src/studio/styleCardClient.ts` (+ test): `getStyleCard`, `draftStyleCardApi`,
  `saveStyleCard` fetch wrappers over the 8.4a API, mirroring `uploadClient.ts`'s `ApiResult<T>`
  shape. No node imports; types (`StyleCardView`, `StyleCardDraft`, `StyleCardInterview`) are
  defined locally rather than imported from `@edmate/contracts`, same pattern as `DocumentView`.
- `apps/web/app/teacher/style-card/page.tsx` (+ test) — server component: `requireRole(['teacher'])`,
  reads the current card via `serverDatabase().repos.styleCards.latest(...)` for first paint, its
  own local `nav` array (teacher / uploads / onboarding / style card), `NextIntlClientProvider`
  scoped to the `styleCard` namespace.
- `apps/web/app/teacher/style-card/StyleCardView.tsx` (+ test) — client component: the 10-question
  interview (from `STYLE_CARD_QUESTIONS`), a newline-separated "common mistakes" textarea, 3
  sample-explanation textareas, "Generate draft" (fills an editable text box + a comma-separated
  tags field), "Save" (writes whatever is currently in the text/tags fields — this is also the
  direct-edit path with no interview), and an error banner keyed by the API's error code.
- `apps/web/app/teacher/style-card/style-card.css` — own scoped stylesheet, mirrors `uploads.css`
  (mobile-first, 44px touch targets).
- `apps/web/messages/en.json` — new `styleCard` namespace (interview question copy keyed by the
  fixed slugs, field labels, draft/save buttons, error strings) and `teacher.styleCardLink`.
- `apps/web/app/teacher/view.tsx` (+ test) — added the "Teaching style" link to the teacher home
  nav, next to uploads/onboarding.

No shared layout/nav file exists under `apps/web/app/teacher/**` on `main` (checked before
starting, per the plan's exit condition); each page still builds its own `nav` array.

## Evidence
- `corepack pnpm --filter @edmate/web exec vitest run app/teacher app/teacher/style-card
  src/studio/styleCardClient.test.ts` → all green (see full run below).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` → `Tasks: 34 successful,
  34 total`. Coverage includes the new files (`styleCardClient.ts` 100% lines, `StyleCardView`/
  `page.tsx` covered through their test files); no threshold failure.
- `python3 .githooks/secret-scan.py --all` → clean (no output).

## Deviations from the plan
- None. `StyleCardView` combines the interview and the direct-edit path into one page as the plan
  describes: "Generate draft" only ever fills the same text/tags fields that "Save" reads, so a
  teacher can also skip the interview and fix the saved card directly.

## Decisions
### 22 Oct 2026 · 8.4b Style card client types stay local, not imported from contracts · decided by builder · risk: low
- Decided: `styleCardClient.ts` defines its own `StyleCardView`/`StyleCardDraft` types instead of
  importing `StyleCard` from `@edmate/contracts`, matching `uploadClient.ts`'s `DocumentView`.
- Why: no existing `'use client'` file in `apps/web` imports `@edmate/contracts`; keeping the
  client file's only dependency on its own small types keeps the pattern consistent and avoids
  pulling the contracts package into the browser bundle for no benefit.
- risk: low

### 22 Oct 2026 · 8.4b One edit surface serves both the drafted and the directly-edited card · decided by builder · risk: low
- Decided: `StyleCardView` has a single editable text box and tags field. "Generate draft" from
  the interview fills them; "Save" always saves whatever is currently in them, whether or not a
  draft was ever generated.
- Why: this is the simplest way to satisfy both "preview and edit the drafted card" and "edit the
  current card directly, no interview" from the plan's `StyleCardView.tsx` description, with one
  save path instead of two.
- risk: low
