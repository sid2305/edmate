# 9.2c review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), lead

## Findings

- [LOW] [deferred 9.2f] apps/web/app/teachers/[slug]/page.tsx — `getTranslations(...) as unknown as Translate` widens next-intl's typed keys to string for every t() call in PackageList and ScorecardPanel (also discovery/format.ts); scope the cast to the dynamic skills key.
- [LOW] [deferred 9.2f] apps/web/src/discovery/scorecard.ts — `byKey.get(key) as ...` casts away undefined; safe today only because the schema's length and uniqueness checks guarantee the key; use a guard.
- [LOW] [deferred 9.2f] apps/web/src/discovery/format.ts — the `?? 2` fallback after resolvedOptions().maximumFractionDigits is dead code.
