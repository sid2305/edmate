# Plan: 9.2f — 9.2c review follow-ups (LOW)

Status: READY (lead-written, 25 Oct 2026)

## Acceptance (board)
"each item fixed, with tests unchanged or extended."

## Items
1. **Translate double cast.** `apps/web/app/teachers/[slug]/page.tsx:70` and `:102` cast `await getTranslations('teacherPage')` to `Translate` with `as unknown as`. The cast exists only because the skills label key is built at runtime. Use the typed next-intl translator for every static key. Keep a narrow helper, the one place that casts, for the dynamic skills key only, for example `skillLabel(t, skill)`. `Translate` in `apps/web/src/discovery/format.ts` and the components that take it (`ScorecardPanel.tsx`, `PackageList.tsx`) may change shape if needed. Keep the change minimal, and keep `components.test.tsx` passing (extend it if the helper is new).
2. **scorecard.ts guard.** `apps/web/src/discovery/scorecard.ts:51` casts `byKey.get(key)` to drop `undefined`. Use a real guard instead: if a key is missing, return `null` (the same as a failed parse). Add a test showing that a stored scorecard missing a key returns null without throwing.
3. **format.ts dead fallback.** `apps/web/src/discovery/format.ts:16`: `resolvedOptions().maximumFractionDigits` is always defined for `style: 'currency'`, so drop `?? 2`. If typecheck says the type is `number | undefined`, keep a guard that throws, or narrow it with a comment, rather than a silent `2`. Choose whichever is cleaner and record the choice in Decisions.

## Files
`apps/web/app/teachers/[slug]/page.tsx`, `apps/web/src/discovery/{format.ts,scorecard.ts,ScorecardPanel.tsx,PackageList.tsx}` and their tests, plus `docs/tasks/9.2f/handoff.md`. Nothing under `apps/web/src/chat/**` or `apps/web/src/studio/**`, where other tasks are running. Not a risk path.

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web` and `python3 .githooks/secret-scan.py --all`.

## Reviewers
code-reviewer, typescript-reviewer.

## Budget
20 tool calls; stop at 26.
