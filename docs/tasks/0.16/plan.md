# 0.16 · Agent factory, measure

## Acceptance (verbatim)
> closeout writes a `metrics` map on the task; `board.py metrics` prints a table for the last N
> done tasks; tests with a fixture transcript; no transcript text or secrets land on the board.

How it will be shown: `python3 -m unittest discover -v .claude/tests` passes with the new tests;
a manual `closeout.py <id>` run on a fixture repo (as `test_closeout.py` already simulates) adds a
`metrics:` map to that task in `docs/board/tasks.yaml`, containing only numbers/short model-name
strings — no file paths, session ids or transcript excerpts; `board.py metrics` then prints a
table grouped by model and by the task's `risk` field (see Decisions) for the last N done tasks
with a `metrics` map.

## Design
- **New module** `.claude/skills/team-lead/metrics.py`, pure functions, no subprocess/yaml
  writes of its own:
  - `transcripts_dir(repo_root)`: `Path(os.environ.get("EDMATE_TRANSCRIPTS_DIR") or Path.home() /
    ".claude" / "projects" / str(repo_root).replace(os.sep, "-"))`. Configurable via
    `EDMATE_TRANSCRIPTS_DIR` so tests point it at a fixture dir and never touch a real `~/.claude`.
    No literal `/Users/...` or username ever appears in source — the path is built at runtime
    from `Path.home()`/`repo_root()`, same pattern `closeout.py` already uses for `repo_root()`.
  - `iter_entries(dir, branch)`: read every `*.jsonl` file in `dir` (one JSON object per line,
    skip unparseable lines), yield entries whose `gitBranch` field equals `branch`, falling back
    to entries whose `cwd` contains the task id (older transcripts / no worktree) when `gitBranch`
    is absent. **Before writing this, read one real local transcript file** (from the running
    session's own `~/.claude/projects/...`) to confirm the field names (`type`, `message.role`,
    `message.model`, `message.usage.{input_tokens,output_tokens,cache_read_input_tokens,
    cache_creation_input_tokens}`, `timestamp`, `cwd`, `gitBranch`) — read-only, never copy its
    content into the repo or a fixture.
  - `collect(repo_root, task_id, branch)` -> dict with only these keys (no paths, no ids, no raw
    text):
    - `tool_calls`: count of assistant `message.content` blocks with `type: "tool_use"`.
    - `tokens_in`, `tokens_out`, `cache_read_tokens`: summed `usage` fields.
    - `wall_time_seconds`: `max(timestamp) - min(timestamp)` across matched entries (approximate,
      same style as 0.15's by-hand read; sessions overlap, this isn't CPU time).
    - `models`: sorted list of distinct `message.model` short names seen.
    - `builder_phases`: count of `^## Phase` headings in `docs/tasks/<id>/plan.md` if present,
      else `1`.
    - `fix_rounds`: count of `^## Fix round` headings in `docs/tasks/<id>/handoff.md`.
    - `findings`: counts by severity and status, parsed from `docs/tasks/<id>/review.md` lines
      matching the merge-gate format `- [SEV] [status] ...` (SEV counts, and a `fixed/open/
      deferred/wontfix` breakdown).
    - `human_questions`: count of `.claude/blockers.md` entries mentioning the task id (file may
      be absent — Edmate convention, not guaranteed on every machine; 0 if missing).
  - No network/model calls; all file reads.
- **`closeout.py`**: after `board.py set <id> done` succeeds, call `metrics.collect(...)`, write
  the dict to a temp JSON file, then `board.py set <id> done --metrics <tmpfile>` (idempotent:
  running twice overwrites the same map, same spirit as the existing decisions idempotency).
- **`board.py`**: `set` gains `--metrics <path>`: read the JSON file, merge (replace) into
  `t["metrics"]`. New `metrics [--last N] [--by risk|milestone]` command (default `--by risk`,
  see Decisions): iterate done tasks with a `metrics` map (most recent N by board order, or all if
  N omitted), group by `--by` value and by the `build:` model token parsed from the task's
  `model` string, print one row per group with counts/sums/averages (tool_calls, tokens, wall
  time, fix-round and findings totals). Pure read/aggregate of what's already on the board — no
  transcript access in this command.
