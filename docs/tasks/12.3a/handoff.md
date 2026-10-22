# Task 12.3a handoff: rights-declaration text and loader (packages/content, Phase A)

## Summary
Added the placeholder rights-declaration policy text and a loader for it in
`packages/content`, following task 1.7's privacy-notice pattern exactly, but as a single
global file (the declaration a teacher signs does not vary by market, unlike the grievance
contact, which is a locale-pack field read in a later phase). The file is born
`reviewedBy: pending` with a `[PLACEHOLDER]`-marked body; no legal wording, helpline, contact,
law or reviewer name was written. `edmate content validate` is not wired to this file in this
phase (per the plan).

## Files
- `content/legal/rights-declaration/global.md` (new): front matter `version: draft-0`,
  `reviewedBy: pending`, `reviewedOn: "2026-10-22"`; placeholder body with the same
  "not legal text" / "must not be shown to learners" warning as the privacy notice.
- `packages/content/src/rightsDeclaration.ts` (new): `RightsDeclarationFrontMatterSchema`,
  `parseRightsDeclaration(text, file?)`, `readRightsDeclaration(path)` (one file, no directory
  scan), `rightsDeclarationSigned(doc)`, `PLACEHOLDER_MARKER`. Copies `privacyNotices.ts`'s
  front-matter regex and placeholder logic; does not import from or modify `privacyNotices.ts`.
- `packages/content/src/rightsDeclaration.test.ts` (new): schema acceptance/rejection cases,
  `parseRightsDeclaration` (CRLF, default file name, malformed front matter, empty body),
  `readRightsDeclaration` (real file, missing file, path is a directory), `rightsDeclarationSigned`
  (pending reviewer, placeholder body, signed case).
- `packages/content/src/realRightsDeclaration.test.ts` (new): reads the real committed
  `content/legal/rights-declaration/global.md` directly (mirrors `realPrivacyNotices.test.ts`),
  asserts it loads and asserts it is **not yet signed** (`reviewedBy: pending`, placeholder body,
  `draft-0` version) — a failing-until-signed assertion, same pattern as `realLocales.test.ts`'s
  India-helpline comment.
- `packages/content/src/index.ts`: one appended export block for the new names. The existing
  `privacyNotices.ts` export already uses the name `PLACEHOLDER_MARKER`, so the new one is
  re-exported as `RIGHTS_DECLARATION_PLACEHOLDER_MARKER` to avoid a collision.

Not touched: `packages/content/src/validate.ts`, `packages/content/src/privacyNotices.ts`,
`packages/db/**`, `apps/web/**` (all out of scope for Phase A per the plan).

## Tests
`corepack pnpm turbo run typecheck lint test --filter=@edmate/content...` → 14/14 tasks green,
25 test files, 537 tests passed. `rightsDeclaration.ts` itself: 100% statements/branches/funcs/
lines. `python3 .githooks/secret-scan.py --all` → clean (no output).

## Decisions

### 22 Oct 2026 · 12.3a content/legal/rights-declaration/global.md is a student-safety risky path · decided by builder · risk: high
- Decided: the new file sits under `content/legal/**`, already in the student-safety risky-path
  group per task 1.7; this handoff names code-reviewer as required reviewer for this group, per
  the plan's "Risky paths touched" section.
- Why: the plan's lead answers (22 Oct 2026) name code-reviewer for 12.3a's content/legal change
  and ask every risky phase to log a `risk: high` decision, even though the file itself is a
  committed placeholder with no legal text.
- risk: high

## Left to do
Nothing for Phase A. Phase B (`packages/db`: `rightsDeclared` input, `rightsDeclaredAt` read,
`takedowns.countUpheld`) and Phase C (`apps/web`: studio checkbox, public `/legal/rights` page)
are separate board tasks (12.3b, 12.3c) per the plan's "Lead answers" section.

Status: DONE
Tool calls used: 34 (harness count; the builder reported 17 in the handoff and 22 on return)
