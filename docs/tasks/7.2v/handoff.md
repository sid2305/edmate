# Handoff: 7.2v

Status: DONE

## Summary
- Audited every distinct source citation of docs/edmate-harness-build-plan.md lines/ranges across evals/suites/pedagogy/*.yaml (150 cases) by listing distinct citation strings once, then reading the cited lines in the build plan to check they say what the parenthetical claims.
- Found 8 distinct citation patterns pointing at the wrong lines (the build plan's turn-pipeline table, access-filter section and data-model table shifted since Phase C wrote these citations). Re-pointed them with a Python script (textwrap-based, preserving the folded block style, break_long_words=False and break_on_hyphens=False so file paths never split mid-word) run against evals/suites/pedagogy/*.yaml only. 53 files changed, 78 citation replacements. The content/demo-teacher line citations checked while reading each affected file were all still correct, so none needed changing.
  - line 364 to line 411 (13x): was the buildContext pipeline-step row; the explain-mode rule (cites sources) is now the explain row in the Skills table.
  - line 365 to line 412 (27x): was the decide pipeline-step row; the coach-mode rule (one question per reply, never states the answer below rung 4) is now the coach row in the Skills table.
  - line 354 to line 403 (1x): was blank/header prose under Turn pipeline spec; a correct step stays on the rung, specific praise is now the help-ladder table's any-to-same row.
  - lines 350-355 to lines 399-404 (12x) and lines 350-357 to lines 399-404 (8x): both used to cite the pre-pipeline interface block; the help ladder table (rungs, triggers, finalAnswers caps) is now at 399-404.
  - line 513 to line 560 (13x): was the turn_traces data-model row; the pedagogy-suite row (one question at a time, hints before answers, sources cited) is now the evals table's pedagogy row.
  - line 375 and lines 380-384 to lines 427-436 (3x) and standalone lines 380-384 to lines 427-436 (1x): 375 was the Determinism line and 380-384 is access-filter item 3 (locked vs not covered); Ask the teacher, item 1 (says so plainly, can still help with covered parts) is now the Ask the teacher section at 427-436.
  - Citations already pointing at lines 411, 412, 427-436, 399-404 and 560 (without the stale numbers above) were checked and left untouched: they already match current content.
- Renamed evals/suites/pedagogy/pedagogy-hint-first-plums-default-en.yaml to evals/suites/pedagogy/pedagogy-hint-first-dict-key-overwrite-en.yaml (git mv) and set id to match. The case's trick is reassigning stock['apples'] = 2 instead of += 2 (a dict-key overwrite), not plums; confirmed the new name/id was unused first. Left docs/tasks/7.2s/*, docs/board/tasks.yaml and docs/decisions/log.md untouched per the plan (historical record / out of this task's file list) and per the own-files restriction; found no other non-historical reference to the old id outside those paths and docs/tasks/7.2v/plan.md, which only names the old id as an example and is not a functional reference.
- No case content changed beyond source lines and the one id/filename. Case count stays 150.

Red/green evidence: before the fix, grep for the stale line numbers (line 364, line 365, line 354, lines 350-355, lines 350-357, lines 380-384, line 513) matched 78 lines across 53 files in evals/suites/pedagogy; after the fix it matches 0. The old id/filename has zero remaining references outside the historical 7.2s docs and the 7.2v plan.

## Decisions
### 27 Oct 2026 . 7.2v re-wrap width for edited source blocks . decided by builder . risk: low
- Decided: when a citation replacement changed the logical source string's length, re-flowed the whole folded block to width 90 (2-space indent, no mid-word breaks) with Python textwrap, rather than trying to preserve the original line-break positions.
- Why: several stale citations were split across two physical lines inside the YAML folded scalar (the word "line" on one line, the number on the next), so a line-local sed/regex would have missed them; re-flowing the joined logical string is the only reliable way to catch and fix every instance, and YAML folded scalars don't care about line width, so this changes no wording or meaning.

## Gate
- corepack pnpm turbo run typecheck lint test --filter=@edmate/evals -> pass (6/6 tasks, 31 test files, 1553 tests passed).
- python3 .githooks/secret-scan.py --all -> clean, no output.

## Budget
Tool calls used: 29
