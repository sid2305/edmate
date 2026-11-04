# Review: 4.6d — APPROVE

Reviewers: code-reviewer

## Findings
- [HIGH] [fixed] packages/harness/src/guardrails/lockedMatch.ts:470: the `DEFAULT_IGNORABLE_MARK` regex used literal U+FE00 to U+FE0F and U+034F characters instead of `\u` escapes.
- [HIGH] [fixed] packages/harness/src/guardrails/lockedMatch.ts:342-348: the 7 new `NAMED_ENTITIES` values were literal invisible characters.
- [HIGH] [fixed] packages/harness/src/guardrails/lockedMatch.test.ts and lockedLeak.test.ts: the new fixtures used literal invisible characters, against the plan and the file's own `ZWSP` convention.

## Notes
- The code-reviewer ran the real guard with 12 scratch probes:
  - the two board reproducers;
  - U+FE00 and U+FE0E variants;
  - `&shy;`, `&ZeroWidthSpace;` and `&NoBreak;` spliced mid-word;
  - a heart with U+FE0F in benign prose;
  - a keycap;
  - code prose;
  - a chain-level rewrite.
- All 12 passed, with no false positives. Decoding comes before dropping, length is preserved, and there are no span offset bugs. `textFold.ts` and `labelKeys.ts` are unchanged, and `answerKey.labels.test.ts` passes 71/71.
- Fix round 1 replaced every literal with an escape. The lead verified it on the branch: a grep for U+00AD, U+034F, U+180E, U+200B to U+200F, U+202A to U+202E, U+2060 to U+2064, U+FE00 to U+FE0F and U+FEFF prints nothing in all three source and test files. The lead also escaped the literals left in the handoff. This was a mechanical, behaviour-neutral fix, so the lead verified it and the reviewer was not re-run. The fixer's gate passed: harness 6043 tests, with 100% coverage of `src/guardrails/**`.
- Safety group: code-reviewer plus a risk: high lead decision, under the MVP rule.
