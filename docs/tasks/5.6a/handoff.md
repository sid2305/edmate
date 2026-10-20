# 5.6a handoff

## Phase B

Status: DONE

Acceptance evidence:

```
$ PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH corepack pnpm turbo run typecheck lint test --filter=@edmate/ingest... --force --concurrency=1
@edmate/ingest:test:  ✓ test/answerBank.test.ts (23 tests) 36ms
@edmate/ingest:test:  ✓ test/index/indexDocument.test.ts (21 tests) 57ms
@edmate/ingest:test:  Test Files  18 passed (18)
@edmate/ingest:test:       Tests  286 passed (286)
@edmate/ingest:test:  answerBank.ts     |     100 |       90 |     100 |     100 | 24
@edmate/ingest:test:  indexDocument.ts  |     100 |    96.15 |     100 |     100 | 156
 Tasks:    14 successful, 14 total

$ python3 .githooks/secret-scan.py --all
(clean, no output)
```

Changes:
- `packages/ingest/src/answerBank.ts` (new): `assertNotAnswerBank(sourceTitle, units)` refuses by
  title (a `question-bank`/`rubric-answers` path segment, or a `.yaml`/`.yml` file name) or by the
  parsed content-pack bank shape (`question:` + `answer:`, or `studentAnswer:` + `rubricNotes:`,
  matched case-sensitively as YAML mapping keys). Throws a fixed `IngestError('validation', …)` that
  never quotes the title or any unit text.
- `packages/ingest/src/index/indexDocument.ts`: parses the source first, then calls
  `assertNotAnswerBank(parsed.sourceTitle, parsed.units)` before `chunkDocument`, so a refused
  source is never written or embedded.
- `packages/ingest/src/index.ts`: exports `assertNotAnswerBank`.
- `packages/ingest/test/answerBank.test.ts` (new): refuses every demo `question-bank/*.yaml` and
  `rubric-answers/*.yaml`; refuses titles `question-bank/loops.yaml`, `rubric-answers\x.yml` and
  `bank.yaml`; passes every demo `modules/*/notes.md`; passes a worksheet with a single capitalised
  `Answer: 7` line and a single lowercase `answer: 7` line (no matching `question:`); checks the
  thrown error's JSON carries no input text.
- `packages/ingest/test/index/indexDocument.test.ts`: one new test, a question-bank source is
  refused with the writer and embedder never called.

Deviations:
- The plan describes the shape check as "line-start YAML keys". Tracing `parseMarkdown` on the
  real demo `question-bank/*.yaml` files (read as `markdown`, as the plan directs) showed that
  `question:` is never at a true parsed-text line start — `- id:`, `moduleId:` and `question: |`
  always soft-wrap onto one markdown paragraph when there is no blank line between them in the
  source YAML, which is the case in every demo bank file. A strict `^question:` check would never
  fire and the acceptance case ("ingest refuses bank files") would fail. The shape check instead
  matches `question:`/`answer:`/`studentAnswer:`/`rubricNotes:` as a whole YAML-style key (a word
  boundary before the key, so it cannot match inside another word, e.g. "subquestion:"), still
  case-sensitive, still requiring both keys of a pair present. This is verified against every demo
  bank file (refused) and every demo notes.md (not refused), plus the worksheet case in Q4.

## Phase A

Status: DONE

- Branch: `m5/5.6a-keys-out-of-context` (built on `work-5.6aA`)
- Worktree: `.claude/worktrees/agent-a16faa17ec58c0e14`
- Builder: tdd-guide

