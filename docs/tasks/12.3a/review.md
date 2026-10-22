# 12.3a review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), lead

The rights declaration is born pending: `reviewedBy: pending` and a `[PLACEHOLDER]` body, with no legal wording, contacts or names. The loader mirrors privacyNotices.ts. Every malformed input throws ContentLoadError before a value exists, so a malformed file can never read as signed. Signed needs both a reviewer other than pending and no placeholder marker. The index export aliases the marker name to avoid a clash. The scope matches Phase A.

## Findings
- [LOW] [wontfix] packages/content/src/rightsDeclaration.ts — a missing file throws a plain Error, not ContentLoadError; this matches privacyNotices.ts on purpose, and Phase C's page catches broadly.
- [LOW] [wontfix] packages/content/src/rightsDeclaration.ts — existsSync then readFileSync can race; it reads a committed local file, the same accepted pattern as privacyNotices.ts.