- Nothing here needs a hook or `.claude/settings.json` change (metrics are computed once, at
  closeout, by the lead's own `closeout.py` run, not during a live session) — see Open questions.

## Files
- `.claude/skills/team-lead/metrics.py` (new)
- `.claude/skills/team-lead/closeout.py` (edit: call `metrics.collect`, write via `board.py set
  --metrics`)
- `.claude/skills/board/board.py` (edit: `set --metrics`, new `metrics` command)
- `.claude/tests/test_metrics.py` (new): fixture JSONL under a temp dir (set via
  `EDMATE_TRANSCRIPTS_DIR`), synthetic content only — no real paths/usernames (secret-scan allows
  `/home/you/...`-style placeholders; prefer a `tempfile` dir like the existing tests). Cases:
  matches by `gitBranch`, falls back to `cwd` containing the task id, sums tokens/tool_calls
  correctly, computes `wall_time_seconds` from timestamps, parses `findings`/`fix_rounds` from
  fixture `review.md`/`handoff.md` text, 0 `human_questions` when `blockers.md` is absent, and a
  fixture entry containing a marker string that must **not** appear anywhere in `collect()`'s
  output (proves no raw transcript text leaks).
- `.claude/tests/test_closeout.py` (extend): closeout with `EDMATE_TRANSCRIPTS_DIR` pointed at a
  fixture writes a `metrics:` map to `docs/board/tasks.yaml`, and the written YAML contains no
  `/Users/` or `/home/<realname>/` substring and no session-id-looking token from the fixture.
- `.claude/tests/test_board.py` (extend): `set --metrics` merges the map; `metrics` command prints
  a row per group for done tasks.
- `.claude/tests/fixtures/transcript-sample.jsonl` (new, synthetic, no real data).

No `.github/**` change needed: `.claude/tests/*` is already picked up by
`python3 -m unittest discover -v .claude/tests` in `ci.yml`'s `python-harness` job.

## Files out of bounds
`.claude/settings.json`, `.claude/hooks/*` (the human's; see Open questions),
`docs/agents/registry.md` and anything from 0.18/0.19 (later tasks depend on 0.16, not the other
way round), any real file under `~/.claude/projects/` (read one for schema reference only, never
copied or committed).

## Tests first
Write `test_metrics.py`'s fixture and cases before `metrics.py`'s implementation; then
`test_board.py`'s `--metrics`/`metrics` cases before touching `board.py`; then extend
`test_closeout.py` last, once `closeout.py` wires the two together.

## Risky paths touched
All touched/created files are under `.claude/**`:
- `.claude/skills/team-lead/metrics.py`, `.claude/skills/team-lead/closeout.py`,
  `.claude/skills/board/board.py`, `.claude/tests/test_metrics.py`,
  `.claude/tests/test_closeout.py`, `.claude/tests/test_board.py`,
  `.claude/tests/fixtures/transcript-sample.jsonl`
→ reviewers: **security-reviewer** (risk-paths.txt: "The agent harness, git hooks (secret scan)
and CI themselves"). No other group matched (no `packages/contracts`, `packages/harness/src/
guardrails|pedagogy`, access/payments/auth paths, or migrations touched). Plan a `risk: high`
decision entry in the handoff, same as 0.15.

## Decisions to log in the handoff
- `board.py metrics --by` default is `risk` (risky/expert/none), not milestone: the token-budget
  rule it serves ("compare model vs review outcome") is about whether sonnet holds up on risky
  work, not about milestone. `--by milestone` stays available as an alternative view.
- Transcript-to-task matching is by the JSONL `gitBranch` field (falling back to `cwd` containing
  the task id); this is a best-effort heuristic like 0.15's by-hand count, not an exact audit.

## Open questions
1. No hook or `.claude/settings.json` change is planned (metrics are computed once at closeout,
   not live during a session). If a future task wants live per-call capture, that needs a hook —
   out of scope here; recommend parking it as a later 0.1x task rather than adding one now.
2. The exact transcript JSONL field names are assumed from this session's own format (confirmed
   informally, not from first-party docs); the plan already requires the builder to check one
   real local transcript before writing the parser, so this isn't blocking, just flagged in case
   the schema has changed.

## Tool-call budget
One phase, target ≤130 tool calls (7 files, one package, one guard: the transcript-matching
heuristic). If the builder is past ~130 calls before `test_closeout.py`'s extension is done, stop
at a green commit with `Status: PARTIAL` and hand off the remaining test-file edit.
