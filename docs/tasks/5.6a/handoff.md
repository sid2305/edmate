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
