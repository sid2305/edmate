# 5.6c handoff

## Phase C

Status: DONE.

Scope: items 9 and 10 (ingest bank refusal hardening), `packages/ingest` only, no risky paths.

Changes:
- `packages/ingest/src/answerBank.ts`: title and text are folded (NFKC, then `\p{Cf}` dropped)
  before every check. `namesABankPath` compares path segments and the `.yaml`/`.yml` suffix
  case-insensitively. `hasBankShape` runs a line-anchored check (`hasBankShapeInLines`) when raw
  source text is given: a key must start its own (trimmed) line, after an optional `- ` list
  marker and an optional quote. When raw text is not available (PDF, DOCX, slides), it falls back
  to the previous word-boundary check over the parsed units' joined text. `assertNotAnswerBank`
  gains an optional third `rawText` parameter; its public contract and thrown error are unchanged.
- `packages/ingest/src/index/indexDocument.ts`: decodes the markdown source's raw bytes (stripping
  a leading BOM) and passes that text through to `assertNotAnswerBank` as `rawText`. No other
  source kind (`parsed`, `video`, pdf/docx/pptx `DocumentInput`) has raw lines available at this
  call site, so they keep the units-only fallback, as the plan allows for Q8.
- `packages/ingest/test/answerBank.test.ts`: `CONTENT_ROOT` now comes from
  `new URL('../../../content/demo-teacher/', import.meta.url)` instead of a cwd-relative string.
  Added: the real demo bank files refused under the neutral title `notes.md` (proves the shape
  rule, not just the title rule); quoted YAML keys; a space before the colon; a zero-width
  character inside a key; a fullwidth `question:`; an indented list-item key; prose mentioning
  "question:"/"answer:" mid-sentence (now passes); title case-insensitivity
  (`Question-Bank/x.md`, `RUBRIC-ANSWERS\x.md`); a `.yaml` suffix with a trailing zero-width
  character. Two tests document the remaining 8.x gaps (compact JSON-array bank, markdown-table
  bank) with an inline comment — neither is refused by design.

Deviations from plan: none. Q8 resolved as "use raw lines" (markdown's raw bytes are available at
the `indexDocument` call site with one small call-site change, as anticipated).

Gate:
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/ingest...` → 14/14 tasks green;
  `@edmate/ingest:test` 18 files, 307 tests passed; coverage `answerBank.ts` 100/92.85/100/100,
  `indexDocument.ts` 100/92.85/100/100 (all above the package's 80% gate; the few uncovered
  branches are defensive fallbacks already exercised by other tests at the file level).
- `python3 .githooks/secret-scan.py --all` → clean.

Left to do: none for Phase C.

## Decisions

### 20 Oct 2026 · 5.6c Ingest bank refusal folds title and text, matches more key forms, raw-line shape check · decided by tdd-guide
Decided: `assertNotAnswerBank` NFKC-folds and strips zero-width/format characters from the title
and the checked text before every check; the title rule matches path segments and the YAML suffix
case-insensitively; the shape rule runs on raw source lines (key must start its own line) when the
caller has them, with a fallback to the looser word-boundary check over parsed units when it does
not (PDF, DOCX, slides). `indexDocument` passes a markdown source's decoded raw bytes through so
the line-anchored rule applies there; other source kinds keep the fallback.
Why: 5.6a's security review found the title and shape checks could be slipped by case, a
fullwidth letter or an embedded zero-width character, and the word-boundary shape check falsely
refused ordinary prose mentioning "question:"/"answer:" mid-sentence.
risk: medium
