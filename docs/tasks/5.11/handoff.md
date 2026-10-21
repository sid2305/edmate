# Task 5.11 — Outline drafter and style-card drafter (`packages/ingest`)

Status: DONE

## Acceptance evidence

Acceptance line: "A demo outline links every topic to source chunks; the style card is ≤ 300
words and includes the mistakes list."

```
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/ingest...
@edmate/ingest:typecheck: $ tsc --noEmit -p tsconfig.json
@edmate/ingest:lint: $ eslint .
@edmate/ingest:test: $ vitest run --coverage
 Test Files  20 passed (20)
      Tests  294 passed (294)
All files          |     100 |    98.09 |     100 |     100 |
 src/outline       |     100 |      100 |     100 |     100 |
  draftOutline.ts  |     100 |      100 |     100 |     100 |
 src/styleCard     |     100 |      100 |     100 |     100 |
  draftStyleCard.ts|     100 |      100 |     100 |     100 |
 Tasks:    14 successful, 14 total
```

`draftOutline.test.ts`'s "acceptance" case drafts an outline over two real `content/demo-teacher`
modules (`values-variables`, `conditions`), parsed and chunked through the existing
`parseMarkdown`/`chunkDocument` pipeline so chunk ids and text are real, and asserts every topic is
non-empty with every `chunkIds` entry present in that module's known chunk set.
`draftStyleCard.test.ts`'s "acceptance" case feeds paraphrased guided-interview answers and sample
explanations (derived from `style-card.yaml`/`common-mistakes.yaml`) and asserts the drafted card
is ≤300 words (`LIMITS.styleCardMaxWords`) and every `mistakeTags` entry is one the teacher's
candidate list contained.

```
$ python3 .githooks/secret-scan.py --all
(no output — clean)
```

## Changes

- `packages/ingest/src/outline/types.ts` — new local types `OutlineChunkInput`,
  `OutlineModuleInput`, `TopicDraft`, `ModuleOutlineDraft`, `OutlineDraft` (not contracts: 6.1's
  persisted topic map is a later, separate task).
- `packages/ingest/src/outline/draftOutline.ts` — `draftOutline(gateway, modules)`: one
  `generateObject` call per module (tier `small`), own `OUTLINE_SYSTEM` prompt string. Validates
  beyond the per-call schema that every topic is non-empty and every cited `chunkId` is one the
  module's chunks actually have; rejects with a fixed, non-leaking `IngestError` otherwise. A
  gateway failure (scripted error or malformed reply) also becomes a fixed `IngestError`
  (`provider_error`, retryable).
- `packages/ingest/src/styleCard/draftStyleCard.ts` — `draftStyleCard(gateway, input)`: one
  `generateObject` call, own `STYLE_CARD_SYSTEM` prompt string, validated against
  `StyleCardSchema.pick({ text: true, mistakeTags: true })` (word-count rule reused, not
  duplicated) plus "every `mistakeTags` entry ∈ `mistakeCandidates`" (mirrors 6.3's rule). A
  gateway failure or an out-of-list tag both become fixed `IngestError`s.
- `packages/ingest/src/index.ts` — exports `draftOutline`, `draftStyleCard`, their request
  builders/prompt constants and input/result types.
- `packages/ingest/package.json` — added `zod` as a direct dependency (already a transitive
  dependency via `@edmate/contracts`; the drafters import it directly for their result schemas).
- Tests: `packages/ingest/test/outline/draftOutline.test.ts`,
  `packages/ingest/test/styleCard/draftStyleCard.test.ts`.
- Fixtures: `packages/ingest/test/fixtures/outline/sample-module.md` (a short paraphrase, used only
  by the rejection-path tests — the acceptance test reads the real `content/demo-teacher/modules/
  **/notes.md` files directly, already open-licensed and tracked in `licences.yaml`);
  `packages/ingest/test/fixtures/styleCard/{answers,sampleExplanations,mistakeCandidates,
  draftedCard}.json` (paraphrased from `content/demo-teacher/style-card.yaml` and
  `common-mistakes.yaml`).

## Deviations

- Added `zod` to `packages/ingest`'s own `dependencies` (plan did not call this out explicitly but
  listed no new contracts type and both drafters build/validate their own zod schemas locally).
  No lockfile conflict: it was already present transitively at the same version used by
  `@edmate/contracts`.
