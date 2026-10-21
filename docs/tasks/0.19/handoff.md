# 0.19 handoff — decision-log digest and lessons file

Status: PARTIAL (Phase A done; Phase B, the content, is for the next builder)
Branch: m0/0.19-digest-lessons (built on the builder's local `work-0.19a`, pushed to it)
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
