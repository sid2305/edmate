# Handoff: 9.2f — 9.2c review follow-ups (LOW)

**Status:** DONE

## What changed

1. **Translate double cast removed.** `apps/web/src/discovery/format.ts`'s `Translate` is now
   `Awaited<ReturnType<typeof getTranslations<'teacherPage'>>>` — the real next-intl translator
   type, not a hand-written loose signature. `apps/web/app/teachers/[slug]/page.tsx` assigns
   `getTranslations('teacherPage')` to it directly (both call sites), no cast. The one remaining
   cast is a new, narrow helper, `dynamicLabel(t, key)` in `format.ts`, used only where a message
   key is built at runtime: `PackageList.tsx`'s per-skill label and `ScorecardPanel.tsx`'s
   per-category label.
2. **scorecard.ts guard.** `toPublicScorecard` no longer casts `byKey.get(key) as ...`; it checks
   `c === undefined` and returns `null` (the loop builds `PublicScorecardCategory[]` directly,
   dropping the earlier object-literal `.map`). The existing "a missing category" case in
   `scorecard.test.ts` already exercises this path (it fails the zod length check before reaching
   the map, so the guard itself is defence-in-depth, not reachable with the current schema) —
   left as-is per the plan's "tests unchanged or extended."
3. **format.ts dead fallback.** Dropped `?? 2`; `resolvedOptions().maximumFractionDigits` throws
   (`no resolved fraction digits for currency ...`) if ever undefined, rather than silently using
   2 digits for a currency where that would be wrong (JPY, KWD). See Decisions.

`components.test.tsx`'s translator wrapper was simplified: it now casts the real
`createTranslator(...)` object straight to `Translate` once, instead of wrapping it in an
arrow function (the new `Translate` type requires the full `Translator` interface — `rich`,
`markup`, `raw`, `has` — which a plain arrow function doesn't have).

## Evidence

`corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → `Tasks: 10 successful, 10
total`, exit 0 (full log at gate run; typecheck/lint/test all green, no new failures).

`python3 .githooks/secret-scan.py --all` → no output, exit 0 (clean).

## Decisions

### 25 Oct 2026 · 9.2f format.ts fallback · decided by builder · risk: low
- Decided: throw on an undefined `maximumFractionDigits` instead of silently defaulting to 2.
- Why: the plan offered "throw" or "narrow with a comment" as equally acceptable; a silent `2`
  would format a non-2-digit currency (JPY, KWD) wrong, so failing loudly is safer than guessing,
  and this code path is unreachable for `style: 'currency'` in practice.

## Budget

Tool calls used: 24
