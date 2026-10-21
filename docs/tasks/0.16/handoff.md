# 0.16 handoff: Agent factory, measure

Status: DONE

## Files
- `.claude/skills/team-lead/metrics.py` (new): `transcripts_dir`, `iter_entries`, `collect` --
  pure functions, no subprocess/YAML writes. `collect(repo_root, task_id, branch)` returns only
  numbers and short model-name strings (`tool_calls`, `tokens_in`, `tokens_out`,
  `cache_read_tokens`, `wall_time_seconds`, `models`, `builder_phases`, `fix_rounds`, `findings`,
  `human_questions`) -- no paths, session ids or transcript text.
- `.claude/skills/team-lead/closeout.py` (edit): after looking up the task's branch, calls
  `metrics.collect(...)`, writes the result to a temp JSON file, and passes it to
  `board.py set <id> done --metrics <file>` (best-effort: any read/parse error just skips the
  `--metrics` flag rather than blocking closeout).
- `.claude/skills/board/board.py` (edit): `set` gained `--metrics <path>` (reads the JSON file,
  replaces `t["metrics"]`); new `metrics [--last N] [--by risk|milestone]` command (default
  `--by risk`), grouping done tasks with a `metrics` map by that field and by the `build:` model
  token parsed from the task's `model` string, printing one row per group.
- `.claude/tests/test_metrics.py` (new, 14 cases): fixture-driven -- `gitBranch` match, `cwd`
  fallback match, exclusion of other branches/unrelated cwd, token/tool-call sums, wall-time from
  timestamps, distinct sorted models, `builder_phases`/`fix_rounds`/`findings` parsing,
  `human_questions` (0 when `blockers.md` absent), and a marker-string leak check.
- `.claude/tests/test_board.py` (extend, 6 new cases): `set --metrics` merge + idempotent
  overwrite; `metrics` table grouping by risk/milestone, `--last`, bad `--by`, empty-table message.
- `.claude/tests/test_closeout.py` (extend, 2 new cases): closeout with
  `EDMATE_TRANSCRIPTS_DIR` pointed at the fixture writes a `metrics:` map containing no
  `/Users/`, `/home/`, `sessionId` or the fixture's marker string; idempotent rerun.
- `.claude/tests/fixtures/transcript-sample.jsonl` (new): synthetic JSONL, no real paths/ids.
- `.claude/tests/helpers.py` (edit): added `metrics.py` to the scripts copied into each test repo
  (closeout.py now imports it).

## Tests
- `python3 -m unittest discover -v .claude/tests` -> `Ran 173 tests ... OK` (all pre-existing
  suites plus the new/extended ones).
- `python3 .githooks/secret-scan.py --all` -> clean, no output.
- Confirmed the transcript JSONL schema (field names `type`, `message.role`, `message.model`,
  `message.usage.{input_tokens,output_tokens,cache_read_input_tokens}`, `timestamp`, `cwd`,
  `gitBranch`) by reading one real local transcript file under this session's own
  `~/.claude/projects/...` (read-only; nothing from it was copied into the repo or fixture).

## Fix round 1

All 6 review findings are fixed, and each has a test that was written first and failed first.

1. [HIGH] `metrics.py` `FINDING_LINE` now matches any status bracket (`\[([^\]]+)\]`) and buckets
   by its first word, so `- [LOW] [deferred 0.13a] ...` counts as `deferred`. Test:
   `test_findings_with_multiword_status_bracket`.
2. [HIGH] `iter_entries`: the `cwd` fallback now matches the task id only when it is bounded by
   `/`, `-`, `_` or the string ends, so `0.1` and `0.16` never match each other. `gitBranch` is
   still an exact equality match, which is stricter than a boundary match. Tests: `CwdBoundary`
   (4 cases).
3. [MEDIUM] `board.py set --metrics` accepts only `metrics.collect()`'s 10 known keys. Values
   may be numbers, strings of 64 characters or fewer, or dicts/lists of those (at most 20 items,
   at most 2 levels deep). Anything else exits 1 and leaves the board unchanged. Tests:
   `test_set_metrics_accepts_full_collect_shape` and `test_set_metrics_rejects_*` (4 cases).
4. [MEDIUM] `iter_entries` skips symlinked `*.jsonl` files and anything that is not a regular
   file. Test: `test_skips_symlinked_transcripts`.
5. [LOW] `closeout.py` prints only `type(e).__name__` when metrics collection fails. Test:
   `test_metrics_error_prints_only_exception_type`. It forces an `IsADirectoryError`, then
   checks that neither the path nor `review.md` appears in the output.
6. [LOW] `_load_jsonl` now reads the file one line at a time through an open file handle
   instead of `read_text()`.

Evidence:
- `python3 -m unittest discover .claude/tests` → `Ran 185 tests ... OK`
- `python3 .githooks/secret-scan.py --all` → clean

## Decisions

### 21 Oct 2026 · 0.16 board metrics allowlist limits · decided by build-error-resolver · risk: low
- Decided: `board.py set --metrics` accepts only the keys `metrics.collect()` writes. Strings may be at most 64 characters, dicts and lists at most 20 items and 2 levels deep, and booleans and nulls are refused. Symlinked transcript files are skipped, not resolved.
- Why: these limits fit everything `collect()` produces (for example findings → by_status → number) and keep free text or paths off the public board. Skipping symlinks is simpler than resolving them and checking containment, and Claude Code does not write symlinked transcripts.
- risk: low

### 21 Oct 2026 · 0.16 metrics table default grouping · decided by tdd-guide · risk: low
Decided: `board.py metrics` groups by `--by risk` (risky/expert/none) by default, with
`--by milestone` available as an alternative.
Why: the token-budget question this serves is "does a cheaper model hold up on risky work",
which is about risk, not about which milestone a task happened to land in.
- risk: low

### 21 Oct 2026 · 0.16 transcript-to-task matching is a heuristic · decided by tdd-guide · risk: low
Decided: entries are matched to a task by the transcript's `gitBranch` field, falling back to
`cwd` containing the task id when `gitBranch` is absent.
Why: there is no first-party transcript-to-task link; this mirrors 0.15's by-hand count as a
best-effort signal, not an audit trail.
- risk: low

### 21 Oct 2026 · 0.16 agent metrics at closeout (.claude, risky path) · decided by lead · risk: high

- Decided: merge 0.16. Closeout records counted agent metrics on the board, and `board.py metrics` reports them. security-reviewer and code-reviewer reviewed it. Fix round 1 fixed 2 HIGH, 2 MEDIUM and 2 LOW findings, and both reviewers re-checked their own.
- Why: the human asked for agent-factory metrics (0.16). Only allow-listed numbers reach the public board.
- risk: high

### 21 Oct 2026 · 0.16 risky paths: security-reviewer · decided by tdd-guide · risk: high
Decided: all touched/created files are under `.claude/**` (the agent harness itself per
risk-paths.txt), so this PR needs security-reviewer sign-off before merge.
Why: `.claude/skills/team-lead/metrics.py`, `.claude/skills/team-lead/closeout.py`,
`.claude/skills/board/board.py` and their tests are part of the harness/CI tooling the human
flagged as risky; no `packages/contracts`, guardrails/pedagogy, access/payments/auth or
migration paths were touched.
- risk: high
