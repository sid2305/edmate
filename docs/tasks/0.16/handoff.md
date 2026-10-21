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

## Decisions

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

### 21 Oct 2026 · 0.16 risky paths: security-reviewer · decided by tdd-guide · risk: high
Decided: all touched/created files are under `.claude/**` (the agent harness itself per
risk-paths.txt), so this PR needs security-reviewer sign-off before merge.
Why: `.claude/skills/team-lead/metrics.py`, `.claude/skills/team-lead/closeout.py`,
`.claude/skills/board/board.py` and their tests are part of the harness/CI tooling the human
flagged as risky; no `packages/contracts`, guardrails/pedagogy, access/payments/auth or
migration paths were touched.
- risk: high
