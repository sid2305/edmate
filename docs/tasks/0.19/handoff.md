# 0.19 handoff — decision-log digest and lessons file

Status: DONE (Phase A and Phase B)
Branch: m0/0.19-digest-lessons (Phase A from local `work-0.19a`, Phase B from local `work-0.19b`, both pushed to it)
Tool calls used: 52 (24 Phase A + 28 Phase B; plan budget 115)
Worktree: an auto agent worktree under `.claude/worktrees/` (removed when the agent ends)

## Phase A

Tool calls used: 24 (Phase A only; plan budget 115 for both phases, ~50 for Phase A).

### Changes
- `.claude/skills/board/digest.py` (new): pure functions, no I/O.
  - `parse_log_entries(text)` → `[{heading, risk, body, supersedes}]` in log order.
  - `parse_standing_rules(text)` → `[(rule, cited_heading)]` from `docs/decisions/standing-rules.md` bullets.
  - `render_digest(entries, rules=())` → the `docs/decisions/digest.md` text; refuses a rule whose citation is not a risk: high heading.
  - `is_missing(entries, digest_text)` → risk: high headings with no `- <heading>` line (or its superseded form).
- `.claude/skills/board/board.py`: new `digest` subcommand (docstring updated). It reads the log and the optional standing-rules file and writes `docs/decisions/digest.md`. On any `ValueError` it prints `refusing to write ...` to stderr, exits 1 and writes nothing. It reuses the 0.18 `sys.dont_write_bytecode` pattern.
- `.claude/skills/team-lead/closeout.py`: `main()` now reads the handoff once. A new `append_decision_entries()` returns the appended headings; `append_decisions()` keeps its signature and return value. A new `needs_lesson()` checks the handoff text and appended headings. When it is true, closeout prints `<id>: handoff shows a fix round or human correction — consider a docs/lessons.md entry.` after logging and before `board.py set done`. Exit codes and all other steps are unchanged. Docstring steps renumbered.
- `.claude/tests/helpers.py`: `skills/board/digest.py` added to `SCRIPTS`.
- `.claude/tests/test_digest.py` (new, part 1): 33 fixture tests covering the parser, the standing rules, the renderer and `is_missing`, plus `board.py digest`. The board tests check idempotent rewrites, reading the standing-rules file, a malformed log that writes nothing, a bad rule that keeps the previous digest, and that no `__pycache__` is left.
- `.claude/tests/test_closeout.py`: 6 `LessonsReminder` cases. They cover `## Fix round 1`, `decided by you`, a plain handoff, prose or `###` "Fix round" lines that are not headings, no second reminder for an already-logged human entry, and a refusal path whose exit code stays 1.

No real `docs/decisions/digest.md`, `docs/decisions/standing-rules.md` or `docs/lessons.md` is committed (Phase B).

### Acceptance evidence
- Red first: `python3 -m unittest test_digest test_closeout` (from `.claude/tests`) → `Ran 17 tests ... FAILED (failures=5, errors=1)`. The error was the missing `digest` module; the failures were the 5 reminder cases.
- `python3 -m unittest discover .claude/tests` → `Ran 298 tests in 60.9s` / `OK`
- `python3 -m unittest discover -s docs/adr -p 'test_*.py'` → `OK`
- `python3 .githooks/secret-scan.py --all` → exit 0, no findings
- Dry run on the real log, with nothing written: `parse_log_entries` → 805 entries (212 risk: high, 34 with no risk marker). `is_missing(entries, render_digest(entries))` → `[]`. The real log is therefore not "malformed" under the rules below, and Phase B can run `board.py digest` as is.

