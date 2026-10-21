# 0.15 handoff · Token budget for the agent team

Status: DONE
Branch: m7/0.15-token-budget
Built by: a side session (edmate-b6) at the human's request, not tdd-guide; no feature code.

## Acceptance evidence
- `.claude/settings.json` parses as JSON and sets `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` to `"200000"`. Docs (code.claude.com/docs/en/env-vars): the variable sets the auto-compact window in tokens (100000–1000000), applies to the main conversation and subagents, and takes precedence over per-agent `autoCompactWindow`.
- `tdd-guide.md` and `build-error-resolver.md` carry the token-budget notes and `Status (DONE | PARTIAL | BLOCKED)`.
- `planner.md` splits builds over about 8 source files, 2+ packages, or 2+ guards or adapters into phases.
- The team-lead skill has the Token budget section, the fresh-fixer rule in step 5, and at most 2 builders at once.
- `python3 -m unittest discover -s .claude/tests -q` → `Ran 122 tests … OK`.

## Changes
See `plan.md` § Files. The coding model and effort are unchanged (Opus 5.5, medium; the human's 17 Oct decision).

## Deviations
- Per-agent `autoCompactWindow` frontmatter was not used: it needs Claude Code v2.1.296 and this machine runs v2.1.282. The env variable is used instead. Whether 2.1.282 honours it is unverified; updating Claude Code (`claude update`) makes it certain.

## Decisions
### 19 Oct 2026 · 0.15 Merge gate checks the handoff Status line · decided by lead · risk: high
Decided: `merge_gate.py` now reads `docs/tasks/<id>/handoff.md`'s `Status:` line (plain or bold, e.g. `Status: DONE` or `- **Status:** DONE`) and fails the merge unless it says DONE; `PARTIAL`, `BLOCKED` or a missing line fails with a clear message, even if `review.md` is APPROVE.
Why: nothing previously stopped a `PARTIAL`/`BLOCKED` handoff from merging once its review was approved, so an unfinished build could pass the gate.
Alternatives: trust the reviewer to catch a non-DONE handoff by eye; add a separate `--status` flag instead of reading the file.
Reversible: yes, revert the regex check in `evaluate()`.

### 19 Oct 2026 · 0.15 Every session compacts at 200k tokens · decided by lead · risk: high
Decided: `.claude/settings.json` sets `CLAUDE_CODE_AUTO_COMPACT_WINDOW` to 200000, so the lead and every subagent compact at about 200k tokens of context instead of near the 1M window.
Why: calls with more than 200k tokens of context were 60% of all usage (measured 19 Oct 2026 over 11,900 calls); every call re-sends the whole context. A simulation on those calls: a 200k cap leaves about 63% of today's usage, 250k about 69%; 200k is the standard window and avoids any long-context price premium.
Alternatives: per-agent `autoCompactWindow` (needs Claude Code v2.1.296); `CLAUDE_CODE_DISABLE_1M_CONTEXT`; no cap.
Reversible: yes; remove the `env` entry.

### 19 Oct 2026 · 0.15 Fix rounds go to a fresh agent with a short brief · decided by lead · risk: medium
Decided: CRITICAL and HIGH findings go to a fresh fixer with the findings and the plan, handoff and review paths; the original builder is continued only if its run took under about 60 calls.
Why: a finished builder carries 300k+ tokens into every call, while a fresh fixer starts at about 10k. This replaces the old rule to always continue the same builder.
Alternatives: keep continuing the same builder.
Reversible: yes.

### 19 Oct 2026 · 0.15 Builds are sized to about 150 tool calls · decided by lead · risk: medium
Decided: the planner splits big tasks into phases with a fresh builder each, and a builder that passes about 150 calls stops at a green commit with `Status: PARTIAL` and a "Left to do" list.
Why: cost grows with calls × context, so two half-length builds cost about half as much as one long one.
Alternatives: one builder per task regardless of size.
Reversible: yes.

## Fix round 1 (security review)
Four changes applied:
1. **HIGH** `.claude/skills/merge-gate/merge_gate.py`: the gate now fails unless the handoff's `Status:` line (plain or bold) says DONE; PARTIAL/BLOCKED/missing fails with a clear message. Tests added in `.claude/tests/test_merge_gate.py` (missing, PARTIAL, BLOCKED, bold-DONE, composite sub-task status, and a prose mention of `Status: PARTIAL` that must not be mistaken for a real status line).
2. **MEDIUM** `.claude/skills/team-lead/SKILL.md`: the "Fix rounds go to a fresh agent" bullet and step 5 now say that safety-path findings pass the fixer the full `review.md`/`safety-review.md` path to read, not just a one-line summary.
3. **LOW** `.claude/agents/tdd-guide.md` and `build-error-resolver.md`: the "Stop early" bullet now says a `PARTIAL` handoff still needs the full `turbo run typecheck lint test --filter=<pkg>...` green and a clean `python3 .githooks/secret-scan.py --all` before the commit.
4. `.claude/skills/team-lead/SKILL.md` §1/§2/Token budget: builders are now 1 Opus + 1 Sonnet at once (the human's decision, 19 Oct 2026); `model` is passed explicitly when starting `tdd-guide`/`build-error-resolver` (opus for safety-heavy/contracts/multi-package work, sonnet for small/mechanical/well-specified tasks and most fix rounds); effort stays pinned in the agent files.

### Test evidence
`python3 -m unittest discover -s .claude/tests -p "test_merge_gate.py" -v` → `Ran 53 tests ... OK`
`python3 -m unittest discover -s .claude/tests -q` → `Ran 128 tests ... OK`
`python3 .githooks/secret-scan.py --all` → exit 0, no output
