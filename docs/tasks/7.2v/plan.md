# Plan: 7.2v — re-point stale pedagogy source citations; rename the plums case

Status: READY (written by the lead, 27 Oct 2026)

## Problem
The 7.2s Phase J review found that the Phase C pedagogy cases cite `docs/edmate-harness-build-plan.md` lines 350-357, 364, 365 and 513 for the mode rules (for example "explain: at most 150 words, cites sources") and the pedagogy suite row. Those lines now hold the turn-pipeline table and a `turn_traces` row. Also, 7.2s fix round 1 rewrote `evals/suites/pedagogy/pedagogy-hint-first-plums-default-en.yaml` as a dict-key-overwrite trick, so its file name and `id:` no longer match.

## Change
1. For every `evals/suites/pedagogy/*.yaml` whose `source:` cites a build-plan line or range, open the cited lines and check they say what the parenthetical claims. List the distinct citations first (`grep -ho "build-plan.md line[s]* [0-9][0-9, and-]*" evals/suites/pedagogy/*.yaml | sort | uniq -c`) and check each distinct one once, not file by file.
2. For each wrong citation, find the line(s) that hold that text today (grep the build plan for the mode rule or the pedagogy-suite row) and re-point it. Do the same for any `content/demo-teacher` line citation found wrong while checking (no need to audit those otherwise). Use a script (sed or python) for the bulk replacements; keep each `source:` wording otherwise unchanged.
3. Rename `pedagogy-hint-first-plums-default-en.yaml` to a name matching its trick (for example `pedagogy-hint-first-dict-key-overwrite-en.yaml`; check the name is unused) and set its `id:` to match. `grep -rn` the old id across the repo first; update any non-historical reference (leave `docs/tasks/7.2s/*` as is: they are the record).
4. No case content change beyond `source:` lines and that one id. The case count stays 150.

## Files
Modify: `evals/suites/pedagogy/*.yaml` (`source:` lines; one rename). Plus `docs/tasks/7.2v/handoff.md`, which lists each old → new citation and the files it touched (counts, not 100 names).
Out of bounds: every other suite, `packages/`, `content/`, prompt packs, locales. Another builder is working in `evals/suites/leak` and `packages/evals`.

## Risky paths touched
None. Reviewer: code-reviewer.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals`
- `python3 .githooks/secret-scan.py --all`

## Budget
Budget: 40 tool calls. One fix round, capped at 15.
