# 5.6c plan: 5.6 review follow-ups (before any real practice bank)

Status: READY. The open questions below each have a recommendation; none blocks Phase A or Phase C. Phase B needs the ADR text, which the architect gives at plan review (draft below).
Planner: 20 Oct 2026 (opus). Sources:
- `docs/tasks/5.6/review.md` (findings marked "deferred 5.6c");
- `docs/tasks/5.6/handoff.md`;
- `docs/adr/0010-practice-items-from-tool.md`;
- `docs/tasks/5.6a/plan.md` and its lead answers;
- the 5.6a PR #75 typescript and security reviews, which the lead added to this scope on 20 Oct 2026 (items 8 to 10).

**Builds on 5.6a (PR #75, not merged).** The planner had no shell, so it could not read the branch diff. This plan relies on 5.6a's plan, its lead answers and its two reviews:
- `AcceptItem` becomes `(item, answerKey) => boolean`;
- `practice.ts` imports `contextAnswerKeys` and `chunkLeaks` from `pipeline/steps/buildContext.ts`, and refuses an item whose key is in `ctx.retrieved` (short numeric keys 0–99 are exempt);
- buildContext drops chunks that hold a key and sets `answerKeyDropped`;
- `runner.ts` `assemble` deletes `answerKeyDropped` before the strict TurnContext parse;
- `packages/ingest/src/answerBank.ts` provides `assertNotAnswerBank(title, units)`.

The builder starts only after 5.6a merges. The first step is to rebase on main and read the merged code. The names above come from the reviews, so the builder confirms them in the merged code.

## Acceptance (verbatim, board)
> a bank pick for another teacher with the same module id returns nothing; no practice key text appears in any model request; the listed tests pass

How it will be shown:
1. **Other teacher, same module.** In `demoPracticeBank.test.ts`, `pick({ teacherId: 'tch_other', allowedModuleIds: ['module-arithmetic'] }, 1, [])` is `undefined`, and `answerKeyFor('demo:arithmetic:1:a', <same scope>)` is `undefined`. In `practiceItems.test.ts`, `pickItem` with a stub bank that ignores teacherId never serves the other teacher's item (the runtime check in `servable`). In `practice.test.ts`, `issuedItem` for a bank id under another teacher's scope is `undefined`.
2. **No practice key in any model request.** This is a runner test with the real decide step (compose with the fixture packs) and the scripted gateway, on a later turn whose loaded help state holds a practice key. No captured request on any tier (main, fallback, small judge, classifier) contains the key: not in the system prompt, the messages or the tools. The decision still guards the key: when the scripted model writes it, the reply is the safe hint. The issuing turn is already covered by 5.6's tests; those tests are widened to all tiers.

   Scope, written down in the handoff and the ADR: this covers text the **harness** supplies. It does not cover three things:
   - the student's own message;
   - the small-tier rewrite of a draft in which the model wrote the key itself (Q3);
   - retrieved chunks holding a short numeric key, which 5.6a's lead answer lets through.

   The test uses student text and chunks without the key.
3. **The listed tests pass.** Each item below has its own test. Gate:
   - `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` (Phases A and B);
   - `--filter=@edmate/ingest...` (Phase C);
   - `python3 docs/adr/check-headings.py docs/adr`;
   - `python3 .githooks/secret-scan.py --all`.

## Scope (items mapped to findings)
| # | Item | Finding | Phase |
|---|------|---------|-------|
| 1 | PracticeBank teacherId scope check; records carry teacherId | 5.6 MEDIUM demoPracticeBank.ts:154 | A |
| 2 | validateItem also checks the item's options and id against its own key | 5.6 MEDIUM practiceItems.ts:282 | A |
| 3 | Bound GEN_ID operands; one shared generated-id parser; fix the "can never throw" comment | 5.6 LOW practiceItems.ts:200, MEDIUM practice.ts:60 | A |
| 4 | Exactly one allowed module resolves an item id; direct test of the generated-id module read | 5.6 LOW practice.ts:204 | A |
| 4b | Move `contextAnswerKeys`/`chunkLeaks` out of `pipeline/steps/buildContext.ts` into `pipeline/generate/answerKeyContext.ts`, so tools no longer import a pipeline step; hoist the short-integer regex to a module constant; no behaviour change. In `practice.test.ts`, replace `target!`/`answerKey[0]!` with narrowing | 5.6a TS LOWs practice.ts:22, buildContext.ts:88, practice.test.ts:464 | A |
| 5 | Practice keys out of the do-not-say prompt; stream gate and postGuard only (ADR) | 5.6 MEDIUM compose.ts:220 | B |
| 6 | Carry a skipped item's key for one turn | 5.6 LOW runner.ts:1135 | B |
| 7 | expectNoLeak scans skill events and every issued key (generated too), on every tier | 5.6 LOW runner.practiceAnswerKey.test.ts:133 | B |
| 8 | `assemble` builds TurnContext from an **allow-list** of TurnContextSchema keys, not a deny-list; a test that a BuiltContext with every optional field set still assembles | 5.6a TS MEDIUM runner.ts:1248-1250 | B |
| 9 | Ingest bank refusal: fold the title and text first (NFKC, drop `\p{Cf}`), match path segments case-insensitively, and allow quotes and a space before the colon | 5.6a security MEDIUM answerBank.ts:18-25 | C |
| 10 | Ingest tests: real bank files refused under a neutral title (proves the shape rule); `CONTENT_ROOT` from `import.meta.url`; the shape check on raw lines (start of line, optional `- `) so prose "a question: … the answer: …" is not refused | 5.6a TS LOWs answerBank.test.ts:8,16-30; security LOW answerBank.ts:18 | C |

Not in scope:
- the `practice@1.1.0` code-output sentence (LOW): that is the human's B-26 sign-off;
- matcher changes, including spelled and roman forms, homoglyphs and answer-context mode: 5.6b;
- short or common text keys ('a', 'True') dropping most chunks: 5.6b, per the lead;
- JSON-bank and markdown-table refusal: 8.x upload scope, per the lead;
- the exempt literal forms of short numeric keys (security LOW buildContext.ts:85): 5.6b, or a log line;
- the chunk-straddle check: 5.6b;
- `chunkDocument` defence in depth (security LOW ingest/index.ts): 8.x;
- the `types.ts` `answerKeyDropped` doc LOW: that file is not otherwise touched.

## Phase A: bank and item checks (harness tools, no risky paths)
Files:
- `packages/harness/src/tools/practiceItems.ts`
  - `PracticeItem` gains `readonly teacherId: string`. This is harness-internal: `toOutput` never copies it, so the tool output, the skill event and the trace are unchanged.
  - `servable` adds `item.teacherId === scope.teacherId`.
  - The generator sets `teacherId` from `scope.teacherId`.
  - **One parser.** `export function parseGeneratedId(id): { topicId, moduleId, level, a, op, b } | undefined`. It returns undefined when:
    - `id.length > PRACTICE_ID_MAX`;
    - an operand fails `[1-9]\d{0,2}` (1–999 covers every template, including the subtraction nudge);
    - `op !== TEMPLATES[level].op`;
    - the topic does not end `:practice`.

    `generatedAnswerKeyFor` uses the parser, and its comment becomes true (bounded operands, so `evaluateExpression` cannot throw).
  - **validateItem.** For every kind, reject when a key is in:
    - any option (`keyInPrompt(option, k)`);
    - the id, but only for keys that are not exempt under 5.6a's short-numeric rule.

    The id holds the level digit and the generated operands, so `'1'` would reject `demo:fractions:1:a` (Q4). The `code_output` prompt exemption and the mcq option-equality check stay.
- `packages/harness/src/tools/practice.ts`
  - Delete `GENERATED_TOPIC` and `generatedItemModuleId`; use `parseGeneratedId(id)?.moduleId`.
  - `issuedItem` `filter`s the allowed modules that resolve the id and requires **exactly one**, otherwise `undefined`.
  - The cap counts `heldKeys ∪ issuedKeys ∪ new key` against `PRACTICE_KEYS_MAX_JSON`, so Phase B's carried key always fits.
  - Import the context helpers from the new module.
- `packages/harness/src/tools/demoPracticeBank.ts`
  - `export const DEMO_PRACTICE_TEACHER_ID = 'tch_test_01'`, set on every record.
  - `pick` filters on `teacherId`; `answerKeyFor` returns `undefined` for another teacher.
- `packages/harness/src/pipeline/generate/answerKeyContext.ts` (new): `contextAnswerKeys` and `chunkLeaks`, moved verbatim from `buildContext.ts`, plus the hoisted regex constant. `pipeline/steps/buildContext.ts` changes only its import (and re-exports the helpers if its tests import them from there).
- Test fixtures that build `PracticeItem`s gain `teacherId`: `practiceItems.test.ts`, `practice.test.ts`, `demoPracticeBank.test.ts`, `registry.test.ts` if it builds one, and `pipeline/runner.practiceAnswerKey.test.ts` `RECORDS` (`'tch_test_01'`).

Tests first (Phase A):
- `demoPracticeBank.test.ts`:
  - **acceptance**: a pick for another teacher with the same module id returns nothing, and `answerKeyFor` returns nothing;
  - every record carries the constant.
- `practiceItems.test.ts`:
  - a stub bank that ignores teacherId offers another teacher's item: it is skipped and the generator steps in;
  - a generated item carries `scope.teacherId`;
  - `validateItem` rejects a key in an option;
  - `validateItem` rejects an id with a non-exempt key (`bank:one:a` with `['1','one']`);
  - `validateItem` accepts `demo:fractions:1:a` with `['1','one']`;
  - `parseGeneratedId` table: each level; 4-digit, leading-zero and wrong-op ids; a topic without `:practice`; an id over the cap; a module id containing `:`;
  - `generatedAnswerKeyFor` of a 25-digit operand id is `undefined`.
- `practice.test.ts`:
  - `issuedItem` for another teacher's bank id is `undefined`;
  - a stub bank resolving an id in two modules gives `undefined`;
  - `run` under another teacher with the same module never serves the bank item;
  - the cap counts `heldKeys`;
  - the non-null assertions are replaced.
- `answerKeyContext.test.ts`: move the helpers' existing unit tests here, or keep them in `buildContext.test.ts`. Either way coverage stays at 100%.

State after Phase A: the bank and the tool are teacher-scoped at the bank, at `pickItem` and at `issuedItem`. Items are checked against their own key on the prompt, options and id. Generated ids are bounded and parsed in one place, and tools no longer import a pipeline step. The harness gate is green. One green commit. Estimate: about 70 builder calls.

## Phase B: practice keys out of the prompt, the skipped key carried, the assemble allow-list (risky)
Needs the ADR text first (architect, at plan review). The builder writes the file.

Files:
- `docs/adr/0011-practice-keys-out-of-the-prompt.md` (new). Take the next free number at build time: 0009 is 3.11d's, 0010 is taken, and 0011 is recommended. `docs/adr/0010-practice-items-from-tool.md` gets "Amended by ADR-0011" in Status, and its Consequences bullet 1 points to ADR-0011.
- `packages/harness/src/pedagogy/helpState.ts`
  - New optional field `practiceCarriedKey: z.array(z.string()).max(64).exactOptional()`.
  - `parseSessionHelp` keeps it; `copyHelp` copies it.
  - `practiceFields` leaves it out, so it lasts exactly one turn.
  - Doc comment: `answerKey` plus `practiceCarriedKey` stay within `PRACTICE_KEYS_MAX_JSON` (Phase A's cap).
- `packages/harness/src/pedagogy/policy.ts`
  - `PolicyResult` gains `promptKeys: string[]`.
  - In `finish` and `fallbackPolicy`, `mustNotReveal` = today's value ∪ `help.practiceCarriedKey`. A carried key is never released, even by a solution move.
  - `promptKeys` is `[]` when `holdsPracticeKey(help)`, and otherwise `mustNotReveal` minus the carried keys (Q2).
- `packages/harness/src/pedagogy/compose.ts`: render `do-not-say` from `policy.promptKeys`, and update the 3.6 comment. `decide.ts` still copies `mustNotReveal` into the decision, so the gate and postGuard are unchanged.
- `packages/harness/src/pipeline/runner.ts`
  - (6) In `withPractice`: when an item is issued and the loaded state `holdsPracticeKey`, set `practiceCarriedKey` to the loaded `answerKey` minus this turn's issued keys (omit it when empty). The no-issue branch drops it. `answerKey` stays the new items' keys only, so `classifyAttempt` grades the new item alone.
  - (8) In `assemble`: build the TurnContext input by picking only `Object.keys(TurnContextSchema.shape)` from Entitled plus BuiltContext (one small helper), replacing the deny-list `delete`s. A new BuiltContext field can then never push a turn to the fallback context.

    **Behaviour change (Q7):** a turn with an unreadable help state stops going to `fallbackContext`. It gets the real context with 5.6a's `retrieved: []`, and the reply is still held whole (`loadedStop === null`). It still fails closed, but now as documented.
- `packages/harness/src/pipeline/steps/decide.ts`: no logic change expected.

Tests first (Phase B):
- `compose.test.ts`:
  - a held practice key leaves the prompt with neither the key nor the do-not-say section;
  - a carried key is not rendered;
  - a non-practice key is still rendered (3.6 regression).
- `policy.test.ts`:
  - `mustNotReveal` holds both the practice and carried keys, while `promptKeys` holds neither;
  - a solution move keeps a carried key;
  - `fallbackPolicy` keeps it.
- `helpState.test.ts`:
  - the field parses, is bounded and survives `copyHelp`;
  - an old blob parses;
  - `practiceFields` leaves it out;
  - the "every practice limit" state, now with a carried key, still serialises.
- `pipeline/runner.practiceAnswerKey.test.ts`:
  - **expectNoLeak (7)**: it takes every issued key (`commit.next.help.answerKey` and `generatedKeys`), scans the skill events' JSON, and scans **every** tier's requests on turns where the model never writes the key. The echo tests keep main-tier only, with the existing comment.
  - **acceptance**: a later turn with the real `defaultSteps.decide` (fixture packs) and a loaded practice key. No request on any tier contains the key; when the model writes it, the reply is the safe hint.
  - **skipped item (6)**: turn 1 loads key A and issues B, so the saved `answerKey` is B's key and `practiceCarriedKey` is `[A]`. Turn 2: the model writing A is held, the prompt holds neither key, and the saved state has no carried key. B's key as the student's answer is graded `correct`.
- The runner assemble test file (the builder picks the existing one that covers `assemble`):
  - **(8)** a BuiltContext with **every** optional field set (`helpStateUnreadable`, `answerKeyDropped`, and whichever others exist at build time) assembles to the real context, not the fallback;
  - an unreadable help state turn has `retrieved: []` and holds the whole reply;
  - a guard test: the allow-list equals `TurnContextSchema`'s keys, so a new contracts field is not silently dropped.

State after Phase B: no practice key is rendered in the prompt. Practice keys and a skipped item's key are guarded by the gate and postGuard only (ADR-0011). `assemble` uses an allow-list. Harness gate and ADR headings pass. One green commit. Estimate: about 95 builder calls.

## Phase C: ingest bank refusal hardening (packages/ingest, no risky paths)
Independent of A and B, so it can run in parallel with Phase A (lead's choice). Each phase runs `git pull --rebase` before pushing.

Files:
- `packages/ingest/src/answerBank.ts`
  - **Fold** the title and the text before every check: NFKC, then remove `\p{Cf}` (zero-width and format characters).
  - **Title rule**: split on `/` and `\`. Compare segments case-insensitively against `question-bank` and `rubric-answers`, and match the `.yaml`/`.yml` suffix case-insensitively.
  - **Shape rule**: run it on the raw source lines where the source is markdown or text, so YAML line structure is kept (security LOW 12). A line matches when, at the start of the line, there is an optional `- `, an optional quote, a key, an optional quote, optional whitespace and then `:`. The keys are `question` and `answer` (both required), or `studentAnswer` and `rubricNotes` (both required), all case-sensitive as today. Parsed units stay the input for PDF, DOCX and slides, which have no raw lines.

    If raw text is not available at the call site in `indexDocument`, the builder passes it through: one call-site change in `packages/ingest/src/index/indexDocument.ts`.
  - The refusal message stays fixed, with no input text.
- `packages/ingest/test/answerBank.test.ts`
  - `CONTENT_ROOT` comes from `new URL('../../../content/demo-teacher/', import.meta.url)`.
  - An `it.each` over the real demo bank files under the neutral title `notes.md` (proves the shape rule).
  - New refused cases:
    - `"question": … "answer": …` as quoted YAML;
    - `question :` with a space before the colon;
    - a zero-width character inside `ans​wer:`;
    - a title `bank.yaml​`;
    - `Question-Bank/x.md`;
    - `RUBRIC-ANSWERS\x.md`;
    - a fullwidth `ｑｕｅｓｔｉｏｎ:` (NFKC).
  - New passing cases: prose "a question: what is x? the answer: 7" inside a paragraph; every demo `notes.md`.
  - Documented as not refused (8.x): a JSON array bank and a markdown table bank, each with a comment.

State after Phase C: the known bypasses are closed except JSON and table banks, which are logged for 8.x. The ingest gate is green. One green commit. Estimate: about 35 builder calls.

**Order:** A and C run first, in parallel if two builders are free. B runs after A, because Phase A's cap supports Phase B's carried key. Branch: `m5/5.6c-practice-followups`. Each phase gets a fresh builder that reads this plan and the earlier handoff sections.

## Out of bounds
- `packages/contracts/**`: no contracts change (`PedagogyDecision.mustNotReveal` is unchanged, and the allow-list reads `TurnContextSchema` without changing it).
- `content/**`: no pack text, no new set.
- `packages/content/**` and `packages/db/**`.
- `packages/harness/src/guardrails/**`.
- `pipeline/generate/answerKey.ts`: no matcher change, which is 5.6b.
- `pipeline/steps/buildContext.ts` logic: an import change only.
- `.claude/**`.

## Risky paths touched
Every planned path was checked against `.claude/skills/merge-gate/risk-paths.txt`:

| Path | Group | Reviewers required |
|------|-------|--------------------|
| `packages/harness/src/pedagogy/helpState.ts`, `policy.ts`, `compose.ts` and their tests (Phase B) | `packages/harness/src/pedagogy/**` | code-reviewer |
| `docs/adr/0011-practice-keys-out-of-the-prompt.md` (new), `docs/adr/0010-practice-items-from-tool.md` (Phase B) | `docs/adr/**` | architect, security-reviewer, typescript-reviewer |

These paths match no group:
- `packages/harness/src/tools/**`;
- `packages/harness/src/pipeline/**` (runner.ts, steps/buildContext.ts, steps/decide.ts, generate/answerKeyContext.ts and their tests);
- `packages/ingest/**`;
- `docs/tasks/5.6c/**`.

Phases A and C touch no risky path.

`review.md`'s `Reviewers:` line must name **architect, security-reviewer, typescript-reviewer, code-reviewer**.

**Planned handoff decision (`risk: high`):**
> ### <date> · 5.6c Practice keys stay out of the prompt; a skipped item's key is guarded one more turn (ADR-0011) · decided by lead (architect review)
> Decided: compose renders the do-not-say list from `PolicyResult.promptKeys`, which leaves out every practice key and carried key. Those keys are still in the decision's `mustNotReveal`, so the stream gate and postGuard guard them. When a new item replaces an unsolved one, the old key is saved as `practiceCarriedKey` and guarded for exactly one more turn, never in the prompt and never released. Non-practice keys keep the 3.6 behaviour. No contracts change and no pack or set change.
> Why: a key in the prompt can be spelled or written in roman numerals by an injected model, and the matcher can miss those forms (5.6 security-reviewer). A skipped item's answer was unguarded the turn after.
> risk: high

Also logged:
- `risk: medium`: `assemble` builds TurnContext from an allow-list, so an unreadable help state now gets the real context with no retrieved chunks and a held reply, instead of the fallback context;
- `risk: medium`: the ingest refusal folds the title and text and matches more key forms; JSON and table banks are left to 8.x;
- `risk: low`:
  - `PracticeItem.teacherId`, with `DEMO_PRACTICE_TEACHER_ID = 'tch_test_01'`;
  - validateItem's id check skips exempt short numeric keys;
  - `parseGeneratedId` bounds;
  - exactly one module, and the cap counts held keys;
  - the context helpers move to `pipeline/generate/answerKeyContext.ts`.

## Draft ADR-0011 (for the architect to confirm or replace)
- **Status:** Proposed. Amends ADR-0010 (Consequences bullet 1; §4's "then `mustNotReveal`" now means the guards, not the prompt).
- **Context:** ADR-0010 left the raw practice key in later turns' do-not-say block. The matcher can miss a spelled or roman form, so an injection could get the key out (5.6 review, security-reviewer). Also, a new item replaced the earlier key, so a skipped item's answer was unguarded on the next turn.
- **Decision:**
  1. Practice keys and carried keys are never rendered in the system prompt. Compose renders only `promptKeys`. The guards get the full `mustNotReveal`.
  2. A skipped item's key is kept in `HelpState.practiceCarriedKey` for one turn: guarded and never released, kept out of the prompt and out of attempt grading.
  3. Other answer keys keep the 3.6 behaviour.
  4. No contracts, pack or set change.
- **Alternatives:**
  - Drop the block for every key: it changes 3.6 with no current need.
  - Union the carried key into `answerKey`: it breaks `classifyAttempt`, which needs every key part to match.
  - Hash the keys in the prompt: the list would be useless to the model.
  - A new pack version: the pack text is unchanged, and the composed prompt is stored on each turn's decision.
- **Consequences:**
  - The model is no longer told the answer it must avoid. It is protected only by the pack rules and the matcher.
  - A model that computes and spells an answer is still a matcher gap (5.6b).
  - Replaying a set@1.1.0 turn recorded before this change composes a different prompt; the recorded `systemPrompt` is the source of truth.
  - The safety pack's references to "the do-not-say list" are harmless when the list is absent.
- **Reviewers:** architect, security-reviewer, typescript-reviewer. Logged `risk: high`.

## Does this need an ADR? (CLAUDE.md rule 2)
Yes. The pack files do not change, but what the composer puts in the model's prompt on practice turns does. ADR-0010's Consequences describe that block and say a change "takes ... an ADR that supersedes this one". A new ADR-0011 that amends ADR-0010 is the light form (Q1). Items 8 to 10 need no ADR: they change no contracts and no prompt.

## Open questions (each with a recommendation; none blocks Phase A or C)
- **Q1, ADR form.** Recommend a new ADR-0011 that amends ADR-0010, with no new pack version or set.
- **Q2, which keys leave the prompt.** Recommend practice keys and carried keys only, so other keys keep the 3.6 behaviour. Nothing else sets `answerKey` today, so in practice the block disappears.
- **Q3, scope of "any model request".** Recommend "the harness never sends the key". Three things stay out of scope and are documented in the ADR: the small-tier rewrite of a draft in which the model wrote the key, the student's own message, and 5.6a's exempt short numeric keys in chunks. Covering the rewrite would mean answerLeak skips the rewrite while a practice key is held. That edits `guardrails/**` (code-reviewer) and adds about 10 calls.
- **Q4, the id check.** Recommend checking only non-exempt keys against the id, because ids hold the level digit and the operands. Options are checked with every key.
- **Q5, the carried key.** Recommend exactly one turn, stored apart from `answerKey`. The size is covered by Phase A's cap counting held keys. On a turn that saves no state, the stored carried key stays (fail closed).
- **Q6, the demo teacher id.** Recommend `'tch_test_01'` (the contracts fixture teacher).
- **Q7, an unreadable help state after the allow-list.** Recommend accepting the change: the real context with `retrieved: []` and a held reply, tested. Alternative: keep the fallback by branching on `helpStateUnreadable` explicitly, which is more code for the same safety.
- **Q8, ingest shape rule on raw lines.** Recommend raw lines for markdown and text, which closes the prose false refusal and keeps the YAML structure. If `indexDocument` cannot pass raw text without a wider change, keep parsed units and leave the false refusal as a LOW.
