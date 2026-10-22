**Status:** DONE

## Summary

Six small LOW follow-ups from the 5.6c review, each the minimal change plus a test where behaviour changed:

1. `helpState.ts` — `practiceCarriedKey` entries now use `z.string().min(1)` (an empty string is refused). Test added in `helpState.test.ts`.
2. `assemble.test.ts` — the allow-list test now also asserts a literal key list (not the schema's keys against themselves), in addition to the existing self-check.
3. `assemble.ts` — the compile-time guard now also checks value types (homomorphic mapped type over `TurnContext`, `-?` to strip optionality so the index access can't silently include `undefined`), still type-only (no runtime change).
4. `indexDocument.ts` — removed the redundant BOM `.replace(/^﻿/, '')` after `TextDecoder` (its default `ignoreBOM: false` already strips a UTF-8 BOM). Added a test in `indexDocument.test.ts` proving a BOM-prefixed markdown document indexes with the BOM gone from the stored chunk text.
5. `helpState.ts:93` — comment changed from "exactly one turn" to "one saved turn" (comment only). Note: the brief named `runner.ts:1128`, but that line/text had drifted; the actual "exactly one turn" HelpState comment the review meant is in `helpState.ts`.
6. `runner.ts` (`withPractice`) — when a new item replaces a loaded item that carries a non-empty `answerKey` but no `practiceItemId` (not `holdsPracticeKey`), that key is now carried the same way as a practice key. Changed the carry condition from `holdsPracticeKey(loaded.help)` to `loaded.help.answerKey.length > 0`, and dropped the now-unused `holdsPracticeKey` import. Test added in `runner.practiceAnswerKey.test.ts` (there is no production path that sets a non-practice `answerKey` today; the test builds the state directly via `builtWith`).

## Files

- `packages/harness/src/pedagogy/helpState.ts`
- `packages/harness/src/pedagogy/helpState.test.ts`
- `packages/harness/src/pipeline/assemble.ts`
- `packages/harness/src/pipeline/assemble.test.ts`
- `packages/harness/src/pipeline/runner.ts`
- `packages/harness/src/pipeline/runner.practiceAnswerKey.test.ts`
- `packages/ingest/src/index/indexDocument.ts`
- `packages/ingest/test/index/indexDocument.test.ts`
- `docs/tasks/5.6d/handoff.md`

## Tests (acceptance evidence)

```
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/harness --filter=@edmate/ingest
...
Tasks:    8 successful, 8 total
Cached:    1 cached, 8 total
  Time:    35.53s
```

All harness and ingest typecheck/lint/test tasks passed, including the new tests for items 1, 4 and 6 and the tightened assertions for item 2.

```
$ python3 .githooks/secret-scan.py --all
(no output — clean)
```

## Decisions

- Item 5's brief cited `runner.ts:1128`, but no "exactly one turn" HelpState text exists there (or anywhere in `runner.ts`); the matching text is the `practiceCarriedKey` field comment in `helpState.ts` (line ~93). Fixed there instead, since that's clearly the comment the review meant (same "one turn" carried-key wording, same 5.6c/ADR-0011 context).
- Item 3's type-level guard: used a homomorphic mapped type with the `-?` modifier to strip the optional modifier TurnContext's optional keys (e.g. `persona`) would otherwise carry into the mapped type, which made indexing by `[keyof TurnContext]` include `undefined` and broke the `[Mismatched] extends [never]` check even when every type actually matched. No runtime behaviour change.
- Item 6's test keeps `loadedA`'s `practiceModuleId`/`practiceServed` (but not `practiceItemId`) so the tool serves the same `b` item as the sibling tests; otherwise the tool picks a different item and the assertion on the new `answerKey` wouldn't isolate the carried-key behaviour being tested.

Tool calls used: 31
