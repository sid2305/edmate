# 5.6a plan: answer keys out of retrieved context

Status: READY (open questions below have recommendations; none blocks the build)
Planner: 20 Oct 2026. Background: `docs/tasks/5.6/plan.md` (Architect review, Q-C), `docs/tasks/5.6/architect-adr-0010.md` (Q-C), `docs/adr/0010-practice-items-from-tool.md`.

## Acceptance (verbatim, board)
> a chunk containing an active or bank answer key never reaches the model context (tested); ingest refuses bank files; must land before 5.11

How it will be shown:
1. **Active key** (the key held in `help.answerKey` when the turn starts): a runner test with the scripted gateway. The stored help state holds a practice key, the retrieval stub returns one chunk whose text holds the key plus one clean chunk. The captured model request (system prompt and messages) contains the clean chunk's marker text and neither the poisoned chunk's marker text nor the key. The trace has one `answerKeyContext` guard entry (`ok: false, action: 'drop'`) and no text.
2. **Bank key** (the key of an item `practice.next_item` issues this turn, when the chunks are already in the model's context): a tool test and a runner test. A bank item whose key appears in a retrieved chunk is refused, and the next bank item or a generated variant whose key is in no retrieved chunk is served. If none qualifies, the tool fails closed with `NoPracticeItemError`.
3. **Ingest refuses bank files**: `indexDocument` rejects each `content/demo-teacher/question-bank/*.yaml` and `rubric-answers/*.yaml` (bytes given as `markdown`) and any source titled with a bank path. It throws `IngestError('validation')` and the writer is never called. All five demo `modules/*/notes.md` still index (no false refusal).
4. Before 5.11: 5.11 is still `todo`. The lead holds 5.11 until 5.6a merges (5.11 should get a dep on 5.6a, a board edit for the lead).

## Approach (MVP, fail closed, no contracts change)
- **buildContext** compiles one matcher, `compileAnswerKeys(help.answerKey)`, from the help state it already loads (`loadSessionHelp(s.helpState)`). It drops every chunk whose `text`, `source.title` or `source.locator` the matcher says `leaks`, checking each field separately, because those three fields are all the composer puts in the prompt (`compose.ts` `materialBlock`). The filter runs on `own` and `ctx` **before** `mergeByScore` and `fit`, so clean chunks fill the freed slots. The dropped count goes on `BuiltContext.answerKeyDropped` (a count only: never ids, text or keys). With no held key, the matcher is `empty` and nothing changes.
- **Unreadable help state** (`help.unreadable`): the stored blob may hold a key we cannot read, so fail closed. `retrieved` is `[]`, and the dropped count is the number of chunks found. Recommendation Q3.
- **Runner** records one guard trace entry, `{ name: 'answerKeyContext', ok: false, action: 'drop' }`, when `answerKeyDropped > 0`. `GuardTrace.name` is a free `z.string()` in contracts, so there is no contracts change.
- **practice.next_item, in turn**: `AcceptItem` becomes `(item, answerKey) => boolean`. `pickItem`/`servable`/`generateItem` already hold the key, so it is passed through. The tool's `accept` also refuses an item when its key leaks in any `ctx.retrieved` chunk (same three fields). The existing loop handles it: next bank pick, then up to `GEN_VARIANTS` generated variants, then `NoPracticeItemError` ("no item ready").
- **Ingest**: a new `packages/ingest/src/answerBank.ts` with `assertNotAnswerBank(sourceTitle, units)`, called in `indexDocument` on every source kind after parsing and before chunking. It refuses (`IngestError('validation', false, 'practice banks and answer keys are never indexed')`, a fixed message with no input text) when either:
  - the title names a bank path: a path segment `question-bank` or `rubric-answers`, or a `.yaml`/`.yml` name; or
  - the parsed text has the content-pack bank shape: line-start YAML keys `question:` **and** `answer:` (QuestionBankItem), or `studentAnswer:` **and** `rubricNotes:` (RubricAnswer), case-sensitive, optional leading `- `.

  Checked: none of the demo notes has such lines.

## Locked probe and precedence (3.4c): unchanged, and why
- `probeLocked(student)` runs on the student's own words and returns `{ hit, score }` only. The drop never touches it, so `lockedHit` and locked precedence (`probe.hit ? own : merge`) are exactly as before. A dropped chunk can neither create nor hide a locked hit.
- On a locked hit, only `own` is used. A dropped `own` chunk is **not** backfilled from `ctx`, which keeps 3.4c's rule that the agent-widened search never adds material on a locked turn.
- On a non-locked turn, `ctx` may fill a slot freed by a dropped `own` chunk. That is 3.4c's "only adds coverage", and `ctx` chunks pass the same filter.
- A chunk found by both searches has the same text, so it is dropped from both. `mergeByScore` cannot bring it back.
- Side effects to accept: fewer or no chunks can make `isCovered` false. Grounding A then sends `hint`/`worked_example`/`explain` to the ask-teacher reply, and `generate.ts` treats empty `retrieved` as its no-material case. `practice.ts preferredModule` reads `ctx.retrieved[0]`, so a drop can change which module the next item comes from (it falls back to the active or first allowed module). All of these fail closed.

## Known false positives (5.6b)
The matcher has no "retrieved material" mode. A one-digit key matches **any** bare digit (`m.kind === 'digits'`). With the demo key `['1','one']` held, almost every Python chunk drops (any "1"), and `'7'` drops every chunk containing a 7. Multi-digit keys (`'60'`) and arithmetic text ("3 + 4" evaluates to 7) also drop chunks that only mention the number. On those turns, hints go to ask-teacher. This is accepted for the MVP: it fails closed and is visible in the trace as an `answerKeyContext` entry. Recommendation: add an answer-context-only mode for short numeric keys in retrieved material to 5.6b's scope (Q2). Do not loosen the matcher in this task.

## Files
Phase A (harness):
- `packages/harness/src/pipeline/steps/buildContext.ts`: add the filter (a small exported helper `dropAnswerKeyChunks(chunks, matcher)` in this file, for unit tests), the unreadable rule and `answerKeyDropped`.
- `packages/harness/src/pipeline/types.ts`: `BuiltContext.answerKeyDropped?: number` with a doc comment (a count only).
- `packages/harness/src/pipeline/results.ts`: `BuiltContextSchema`, `answerKeyDropped: z.int().min(1).exactOptional()`.
- `packages/harness/src/pipeline/runner.ts`: after `check(bcRaw, …)`, add the one trace entry when `bc.ok && bc.value.answerKeyDropped !== undefined`.
- `packages/harness/src/tools/practiceItems.ts`: `AcceptItem` takes `(item, answerKey)`; `servable` passes it.
- `packages/harness/src/tools/practice.ts`: `accept` also checks `ctx.retrieved`.

Phase B (ingest; independent of A, can run in parallel):
- `packages/ingest/src/answerBank.ts` (new), `packages/ingest/src/index/indexDocument.ts` (one call), `packages/ingest/src/index.ts` (export, if the tests import from the package root).

Out of bounds: `packages/contracts/**`, `docs/adr/**`, `packages/harness/src/guardrails/**`, `packages/harness/src/pedagogy/**` (read only), `pipeline/generate/answerKey.ts` (no matcher change; 5.6b), `content/**`, `packages/content/**`, `packages/db/**`, the 5.6c items (do-not-say prompt, skipped-key carry).

## Tests first
Phase A:
- `buildContext.test.ts`:
  - (a) a held text key drops a chunk holding it, keeps a clean one, and sets `answerKeyDropped: 1`;
  - (b) the key only in `source.title` (or `locator`) also drops;
  - (c) a key in a zero-width-split or base64 form drops (the shared matcher);
  - (d) no held key: output identical to today, no `answerKeyDropped`;
  - (e) a locked hit: `lockedHit` stays true, the dropped `own` chunk is not backfilled from `ctx`, and the probe is called once with the student's words;
  - (f) non-locked: a `ctx` chunk fills the freed slot;
  - (g) a chunk in both `own` and `ctx` is dropped once and never returns;
  - (h) unreadable help state: `retrieved: []`, `helpStateUnreadable: true`;
  - (i) the one-digit false-positive case, written down as current behaviour (`'1'` drops a `range(1, 5)` chunk), pointing to 5.6b.
- `practice.test.ts` / `practiceItems.test.ts`:
  - a bank item whose key is in a retrieved chunk is skipped for the next valid one;
  - a generated item whose key is in a chunk moves to the next variant;
  - when every candidate is blocked, `NoPracticeItemError`;
  - `accept` receives the key (signature).
- `runner.practiceAnswerKey.test.ts` (or a new `runner.answerKeyContext.test.ts`):
  - active key: the captured model request has no poisoned chunk text or key, and the trace has the `answerKeyContext` entry and no text;
  - in turn: the tool issues a key-free item while a chunk holds the first bank item's key;
  - the existing locked and grounding runner tests stay green.

Phase B:
- `packages/ingest/test/answerBank.test.ts`: each demo question-bank and rubric-answers YAML is refused; titles `question-bank/loops.yaml`, `rubric-answers\x.yml` and `bank.yaml` are refused; each demo notes.md passes; a worksheet with a single `Answer: 7` line passes (documented, Q4).
- `indexDocument.test.ts`: a refused source never calls `writer.insertMany` or the embedder, and the error JSON holds no input text.

Commands: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/harness...` (Phase A) and `--filter=@edmate/ingest...` (Phase B); `python3 .githooks/secret-scan.py --all`.

## Phases (sizing, task 0.15)
About 9 source files across 2 packages, so 2 phases. Each is small (A: 6 files, about 120 lines plus tests; B: 2–3 files). They touch different packages, so they can run in parallel. Each gets its own green commit and its own handoff section:
- **State after A:** held and in-turn keys never reach model context; trace reports drops.
- **State after B:** ingest refuses bank files.

If the lead prefers one builder, B fits in the same run (B adds about 20 tool calls).

## Risky paths touched
None of the planned paths matches `.claude/skills/merge-gate/risk-paths.txt` (checked: `packages/harness/src/pipeline/**`, `packages/harness/src/tools/**` and `packages/ingest/**` are not listed; `guardrails/**`, `pedagogy/**`, `contracts/**` and `docs/adr/**` are out of bounds). The board marks the task `risk: risky`, so the handoff still logs a `risk: high` decision ("buildContext drops answer-key chunks; tool refuses items whose key is in context; ingest refuses bank files"). Reviewers: code-reviewer (every PR); security-reviewer is recommended by choice because this is a leak path, though the gate does not require it.

## Decisions to log (handoff)
- `risk: high`: drop-before-merge, the three fields checked, the unreadable state drops all chunks, the trace guard name `answerKeyContext`, no backfill on a locked hit, the in-turn tool refusal, and the ingest name and shape rule.

## Open questions (recommendations; not blocking)
- **Q1, "bank answer key" meaning.** Recommend: the key held this turn plus the key of any item issued this turn (tool refusal). Not "every key in the bank": keys like `'1'` and `'7'` would drop almost all material, and the bank is not chunked anyway.
- **Q2, one-digit and numeric false positives.** Recommend: accept fail-closed now and widen 5.6b to add a retrieved-material mode (answer-context only for short numeric keys). The lead edits the board.
- **Q3, unreadable help state.** Recommend: drop all retrieved chunks that turn (fail closed). This is rare, and the runner already holds the whole reply.
- **Q4, ingest rule scope.** Recommend: a name and shape refusal only. Teacher worksheets with answer lines (the latent `material` path) are not refused here; that is a product call for 8.x uploads.
- **Q5, risk-paths.** `pipeline/**` and `tools/**` are not in risk-paths.txt (5.6 Q5 kept `tools/**` out). Recommend: no change now; revisit at 13.3.

## Lead answers (20 Oct 2026)
- Short keys: the chunk filter in buildContext and the practice tool's "key in this turn's chunks" refusal check only keys whose normalised form is 3 or more characters, or is not purely numeric. Short numeric keys ("1", "7", "42") are not used to drop chunks or refuse items. They are still held by the stream gate and postGuard on everything the model says. Why: the demo key "1" would drop almost every chunk and push hints to ask-teacher; a chunk that happens to contain "7" doesn't give away an item's answer. The bank itself is never chunked (Phase B). Log this as a risk: high decision.
- Q1: yes, the key held now plus any key issued this turn. Q3: yes, fail closed. Q4: yes, not refused; this is a product question for 8.x. Q5: yes, no risk-paths change.
- Reviewers: code-reviewer, typescript-reviewer and security-reviewer. The handoff logs risk: high.
- Phases A (harness) and B (ingest) run in parallel on the same branch. Each runs `git pull --rebase` before pushing.
