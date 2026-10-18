# 1.8 handoff — demo teacher content

Status: DONE pending the human's sign-off (`reviewed_by` stays `pending` in content/demo-teacher/licences.yaml until sid2305 approves; then it becomes `sid2305`).
Branch: m1/1.8-demo-teacher. Built in two parts: tdd-guide (packages/content + `edmate content validate`, f1feff9), then pedagogy-author wrote content/demo-teacher/**; the lead ran the validator and the code check.

## Evidence
- `corepack pnpm --filter=@edmate/cli exec node bin/edmate content validate content/demo-teacher` → ok.
- packages/content 93 tests, apps/cli 46 tests; all gates green; secret scan clean.
- Every Python example in modules/*/notes.md run in order per file: 33 ran ok, 0 failed, 7 skipped (examples that are meant to raise an error or loop forever, and ones needing `input()`).
- Content: course.yaml; 5 modules (notes.md each); question bank 37 questions; 32 rubric-scored student answers (maxScore 4); style card; common mistakes; Q&A recall 18 items (4 answerable only from paid modules); free and paid packages (paid adds modules and skills); licences.yaml, all CC0-1.0 (originally written, no third-party material).

## Changes
packages/content (schemas, loader, 8 content rules plus 3 added by the builder), apps/cli `content validate [dir]`, content/demo-teacher/**.

## Deviations
- The plan's `pnpm --filter=@edmate/cli exec edmate` doesn't work (pnpm doesn't link a package's own bin); use `exec node bin/edmate`.

## Decisions

### 18 Oct 2026 · 1.8 Demo course subject and licence · decided by team lead · risk: low
Decided: The demo teacher teaches Python basics for beginners (5 modules), written from scratch and released as CC0-1.0. Third-party material would need CC BY, CC BY-SA, CC0 or public domain with a source and attribution.
Why: Easy for the human reviewer to judge, open licensing keeps the public repo clean, and it doesn't pre-empt the pilot-subjects decision.
Alternatives: Adapt an existing open course; another subject.
Reversible: Yes.

### 18 Oct 2026 · 1.8 Content validator rules · decided by tdd-guide · risk: low
Decided: Besides the plan's 8 rules, `edmate content validate` fails a non-CC0 file without a source_url, any file outside the documented layout, and a reviewed_by that is an email address.
Why: Keeps licences traceable, stops stray files, and keeps personal emails out of a public repo.
Alternatives: Warnings instead of failures.
Reversible: Yes.

### 18 Oct 2026 · 1.8 Rubric scale · decided by pedagogy-author · risk: low
Decided: Sample student answers are scored out of 4, with the criteria written in rubricNotes.
Why: A small scale keeps scoring consistent for the feedback skill's agreement test (5.7).
Alternatives: Out of 10; pass/fail.
Reversible: Yes.
