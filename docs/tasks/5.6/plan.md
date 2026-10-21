# Task 5.6: Practice skill

Board: milestone M5 · deps `5.5`, `M3` · branch `m5/5.6-practice-skill` · **risky** (touches
`pedagogy/**` and `content/prompt-packs/**`) · four phases, each one builder (tdd-guide), except
Phase D which is pedagogy-author + a named human sign-off, not a builder.

Concurrent work: 3.3 (`route`: intent/attempt) is running now in
`packages/harness/src/pipeline/steps/route.ts`, `src/routing/**` and
`src/testing/gatewayFixtures.ts`. **None of this plan's files touch those three paths**; Phase C's
pipeline-level test injects its own fake `Steps.route`/`decide` (same pattern
`turn.integration.test.ts` already uses) instead of exercising the real, still-stubbed `route`
step, and adds its own scripted-gateway fixtures in a new file rather than editing
`gatewayFixtures.ts`. No phase needs to wait for 3.3.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Practice skill: item selection and generation by topic and level, scoring, `skill` events"
Accept: "items map to the outline's topics; answer keys never reach the client."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Item selection by topic/level | `tools/practiceItems.ts`: `pickItem(bank, topicId, level, exclude)` never returns an item whose `topicId` differs from the one asked for (property test: for every (bank, topicId, level) the result's `topicId === topicId` or `undefined`); teacher's bank is tried before the generator (`practiceItems.test.ts` asserts bank-first with both present). |
| Items map to the outline's topics | `topicId` is an opaque string, the same shape `packages/db/src/schema/content.ts`'s `topics.id` already uses (`id()`); 5.6 does not depend on 6.1's topic map (todo) or 5.11's outline drafter (todo) — it takes `topicId` exactly as given (by a future retrieval-scoped caller) and never invents or renames one. A test asserts the bank and generator both echo the caller's `topicId` unchanged. |
| Generation by topic and level | `generateItem(topicId, level)`: a small, deterministic, template-based fallback (numeric/arithmetic via the harness's existing `mathjs` sandbox import) when the bank has nothing for that (topic, level) — explicitly provisional (Q1: richer generation is a follow-up). |
| Scoring stays correct | `route` (3.3, separate task) reports `attempt` by comparing the student's text against `help.answerKey`; 5.6's job is only to make sure that list is right: (a) each item's `answerKey` covers every canonical phrasing of its answer (`validateItem` rejects an item whose key is empty or whose only form is one the existing `answerKey.ts` matcher wouldn't catch), (b) no key may appear verbatim inside its own item's prompt text, with one documented, flagged exception for "what does this print" items (Q2, per 19 Oct decision "4.5 Constraints for 5.6"). |
| `skill` events | `tools/practice.ts`: a `RegisteredTool` named `practice.next_item`, skill `practice`, whose `present()` returns `{skill:'practice', payload:{id, topicId, level, kind, prompt, options?}}` — **never** `answerKey`. `practice.test.ts` asserts, for every item the bank/generator can produce, `revealsAnswerKey(payload, item.answerKey)` is false (reusing `pipeline/generate/answerKey.ts`'s existing matcher, the same one 4.5/skillEvent.ts use), and that the full tool *output* (model-visible) also never contains the student-facing payload's... no — the full output **does** need the item text for the model to say it; what it must never contain is any string that exposes which of several options is correct beyond what the item's own `options` already show (MCQ note, Q3). |
| Answer keys never reach the client | `runner.practiceAnswerKey.test.ts` (new, Phase C): drives one full turn through `runTurn` with a scripted gateway that calls `practice.next_item` then states the item back to the student, and scans **every** emitted `TurnEvent`, the final `replyText`, and the `TurnTrace` with `revealsAnswerKey(..., item.answerKey)` — all false. `CommitRecord.next.help.answerKey` (server-only, never serialised to the client) **does** hold the key, proven by a separate assertion, so the next turn's `mustNotReveal` protects it. |
| No contracts change | `git diff origin/main -- packages/contracts` is empty. `Tool<I,O>` already covers the new tool; `PracticeItem`, `PracticeBank`, the item-bank port and the `GenerateResult`/`CommitRecord` plumbing are all harness-internal (not re-exported as ports from `@edmate/contracts`, unlike `ProfileStore`/`TeacherQuestionStore` — see Design Decision 1). |
| No model calls in tests | Every test drives `pickItem`/`generateItem`/`practiceNextItemTool.tool.run` directly, or through the existing `ScriptedGateway`/`memoryToolRegistry` pattern (5.5's convention). No provider adapter touched. |

## Design

### Decision 1 (central, flag to architect — not an ADR, no contracts change)

**The gap:** `pedagogy/helpState.ts` already reserves `answerKey: string[]` ("Filled by 5.6"), and
`decide` already copies it into `mustNotReveal` and resets it to `[]` on a solved problem (3.5
decisions) — but nothing today *sets* a fresh key when a new problem starts, because `decide` (and
its `next`, which `commit` saves) run **before** `generate`'s tool loop, and a `practice.next_item`
tool call only happens *inside* generate. `PedagogyDecision` and `TurnContext` are contracts types
that already reach the model/composer; adding an "active item" field to either would need an ADR,
and would also risk the item's prompt text (fine) or its answer key (never) riding along a path
built for other data.

**Recommendation (what this plan builds):** keep item delivery entirely inside the existing tool
seam (3.7/5.5's `RegisteredTool`/`onToolOutput`), and close the save gap with two small,
harness-internal (no contracts) additions:
- `GenerateResult` (`pipeline/types.ts`, `pipeline/results.ts`) gets
  `practiceAnswerKey?: readonly string[]` — set by `generate.ts`'s `onToolOutput` when the tool
  named `practice.next_item` succeeds, read from the tool's full (unredacted) output, never from
  `present()`'s payload.
- `runner.ts`, only on the `'replied'` path (never on error/escalate, which never showed the item),
  overrides `next.help.answerKey` with `gen.practiceAnswerKey` before it reaches `commit`.

This is reviewed by the lead as a `risk: high` decision regardless of the merge gate's own
risk-paths list, because it changes how the turn pipeline persists state, even though none of the
touched files (`pipeline/types.ts`, `pipeline/results.ts`, `pipeline/steps/generate.ts`,
`pipeline/runner.ts`) match a `risk-paths.txt` glob.

### Decision 2: the signed-off `practice@1.0.0.md` pack must change (Phase D, blocker)

The existing pack (`reviewed_by: sid2305`) tells the model to "write a new item" itself when the
bank has nothing, "in the material" — written before the tool registry existed (5.5's comment:
"5.6/5.7/5.8 append `practice.next_item` ... here"). A model-authored item's answer is never known
to the harness, so it can never be protected by `mustNotReveal`/the stream gate/postGuard — it
would leak by construction. **5.6 must have the pack revised (practice@1.1.0) to call the tool for
every new item and never author one itself.** This is prompt-pack behaviour (`content/prompt-packs/**`,
risky path) and a safety-relevant change: it is **pedagogy-author's draft**, and needs the **named
human's sign-off** before merge (constraint, not a guess) — flagged as a blocker, not decided here.

### Phase A — item model, bank, generator (pure; no pipeline wiring)

`packages/harness/src/tools/practiceItems.ts`:
- `PracticeLevel = 1 | 2 | 3` (difficulty tier, distinct from the help-ladder rung).
- `PracticeItemKind = 'numeric' | 'mcq' | 'short' | 'code_output'` (`code_output`: the printed
  output is legitimately in the question text — the 19 Oct "what does this print" exception; the
  only kind `validateItem` allows a key-in-prompt match for).
- `PracticeItem { id, topicId, level, kind, prompt, options?: string[], answerKey: string[] }`.
  For `mcq`, `answerKey` is the correct option's **id/letter**, never its text (the option text is
  shown to the model regardless — that's how MCQs work; flagged as Q3, not a leak).
- `PracticeBank` (harness-internal interface, **not** a contracts port — Decision 1): `pick(topicId,
  level, exclude: readonly string[]): PracticeItem | undefined`.
- `generateItem(topicId, level): PracticeItem`: deterministic template fallback, numeric/arithmetic
  only for MVP (via the harness's existing restricted `mathjs` import — no new dependency).
- `validateItem(item): boolean` / a `test`-only assertion: no `answerKey` form (via
  `normaliseForMatch`, reused from `pipeline/generate/answerKey.ts`) occurs inside `item.prompt`,
  unless `item.kind === 'code_output'`.
- `demoPracticeBank.ts`: a small in-memory fixture bank (3-4 topics × levels) for tests and as
  `defaultToolRegistry`'s default — **not** real teacher content (that is 5.11/8.x, later).

### Phase B — the tool and registry

`packages/harness/src/tools/practice.ts`:
- `Tool` input `z.strictObject({ topicId: z.string().min(1), level: z.literal([1,2,3]), exclude:
  z.array(z.string()).max(20).exactOptional() })`, output
  `z.strictObject({ id, topicId, level, kind, prompt, options: z.array(z.string()).exactOptional(),
  answerKey: z.array(z.string()) })`.
- `run`: `pick` the bank, else `generateItem`, validated.
- `present(output, ctx)`: strips `answerKey`, returns the rest as the `skill` payload.
- `registry.ts`: `defaultToolRegistry(bank: PracticeBank = demoPracticeBank): ToolRegistry` adds
  `practiceNextItemTool(bank)` next to the calculator.

### Phase C — pipeline wiring, leak proof, decision log

- `pipeline/types.ts` + `pipeline/results.ts`: `GenerateResult.practiceAnswerKey` (Decision 1).
- `pipeline/steps/generate.ts`: `onToolOutput` captures it when `entry.tool.name ===
  'practice.next_item'` and the parsed output has a non-empty `answerKey`.
- `pipeline/runner.ts`: on the replied path only, `next.help.answerKey = gen.practiceAnswerKey ??
  next.help.answerKey` before `finish()`.
- `pedagogy/helpState.ts`: one-line doc-comment update only (how `answerKey` is actually filled) —
  **this file is in `pedagogy/**`, a risky path** (see below).
- New tests: a `generate.ts` unit test for the capture; `runner.practiceAnswerKey.test.ts` (new
  file, own fixtures, no edits to `gatewayFixtures.ts`/`route.ts`/`routing/**`) for the full-turn
  leak proof in the acceptance table.
- Handoff `## Decisions`: logs Decision 1 as `risk: high`.

### Phase D — pedagogy-author + human sign-off (not a builder phase)

Draft `content/prompt-packs/practice@1.1.0.md`: call `practice.next_item` for every new problem;
never author an item freely; keep the existing "wait for the answer / never include the answer /
help only at the decision's rung" rules. **Blocker:** needs the named human's sign-off
(`reviewed_by:`) before merge, same as `practice@1.0.0.md`'s original. Runs the pedagogy, leak and
locked eval suites before merge (pack-change rule).

## Files

- **Create (A):** `tools/practiceItems.ts`, `practiceItems.test.ts`, `demoPracticeBank.ts`,
  `demoPracticeBank.test.ts`.
- **Create (B):** `tools/practice.ts`, `practice.test.ts`. **Modify (B):** `tools/registry.ts`,
  `registry.test.ts`, `tools/index.ts`, `src/index.ts`.
- **Modify (C):** `pipeline/types.ts`, `pipeline/results.ts`, `pipeline/steps/generate.ts`,
  `pipeline/runner.ts`, `pedagogy/helpState.ts` (comment only). **Create (C):**
  `pipeline/runner.practiceAnswerKey.test.ts`, its own small scripted-gateway fixture (inline or a
  new `testing/practiceFixtures.ts` — never `gatewayFixtures.ts`).
- **Create (D):** `content/prompt-packs/practice@1.1.0.md`.
- **Tests first** in every phase (A's `validateItem`/topic-mapping cases before the generator;
  B's leak assertion before the tool is wired into the registry; C's full-turn leak scan before the
  plumbing is "done").
- **Gate:** `turbo run typecheck lint test --filter=...@edmate/harness` per phase; Phase D runs the
  pedagogy/leak/locked eval suites.
- **Size:** Phase A ~6 files / ~70 calls. Phase B ~6 files / ~50 calls (depends on A). Phase C ~6
  files / ~90 calls (depends on A, B; the heaviest phase — the full-turn leak test is the long
  pole). Phase D is pedagogy-author, not sized in tool calls.

## Files out of bounds

- `packages/harness/src/pipeline/steps/route.ts`, `src/routing/**`, `src/testing/gatewayFixtures.ts`
  — 3.3, running now.
- `packages/harness/src/access/**` — unchanged; the new tool is filtered by the existing,
  unmodified `entitledTools`/`offeredTools` (skill `practice`), same as 5.5 reused them for
  `calculator`.
- `packages/harness/src/pedagogy/skills.ts`, `policy.ts`, `ladder.ts` — no change needed; item
  delivery is entirely a tool-loop concern (Decision 1), not a policy-rule concern.
- `packages/contracts/**`, `docs/adr/**` — no port or contract change (Decision 1).
- 6.1 (topic map/validation), 5.11 (outline drafter), 8.x (outline editor) — not built; 5.6 takes
  `topicId` as an opaque string and does not validate it against a real outline.
- 5.7/5.8 (feedback, role-play tools) — not touched.
- Real teacher question-bank content/ingestion — `demoPracticeBank` is a fixture, not production
  data.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/harness/src/pedagogy/helpState.ts` (Phase C, comment only) — matches `pedagogy/**`.
  **Reviewers: code-reviewer** (MVP-phase group; `safety-reviewer` returns at the 13.3 pilot gate).
- `content/prompt-packs/practice@1.1.0.md` (Phase D) — matches `content/prompt-packs/**`.
  **Reviewers: code-reviewer**, plus the named human's sign-off (constraint, not the gate).
- Everything else (`tools/**`, `pipeline/**`) matches no glob in `risk-paths.txt` — not risky by
  the gate's own rule. Decision 1 is still logged `risk: high` in the handoff on the lead's
  judgement (architecturally significant), per the file's own header ("so the merge reaches the
  human's skim list"), even though no extra reviewer is gate-required for those files.

## Open questions (each with a recommendation)

- **Q1. How much "generation" for MVP?** Recommend: numeric/arithmetic templates only now (via the
  existing `mathjs` sandbox); MCQ/short-answer generation (needs real phrasing judgement) is a
  follow-up once pedagogy-author content exists, same MVP-first pattern as 5.5's calculator scope.
- **Q2. The "what does this print" exception's shape.** Recommend: a dedicated `code_output` kind
  that `validateItem` exempts from the no-key-in-prompt check, matching the 19 Oct decision's
  wording exactly (lead or pedagogy-author to confirm the kind name).
- **Q3. MCQ answer key = the option id, not its text.** Recommend: accept — the option text is
  visible to the model/student by design (it's one of the choices); only *which one is correct*
  must never be inferable beyond the options shown. Flag to pedagogy-author/safety-reviewer that
  this is a materially different leak model than numeric/short items, worth a look in Phase D/B's
  review.
- **Q4. `topicId` with no 6.1/5.11 to validate against.** Recommend: 5.6 does not invent
  validation; it trusts the caller's `topicId` (as decided already for 3.16's similar "no real
  evidence producer yet" gap). A later task (6.1) adds real validation once the topic map exists.
- **Q5. Should `tools/**` join `risk-paths.txt`'s groups now that two tools exist?** Recommend:
  raise to the architect as in 5.5's Q5 (still not done there); not blocking this task.

## Lead answers (20 Oct 2026)
- Decision 1: accepted as planned. The plumbing stays harness-internal through `GenerateResult`/`runner.ts`, with no contracts change. The handoff logs it `risk: high`. architect reviews Phase C alongside code-reviewer, typescript-reviewer and security-reviewer, so it is not a human question. B-26 now holds only the prompt-pack sign-off.
- Q1: numeric and arithmetic templates only, through the 5.5 sandbox. MCQ and short-answer generation come later.
- Q2: yes, a `code_output` kind, exempt from the no-key-in-prompt check as the 19 Oct decision says.
- Q3: accepted. The MCQ key is the option id. Phase C's leak test must also prove the correct option id never appears in model-visible context or events.
- Q4: trust the caller's `topicId`; 6.1 adds validation.
- Q5: `tools/**` stays out of risk-paths.txt for now. The lead runs security-reviewer on tool PRs anyway. Revisit at 13.3.
- Order: Phase A starts once 3.3 Phase B returns, since only one builder runs in packages/harness at a time.
- Correction from the lead: practice@1.1.0 changes prompt-pack behaviour, so it needs an ADR in docs/adr/ (CLAUDE.md non-negotiable 2), reviewed by architect, security-reviewer and typescript-reviewer and logged `risk: high`. architect drafts the ADR text once pedagogy-author's draft exists; the Phase C builder writes the ADR file and places the pack at content/prompt-packs/practice@1.1.0.md. The named human's sign-off (B-26) is still required.

## Architect review (20 Oct 2026): accepted by the lead
The full text, including the ADR-0010 draft and the answers to Q-A to Q-D, is in `docs/tasks/5.6/architect-adr-0010.md`. The ADR is numbered 0010 because 0009 is taken by 3.11d; check the number is still free when the file is written. Decision 1 is approved with five conditions, and the lead accepts all of them.
- **[CRITICAL] Phase B:** the tool output is `{ id, kind, level, prompt, options? }` and never includes the key. The harness looks the key up on the server by item id, through a RegisteredTool hook. Item ids are deterministic, so the key can be recomputed.
- **[HIGH] Phase C:** add the new key to the stream gate and postGuard as soon as the tool returns, on the same turn. `GenerateResult.practiceAnswerKey` holds the union.
- **[HIGH] Phase A:** `PracticeBank.pick` takes `{ teacherId, allowedModuleIds }` and enforces them. The model passes no topic and no ids: tool input is strict `{ level?: 1|2|3 }`. The module comes from the top retrieved chunk, else the active item's module, else the first allowed module.
- **[MEDIUM] Phase C:** the runner writes `next.help.answerKey` on every outcome where the item event went out, resets the ladder fields and records the item id.
- **[MEDIUM] Phase A:** the bank never serves MCQ or code_output items until the matcher has an answer-context mode (follow-up task 5.6b).
- **Q-B (Phase C):** apply the practice cap of 3 whenever a practice key is held, whatever skill is chosen, so no turn reaches the solution rung. Add a test where a `solution` move is forced on a practice item and gets capped. The pack says "never at any rung" and depends on this cap.
- **Q-C:** not a live leak. Before 5.11, task 5.6a makes buildContext drop chunks that reveal the answer key, and the bank is never chunked.
- **Pack:** the revised draft is at `docs/tasks/5.6/practice@1.1.0.draft.md`, with its change note beside it. It needs the human's sign-off (B-26). Phase C moves it to `content/prompt-packs/practice@1.1.0.md`.
