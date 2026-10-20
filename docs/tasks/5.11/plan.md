# Task 5.11 — Outline drafter and style-card drafter (`packages/ingest`)

## Acceptance (verbatim)
A demo outline links every topic to source chunks; the style card is ≤ 300 words and includes
the mistakes list.

## How it will be shown
Two integration-style tests, both on the scripted gateway (no real model calls):
1. `outline.test.ts` — feeds a few modules of already-chunked demo-teacher content (reusing
   `content/demo-teacher/modules/*/notes.md` through the existing `parseDocument`/`chunkDocument`
   pipeline, so chunk ids and text are real) into `draftOutline`; asserts the returned outline has
   every topic non-empty and every `chunkIds` entry present in the input chunk set for that module
   (and rejects/retries a scripted answer that invents an unknown id).
2. `styleCard.test.ts` — feeds a small fixture of guided-interview answers and 3 sample
   explanations (written as short paraphrases of `content/demo-teacher/style-card.yaml` and
   `common-mistakes.yaml`, the only in-repo open-licensed teacher voice/mistakes we have) into
   `draftStyleCard`; asserts the result parses against the shared word-count rule (≤ 300 words,
   `LIMITS.styleCardMaxWords`) and that every returned `mistakeTags` entry is one the teacher's
   candidate list contained (never an invented tag, mirroring 6.3's "never emits a tag outside the
   list").

## Design (local to `packages/ingest`, no contracts change)
- `StyleCardSchema` already exists in `packages/contracts/src/teacher.ts` with `text` (≤300 words
  via `LIMITS.styleCardMaxWords`) and `mistakeTags`. The style-card drafter returns a draft of just
  `{ text, mistakeTags }` (caller assigns `id`/`teacherId`/`version`) and validates it by reusing
  `StyleCardSchema.pick({ text: true, mistakeTags: true })` — no duplicate word-count rule, no new
  contracts type.
- No `Outline`/`Topic` contract exists yet (6.1 "Topic map from the course outline" is a later,
  separate task that persists a validated topic map). 5.11 only drafts a candidate tree in
  memory — new types `OutlineDraft`/`ModuleDraft`/`TopicDraft` stay local to `packages/ingest/src`
  (same pattern as `ParsedDocument` in `types.ts`), not in `packages/contracts`.
- `draftOutline(gateway, input)`: input is one or more modules, each with its moduleId/title and
  the chunk ids + text + locator already produced by 5.3's chunker/store (outline drafting runs
  after chunking per the PRD ingestion flow). One `generateObject` call per module (tier `small`),
  system prompt instructs the model to group chunks into topics and cite only given chunk ids.
  Output is validated: every topic has ≥1 `chunkId`, every id is drawn from that module's known
  set; an unknown id or empty topic throws a fixed `IngestError` (no chunk text in the message).
- `draftStyleCard(gateway, input)`: input is `{ answers: {question, answer}[], sampleExplanations:
  string[], mistakeCandidates: string[] }` (candidate tags come from the teacher's own
  common-mistakes list, same shape as `content/demo-teacher/common-mistakes.yaml`). One
  `generateObject` call (tier `small`); output validated against `StyleCardSchema`'s picked fields
  plus "every mistakeTags entry ∈ mistakeCandidates".
- Both call `ModelGateway.generateObject` directly (the existing port); tests build a
  `ScriptedGateway` + fixed `Clock` from `@edmate/harness/testing`, already a devDependency of
  `packages/ingest` (same pattern `hashedEmbedder.ts` uses for `embed`) — rule 4 satisfied, no new
  test double needed in ingest.
- Exports added to `packages/ingest/src/index.ts`: `draftOutline`, `draftStyleCard`, their input/
  result types, and the two new `IngestError` cases if needed.

## Prompt text: not a prompt pack or template
Both drafters need new system-prompt strings, but they are one-shot authoring-assist calls inside
`packages/ingest` (same category as route's `modelFallback.ts` classifier prompt from 3.3) — not
`content/prompt-packs/**` (turn-time teaching composition, `promptPackVersion`-gated) or
`content/skills/**` templates, and their output is always a draft the teacher edits (PRD steps 3
and 5) before anything reaches a student. Following the 3.3 precedent, this does not need
pedagogy-author or a named sign-off. Flagged below as a decision to log, not an open question.

## Files
- New: `packages/ingest/src/outline/draftOutline.ts`, `packages/ingest/src/outline/types.ts`
- New: `packages/ingest/src/styleCard/draftStyleCard.ts`
- New tests: `packages/ingest/test/outline/draftOutline.test.ts`,
  `packages/ingest/test/styleCard/draftStyleCard.test.ts`
- New fixtures (derived only from `content/demo-teacher/**`, already open-licensed and tracked in
  `licences.yaml`): small excerpt/paraphrase files under
  `packages/ingest/test/fixtures/outline/` and `packages/ingest/test/fixtures/styleCard/`
- Edit: `packages/ingest/src/index.ts` (new exports)
- Out of bounds: `packages/contracts/**`, `content/prompt-packs/**`, `content/skills/**`,
  `packages/db/**` (persistence is 6.1+), the studio outline/style-card editor (8.x).

## Tests first
TDD order per drafter: (1) write `draftOutline.test.ts`/`draftStyleCard.test.ts` against the
planned function signatures (red), including the unknown-chunk-id / out-of-list-tag rejection
cases, (2) implement just enough to pass, (3) add the acceptance-line tests (demo outline links
every topic; style card ≤300 words + mistakes list) last, on the real demo-teacher fixtures.

## Risky paths touched
None (checked against risk-paths.txt): all new/edited paths are under `packages/ingest/src/**` and
`packages/ingest/test/**`, which match no glob in `.claude/skills/merge-gate/risk-paths.txt`
(not `packages/contracts/**`, not `packages/harness/src/guardrails|pedagogy/**`, not
`content/prompt-packs|skills/**`, not `.claude/**`). Still logs a `risk: low` decision (new prompt
text, no pack/template, per the reasoning above) so it's visible in the log even though the gate
doesn't require extra reviewers.

## ADR / pack sign-off
No ADR: no `packages/contracts` change. No prompt-pack/template sign-off: see reasoning above.

## Phases
Single phase, ~90–120 builder calls: two small drafter modules + two test files + fixtures + one
index.ts edit, all in one package, no new ports or adapters. Below the ~150-call split threshold.

## Open questions
1. Outline drafter granularity — one `generateObject` call per module vs. one call for the whole
   course outline. Recommendation: per module (smaller prompts, matches chunking's module
   boundary, easier scripted fixtures); the demo course's 5 modules make this cheap either way.
2. Style-card drafter's interview-answers fixture is paraphrased from the existing
   `style-card.yaml`/`common-mistakes.yaml` rather than a real guided interview transcript (none
   exists yet). Recommendation: accept for this task since the acceptance line only requires the
   drafted card to be ≤300 words and include the mistakes list; a real interview UI is task 8.4.

## Lead answers (20 Oct 2026)
1. One `generateObject` call per module, as recommended.
2. Accept the paraphrased style-card fixture. A real interview transcript comes with 8.4.
3. The drafter prompts are authoring aids, not prompt packs, so they need no pedagogy-author sign-off. Their output is always a draft the teacher edits. Log this in the handoff as a decision. Keep every drafter prompt string in one module per drafter so a later pack migration is easy.
Reviewers: code-reviewer and typescript-reviewer (sonnet). No risky paths.