### Acceptance evidence
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --force --concurrency=1`
  → `Test Files 107 passed (107)`, `Tests 4770 passed (4770)`, `Tasks: 10 successful, 10 total`
- Coverage of touched files: `buildContext.ts` 100% lines (95.7% branches; the two uncovered
  lines are the old `mergeByScore` sort branches), `practice.ts` 100%, `practiceItems.ts` 100%,
  `runner.ts` 99.5% lines.
- `python3 .githooks/secret-scan.py --all` → clean.
- Active key (acceptance 1): `runner.answerKeyContext.test.ts` runs the real buildContext, decide,
  generate and postGuard with the scripted gateway. The main model request holds the clean
  chunk's marker and the `[[MATERIAL]]` block, never the poisoned chunk's marker, and never the
  key outside the do-not-say list. The trace holds exactly one
  `{ name: 'answerKeyContext', ok: false, action: 'drop' }` and no marker or key.
- Bank key (acceptance 2): `practice.test.ts` (bank item skipped for the next when its key is in
  a chunk's text, title or locator; a generated variant moves on; a short numeric key does not
  refuse), `practiceItems.test.ts` (`accept` gets the key; all refused → `undefined`, which the
  tool turns into `NoPracticeItemError`), and the runner test (a chunk holding the bank item's
  key makes the tool issue a generated, key-free item).
- `buildContext.test.ts` cases (a)–(i) from the plan; (i) now shows the lead's short-key rule.
  The 3.4c locked and dilution tests are unchanged and green.

### Changes
- `pipeline/steps/buildContext.ts`: `contextAnswerKeys` (drops short numeric keys),
  `chunkLeaks` (text, source title, locator), `dropAnswerKeyChunks`; the filter runs on `own` and
  `ctx` before `mergeByScore`/`fit`; an unreadable help state gives no chunks; `answerKeyDropped`.
- `pipeline/types.ts`, `pipeline/results.ts`: `BuiltContext.answerKeyDropped?: number` (int ≥ 1).
- `pipeline/runner.ts`: one `answerKeyContext` guard entry when chunks were dropped;
  `assemble` strips `answerKeyDropped` (TurnContext is strict).
- `tools/practiceItems.ts`: `AcceptItem` is `(item, answerKey) => boolean`.
- `tools/practice.ts`: `accept` also refuses an item whose key leaks in any `ctx.retrieved` chunk.
- Tests: `buildContext.test.ts`, `practice.test.ts`, `practiceItems.test.ts`, new
  `runner.answerKeyContext.test.ts`.

### Deviations
- `assemble` in `runner.ts` deletes `answerKeyDropped` before the strict `TurnContextSchema`
  parse (not in the plan; without it every drop turned into the fallback context).
- An existing `practice.test.ts` fixture used the key `'a'`, which the contracts fixture chunk
  holds as a word; it is now `'qzx'` so that test still checks `options`.
- The do-not-say block of the system prompt still names the active key (by design today; the
  prompt change is 5.6c). The runner test checks everything outside that block.
- With no material left, the plan's "every candidate blocked → NoPracticeItemError" can't be
  shown through the tool with real generated items (their keys are mostly short numbers, which
  are not checked); it is shown at `pickItem` level, and the tool's existing fail-closed test
  covers the error mapping.

## Decisions

### 20 Oct 2026 · 5.6a ingest refuses practice banks and answer keys · decided by tdd-guide
Decided: `indexDocument` calls `assertNotAnswerBank(sourceTitle, units)` on every parsed source,
after parsing and before chunking, refusing by title (a `question-bank`/`rubric-answers` path
segment, or a `.yaml`/`.yml` name) or by parsed shape (`question:`+`answer:`, or
`studentAnswer:`+`rubricNotes:`, case-sensitive, matched as a YAML key rather than requiring a
literal line start). The refusal is a fixed, non-leaking `IngestError('validation', false, …)`.
Why: the board acceptance requires ingest to refuse bank files before 5.11; a literal line-start
regex does not fire on the real demo bank files once markdown-parsed (soft-wrapped YAML lines
merge into one paragraph), so the shape check uses a word-boundary key match instead, verified
against all five demo question-bank/rubric-answers pairs and all five demo notes.md files, plus
the Q4 worksheet case (a capitalised or unmatched lowercase "Answer:"/"answer:" line is not
refused).
risk: high

### 20 Oct 2026 · 5.6a answer-key chunks dropped before the model sees them · decided by tdd-guide · risk: high
Decided: buildContext drops every retrieved chunk whose text, source title or locator reveals the held answer key (shared `answerKey.ts` matcher), before the merge and the fit, so clean chunks fill the slots. On a locked hit a dropped own chunk is not backfilled from the context search (3.4c unchanged). An unreadable help state gives no chunks that turn. The runner records one `answerKeyContext` guard entry (`ok: false, action: 'drop'`), no count or text. `practice.next_item` also refuses an item whose own key shows in any of this turn's chunks, then tries the next bank item or generated variant, else fails closed. Short numeric keys ("1", "7", "42") are not used for either check: a key is skipped when it reads as a whole number of one or two digits, in digits or in words ("one", "forty-two"); 3+ digit numbers, decimals, fractions, negatives and any text key are used. The stream gate and postGuard still hold every key.
Why: the lead's answer of 20 Oct. A short key would drop almost every chunk and push hints to ask-teacher, and a chunk that happens to hold "7" doesn't give an item's answer away. Number words count as their value, otherwise the demo key ["1", "one"] would still drop every chunk with a "1". The bank itself is never indexed (Phase B).
risk: high

### 20 Oct 2026 · 5.6a answerKeyDropped stays out of TurnContext · decided by tdd-guide
Decided: `BuiltContext.answerKeyDropped` is a runner-only count; `assemble` strips it before the strict `TurnContextSchema` parse, and only the guard entry reaches the trace.
Why: TurnContext is a strict contracts schema (no contracts change allowed), and the count is only needed to decide whether to log the drop.
risk: low

### 20 Oct 2026 · 5.6a short-key exemption covers whole numbers 0–99 in any written form · decided by lead · risk: high
Decided: The exemption works on a key's value, so any key equal to a whole number from 0 to 99 is exempt, however it's written: digits, number words, "1.0", "007", "1e1", "10/2", Devanagari or Arabic-Indic digits. Exempt keys are not used to drop chunks or refuse items. The stream gate and postGuard still hold every key (packages/harness/src/pipeline/steps/buildContext.ts).
Why: The security review confirmed the exemption is limited to 0–99 and that every other key is still checked. Exempting only the literal digit form would bring back the "drop every chunk with a 1" problem for keys like ["1","one","1.0"].
risk: high. A short number in an answer context ("the answer is 7") can still reach the context. 5.6b closes this.

### 20 Oct 2026 · 5.6a merge with the review MEDIUMs deferred to 5.6c · decided by lead · risk: high
Decided: Merge 5.6a with the two MEDIUMs (ingest bank-refusal bypasses; the `assemble` deny-list) and the related LOWs deferred to 5.6c. The matcher false-positive and gap LOWs go to 5.6b.
Why: All three reviewers approve, and there are no CRITICAL or HIGH findings. Nothing can upload files until 8.x, and 5.6c lands before any real practice bank.
risk: high. Until 5.6c, a bank file in an unusual format could still be indexed. The gate and postGuard still hold the reply.
