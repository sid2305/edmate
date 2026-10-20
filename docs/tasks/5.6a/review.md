# 5.6a review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (opus), security-reviewer (opus)

All three reviewers approve. None found a CRITICAL or HIGH issue. Under the MVP-first rule, the MEDIUM and LOW findings are deferred to board tasks.

## Findings
- [MEDIUM] [deferred 5.6c] packages/ingest/src/answerBank.ts:18-25 — Some bank files get past the ingest refusal: JSON, quoted keys, `question :`, markdown tables, zero-width characters, and the title written in a different case. Fold the text (NFKC, drop format characters), match path segments case-insensitively, and allow quotes and a space before the colon. JSON and table banks go to the 8.x upload scope.
- [MEDIUM] [deferred 5.6c] packages/harness/src/pipeline/runner.ts:1248-1250 — `assemble` deletes a deny-list of keys before the strict TurnContextSchema parse, so any new BuiltContext field sends the turn to the fallback context. `helpStateUnreadable` already does this, which fails closed but isn't documented. Build TurnContext from an allow-list instead, and add a test with every optional field set.
- [LOW] [wontfix] packages/harness/src/pipeline/steps/buildContext.ts:85-89 — The short-key exemption works on a key's value, so "1.0", "007", "1e1", "10/2" and Devanagari digits are exempt as well. It is still limited to whole numbers 0–99. Accepted and logged by the lead.
- [LOW] [deferred 5.6b] packages/harness/src/pipeline/steps/buildContext.ts:151 — An exempt short number in an answer context ("the answer is 7") isn't dropped. Use numberMentions' answerContext.
- [LOW] [deferred 5.6b] packages/harness/src/pipeline/steps/buildContext.ts:96 — A long key split across two adjacent chunks gets through. Re-run the matcher on the joined kept text.
- [LOW] [deferred 5.6b] packages/harness/src/pipeline/generate/answerKey.ts — Existing matcher gaps: homoglyphs, and hyphen or underscore joins.
- [LOW] [deferred 5.6b] packages/harness/src/pipeline/steps/buildContext.ts:80-90 — Short text keys ('a', 'True') drop most chunks. This fails closed and is false-positive scope.
- [LOW] [deferred 5.6c] packages/ingest/src/answerBank.ts:18 — Prose with "question: … answer: …" is refused. Check the raw markdown lines before parsing.
- [LOW] [deferred 5.6c] packages/ingest/src/index.ts — Only indexDocument enforces the refusal. Assert it in chunkDocument too, or document that callers must go through indexDocument.
- [LOW] [deferred 5.6c] packages/harness/src/tools/practice.ts:22 — The tool imports helpers from a pipeline step. Move them to a shared module.
- [LOW] [deferred 5.6c] packages/harness/src/pipeline/steps/buildContext.ts:88 — A RegExp is rebuilt for every key. Hoist it to the module.
- [LOW] [deferred 5.6c] packages/harness/src/pipeline/types.ts:293 — The `answerKeyDropped` doc should say "integer >= 1".
- [LOW] [deferred 5.6c] packages/ingest/test/answerBank.test.ts:16-30 — The demo-bank tests pass on the title rule alone. Add cases with a neutral title.
- [LOW] [deferred 5.6c] packages/ingest/test/answerBank.test.ts:8 — CONTENT_ROOT depends on the working directory. Use import.meta.url.
- [LOW] [deferred 5.6c] packages/harness/src/tools/practice.test.ts:464-467 — Non-null assertions. Narrow with a throw instead.
