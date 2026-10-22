# 8.6c review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), lead

## Findings
- [HIGH] [fixed] apps/web/src/studio/packages.ts — `draftOf` cast a hand-trimmed config `as PackageDraft`, so a future server-internal field could leak to the client; now a typed literal of named fields, with a test that an unknown stored field never reaches the response (verified by typescript-reviewer).
- [MEDIUM] [deferred 8.6f] apps/web/src/studio/packages.ts — `list` awaits independent reads one by one; use Promise.all.
- [LOW] [deferred 8.6f] apps/web/src/studio/packages.ts — every repository `invalid` on create maps to package_limit; the repo should name the cap error.
- [LOW] [deferred 8.6f] apps/web/src/studio/packages.ts — the `reason`/`link` fields next to the error code are a new studio error shape; document it so Phase D and later routes use it the same way.
- [LOW] [deferred 8.6f] apps/web/src/studio/packages.ts — the draftOf comment should say its compile-time guard relies on PackageDraft being `PackageConfigSchema.omit(...)`.