### Notes for Phase B
- Standing rules go in `docs/decisions/standing-rules.md`, one per line: `- <rule text> (cites: <exact risk: high heading, without ###>)`. Lines that are not bullets are ignored, so a title or intro is fine.
- The real log has 212 risk: high headings. They include builder sub-entries copied under a merge entry (for example 6.2's "`risk: high` — new write path ..."), because every `### ` heading counts as an entry. That is faithful to the log, but the digest will be long. If the lead wants only dated `decided by` headings, that is a new rule for the lead to set; don't guess one.
- The acceptance's static real-repo check (Phase B, part 2 of `test_digest.py`) can be `digest.is_missing(digest.parse_log_entries(log), digest_md) == []`.

## Phase B

Tool calls used: 28 (Phase B only).

### Changes
- `.claude/skills/board/digest.py`: the digest scope from lead answer 6.
  - `in_digest(entry)`: (a) every entry whose heading says "decided by you" or "decided by human", at any risk; (b) `risk: high` entries "decided by lead" whose title doesn't start with `<id> merge:`. Builder, tdd-guide, planner, team and other entries stay out.
  - `decided_by`, `digest_key` (the heading's `date · title`, without the who and risk parts), `summary` (first sentence of the `Decided:` line, the next line when `Decided:` is empty, else the first bullet; capped at 220 characters), `digest_entries` (in scope, exact duplicates dropped, newest date first, log order within a date).
  - Each digest line: `- <date · title> (<who>, risk: <level>[; superseded by <date · title>]): <first sentence>`.
  - `render_digest` now has "Standing rules" and "Decisions" sections. A rule must cite an in-digest heading (full heading or `date · title`). `is_missing` checks in-scope entries only.
  - Summaries replace a reviewer handle (`reviewed_by: <x>`, `reviewedBy:`, `reviewed_by is set to <x>`) with `<human>` and a `github.com/<owner>/<repo>` link with "GitHub".
- `.claude/skills/board/board.py`: `digest` prints the number of digest entries.
- `docs/decisions/standing-rules.md` (new): 12 hand-picked rules, each citing a real human or risk: high lead entry.
- `docs/decisions/digest.md` (new, generated): 144 lines, 121 decisions, 12 standing rules.
- `docs/lessons.md` (new): 6 entries (safe-regex worker failing open / IN pack timeout; practice-answer key leak path; red CI from changes that passed locally; wall-clock bounds on CI; a silently skipped budget check; the human removing the 4.3 game-talk exemption). Each has a `Sources:` line citing real log headings or review files. Checked by eye: no names, emails, numbers or handles.
- `.claude/tests/test_digest.py`: fixture tests for the scope filter (`DigestScope`), the new render format, sorting, redaction and abbreviations, plus `RealRepo`: every in-scope log entry is in `digest.md`, the committed digest equals a fresh render, no handle or home path is copied, `lessons.md` has 3 to 8 entries, and every citation resolves.
- `.claude/agents/planner.md`, `.claude/agents/tdd-guide.md`: the first Edmate-notes bullet now names `docs/decisions/digest.md` and `docs/lessons.md` as required reading. The `## Agent registry` blocks are unchanged; `test_registry` passes.

### Acceptance evidence
- Red first: the scope tests against Phase A's `digest.py` → `Ran 43 tests ... FAILED (failures=9, errors=10)`; then the summary tests → `FAILED (failures=3)`.
- `python3 -m unittest discover .claude/tests` → `Ran 317 tests in 63.7s` / `OK`
- `python3 .claude/skills/board/board.py digest` → `wrote docs/decisions/digest.md (121 decisions, 12 standing rules)`; re-running gives no diff (`RealRepo.test_digest_is_up_to_date`).
- `python3 .githooks/secret-scan.py --all` → exit 0, no findings.
- `grep -c "digest.md" .claude/agents/planner.md .claude/agents/tdd-guide.md` → 1 each (same for `lessons.md`).
- `docs/decisions/log.md` is not changed.

### Notes for the lead
- The board's example "the IN.yaml regex timeout" is the 1.7 review HIGH (the safe-regex worker could not load, so IN.yaml's patterns timed out). It shares a lesson with the 1.7b fix round. "Red tests pushed to main" maps to 0.14 (main's CI went red) and the stale 5.6 snapshot, 1.7f test and 1.7b workflow.
- "Pilot market" (18 Oct, US and India) is effectively replaced by "US is the first region; India parked", but neither entry has a `Supersedes:` line, so the digest doesn't mark it (lead answer 2). A future log entry can add one.
- Headings that repeat (`Setup`, `Product`) are cited only where the rule is unambiguous; the two `18 Oct 2026 · Merge policy` entries both support the one merge-policy rule.

## Decisions

### 21 Oct 2026 · 0.19 Phase A: "malformed log" means an entry the digest could silently drop · decided by builder · risk: medium
- Decided: `parse_log_entries` raises (so `board.py digest` writes nothing) on four things. (1) A `### ` heading before the first `---` line: an entry with no closing `---`, as in the plan's fixture. (2) A `###Heading` with no space that carries `risk: high`. (3) A risk: high entry with an empty body. (4) A `Supersedes:` line naming a heading that isn't in the log. A risk: high heading followed by another heading with no `---` between them is not malformed. An entry's body ends at the next `### ` heading or the next `---` line.
- Why: the plan's literal reading ("every risk-high heading needs a closing `---`") would fail the real log. The log has 7 blocks where two or more entries sit with no `---` between them, including risk: high ones such as "US is the first region; India parked". The last entry closeout writes also never has a trailing `---`. The log can't be edited (append-only), so the rule targets what actually drops an entry. A dry run shows the real log passes.

### 21 Oct 2026 · 0.19 Phase A: standing rules live in docs/decisions/standing-rules.md · decided by builder · risk: low
- Decided: the hand-picked "Standing rules" list is a data file, `docs/decisions/standing-rules.md`, with one `- <rule> (cites: <exact risk: high heading>)` bullet per rule. `board.py digest` reads it if it exists and renders the bullets verbatim. A bullet with no citation, or with a citation that isn't a risk: high heading, fails the run. With no file, the section says "None yet."
- Why: lead answer 3 wants the lead to change the list without touching `digest.py`. A separate file keeps the generated `digest.md` hand-edit-free.

### 21 Oct 2026 · 0.19 Phase A: risk and supersedes parsing edges · decided by builder · risk: low
- Decided:
  - Risk comes from the last `risk: <level>` in the heading, else from the first body line that starts with `risk:` or `- risk:`. A mid-sentence `· risk: high` in prose does not count.
  - `Supersedes:` and `cites:` match headings after whitespace normalisation, with an optional leading `###`.
  - A heading logged twice appears once in the digest.
  - When two entries supersede the same heading, the newest one is named.
  - The splitter duplicates closeout.py's (`decision_entries`/`split_log`), with a comment naming the twin (lead answer 1).
- Why: these match the variations in the real log and keep the output deterministic.

### 21 Oct 2026 · 0.19 Phase A: closeout's lessons reminder is case-insensitive and fires only on newly appended entries · decided by builder · risk: low
- Decided: the `## Fix round` check is case-sensitive and anchored to a line start. The "decided by you" check is case-insensitive, and only looks at headings closeout appended on this run, so a re-run doesn't remind again. The reminder also prints when `board.py set done` then refuses. It is advisory only, and the exit code is unchanged.
- Why: the plan names "freshly-appended" headings. Case-insensitivity catches "Decided by you" at a heading start at no cost.

### 21 Oct 2026 · 0.19 Phase A: digest machinery in .claude (risky path) · decided by builder (for the lead) · risk: high
- Decided: Phase A changes `.claude/**` (board skill, team-lead `closeout.py`, tests), so the PR needs security-reviewer and a risk: high entry. It adds no permissions and no network or subprocess use in `digest.py`. closeout only gains a print.
- Why: CLAUDE.md rule 6 and `risk-paths.txt`'s `.claude/**` group.

### 21 Oct 2026 · 0.19 Phase B: digest scope and one-line format follow lead answer 6 · decided by lead (answer 6) and builder (format details) · risk: medium
- Decided: the digest lists every human decision at any risk, plus risk: high lead decisions whose title isn't `<id> merge:` (so "4.7 merged:" and "1.7 Merge Phases A–C" stay in). One line each: `date · title`, who and risk, then the first sentence of `Decided:`. Lines are sorted newest date first, because the log isn't strictly date-ordered. Exact duplicate entries show once; two entries with the same heading but different text both show. No entry is marked superseded yet. Result: 121 decisions, 144 lines.
- Why: lead answer 6 replaces Phase A's "every risk: high heading" scope (212 entries, mostly builder sub-entries). The test pins the filter, not the count.

### 21 Oct 2026 · 0.19 Phase B: the digest drops who-clauses and redacts reviewer handles · decided by builder · risk: medium
- Decided: digest lines show `date · title` without the `decided by ...` clause (some name a person in brackets), and summaries replace reviewer handles and `github.com/<owner>/...` links. A test checks the committed digest has neither.
- Why: the repo is public and the brief says to copy no names. The full log keeps the original text.

### 21 Oct 2026 · 0.19 Phase B: standing rules and lessons are hand-picked from real entries · decided by builder · risk: low
- Decided: 12 standing rules (region, payments last, MVP first, English only, crisis replies in English, learner age 13+, game-talk exemption removed, distress alert channel, jailbreak strikes, guard chain fails closed, merge policy, push policy) and 6 lessons. Each one cites a real log heading or review file, and a test checks every citation resolves. Ambiguous repeated headings (`Setup`, `Product`) are not cited.
- Why: lead answer 3 and 4: the script checks citations; the builder picks, and never invents a source.

### 21 Oct 2026 · 0.19 Phase B: digest content and agent required reading (.claude, risky path) · decided by builder (for the lead) · risk: high
- Decided: Phase B changes `.claude/**` (`digest.py`, `board.py`, tests, `planner.md`, `tdd-guide.md`), so the PR needs security-reviewer and a risk: high entry. No new permissions, network or subprocess use; the agent files gain one required-reading clause each.
- Why: CLAUDE.md rule 6 and `risk-paths.txt`'s `.claude/**` group.