- Added two extra test cases per drafter beyond the two the plan named explicitly (an empty-topic
  rejection for outline, and a gateway-failure wrap for both), to cover the `IngestError` paths the
  design calls for without leaving them untested.

## Open points

None.

## Fix round

typescript-reviewer (HIGH, also raised as MEDIUM by code-reviewer): the bare
`catch { throw draftFailed() }` around each drafter's `generateObject` call turned a deterministic
schema/validation failure of the model's reply into `IngestError('provider_error', retryable: true)`
— wrong for a failure that will reproduce on retry (e.g. the style card going over
`LIMITS.styleCardMaxWords`, enforced by `StyleCardDraftSchema` itself via `schema.parse` inside
`ScriptedGateway.generateObject`).

Fix: both `draftModule` (`draftOutline.ts`) and `draftStyleCard` (`draftStyleCard.ts`) now branch on
`e instanceof ZodError` (zod, already an allowed harness/ingest import) in the `catch`. A `ZodError`
means the schema call itself rejected the model's reply shape/content — now
`IngestError('validation', false, ...)`, a new `schemaFailed()` helper per file. Anything else
(a `ScriptedGatewayError`/`ScriptedProviderError` standing in for a real gateway/provider failure)
still becomes the existing `IngestError('provider_error', true, ...)` via `draftFailed()`. Neither
message names the model's reply or teacher text, matching the existing post-schema checks.

Updated `draftStyleCard.test.ts`'s "rejects a scripted answer longer than the word limit" to expect
`{ code: 'validation', retryable: false }` (was `provider_error`). Added
`draftOutline.test.ts`'s "rejects a scripted reply that fails the model output schema" (a reply
missing `topics` entirely), which did not have a schema-failure case before.

```
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/ingest...
 Test Files  20 passed (20)
      Tests  295 passed (295)
 src/outline/draftOutline.ts    | 100 | 100 | 100 | 100
 src/styleCard/draftStyleCard.ts| 100 | 100 | 100 | 100
 Tasks:    14 successful, 14 total

$ python3 .githooks/secret-scan.py --all
(no output — clean)
```

## Decisions

### 20 Oct 2026 · 5.11 drafter prompts are authoring aids, not prompt packs · decided by tdd-guide
Decided: `OUTLINE_SYSTEM` and `STYLE_CARD_SYSTEM` are one-shot authoring-assist prompt strings
local to `packages/ingest`, kept one per drafter module (`draftOutline.ts`, `draftStyleCard.ts`),
not `content/prompt-packs/**` or `content/skills/**`.
Why: same category as route's `modelFallback.ts` classifier prompt (task 3.3); their output is
always a draft the teacher edits (PRD steps 3 and 5) before anything reaches a student, so they
need no pedagogy-author sign-off and no `promptPackVersion` gating. Keeping each prompt string in
its own drafter module (rather than a shared prompts file) makes a later migration to a real
prompt pack a single-file change per drafter.
risk: low

### 20 Oct 2026 · 5.11 outline/style-card drafts stay local to ingest, not contracts · decided by tdd-guide
Decided: `OutlineDraft`/`ModuleOutlineDraft`/`TopicDraft` are local types in
`packages/ingest/src/outline/types.ts`, not `packages/contracts`; the style-card drafter returns
`{ text, mistakeTags }` validated by `StyleCardSchema.pick(...)` rather than a new contracts type.
Why: no `Outline`/`Topic` contract exists yet — 6.1 ("topic map from the course outline") persists
a validated topic map later and is a separate task; 5.11 only drafts a candidate tree in memory
that the teacher edits before it is ever persisted. No ADR needed since `packages/contracts` is
unchanged.
risk: low

### 20 Oct 2026 · 5.11 merge with the real-gateway retryable HIGH moved to 5.11a · decided by lead
Decided: merge PR #78 after one fix round. The fix branches on ZodError, which only ScriptedGateway throws; the real gateway (packages/gateway/src/adapters/errors.ts) maps a schema failure to GatewayError code 'validation', so real traffic still gets provider_error/retryable. That HIGH is open and moves to 5.11a (M5, next on the Sonnet slot).
Why: the MVP rule is one fix round per PR, with an open HIGH becoming a board task. Nothing calls the drafters yet (8.x wires them), so the cost today is nil.
risk: low
