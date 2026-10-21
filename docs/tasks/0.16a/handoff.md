# 0.16a handoff: metrics find the subagent transcripts

Status: DONE
Branch: m0/0.16a-subagent-transcripts (built on local `work-0.16a`)
Worktree: .claude/worktrees/agent-a33127bec7a34541f

## Files
- `.claude/skills/team-lead/metrics.py`: `iter_entries` now reads lead files (`<dir>/*.jsonl`, per-entry branch matching as before) and subagent files (`<dir>/<session>/subagents/*.jsonl`). A subagent file counts whole for a task when its first user message says `task <id>` (id not followed by a digit or `.digit`), or any entry's gitBranch is the task branch or a `work-` branch for it (see Fix round 1). Symlinked session dirs, `subagents` dirs and files are skipped. The prompt text is only matched, never returned or stored.
- `.claude/tests/test_metrics.py`: 2 new classes, 17 new tests (`SubagentTranscripts`, `SubagentMatching`).
- `.claude/tests/fixtures/transcripts-subagents/`: synthetic session: a lead file, a 0.16 builder (starts on `main`, moves to `work-0.16f`, prompt doesn't name the task) and a reviewer whose prompt says "task 0.1".
- `closeout.py` and `board.py` are unchanged; closeout already calls `metrics.collect`.

## Tests
- `python3 -m unittest discover .claude/tests -p test_metrics.py` → `Ran 37 tests ... OK` (red first: 10 failures before the change)
- `python3 -m unittest discover .claude/tests` → `Ran 202 tests in 62.3s  OK`
- `python3 .githooks/secret-scan.py --all` → clean
- Fixture counts: task 0.16 → 4 tool calls (lead 1 + builder 3); task 0.1 → 3 (lead 1 + reviewer 2); task 0.2 → 0. A test checks that neither the marker nor the prompt text shows up in `collect()` output.
- Left for the lead (plan step 5): re-run 0.16's metrics on real transcripts after merge (`board.py set 0.16 done --metrics <file>`).

## Fix round 1
- [HIGH] a parent id over-matched its lettered sibling tasks (0.16/0.16a, 5.8/5.8a, 6.1/6.1a). Fixed in `metrics.py`:
  - The prompt match now also rejects a trailing letter: `task 0.16` matches "task 0.16." but not "task 0.16a" (any case).
  - New `read_board_ids(repo_root)` reads the top-level `- id:` lines of `docs/board/tasks.yaml`. `collect()` takes an optional `board_ids` (tests pass an explicit set; by default it reads the board) and passes it to `iter_entries`.
  - `work-<id>` always counts. `work-<id><letter>` counts toward `<id>` only when `<id><letter>` is not a board id, so builder phase branches (work-7.7a) still count but work-0.16a no longer counts for 0.16. A missing or unreadable board (or an empty id set) falls back to exact `work-<id>` only.
- [LOW] tests added: prompt "task 0.16a" and branch work-0.16a/work-5.7b give 0 to the parent when the lettered id is on the board; work-7.7a/7.7b count for 7.7 when not on the board; no board falls back to exact only; `read_board_ids` on a real-shaped, missing and unreadable board; `collect()` reading the board itself.
- `python3 -m unittest discover .claude/tests -p test_metrics.py` -> `Ran 45 tests ... OK` (red first: 1 failure, 22 errors)
- `python3 -m unittest discover .claude/tests` -> `Ran 210 tests in 67.5s  OK`
- `python3 .githooks/secret-scan.py --all` -> clean
- On the real board: 203 ids read, `0.16a` present, `7.7a` absent.

## Deviations
None.

## Decisions

### 21 Oct 2026 · 0.16a lettered work branches count for the parent only when they are not board tasks · decided by lead (fix round) · risk: low
- Decided: replaces the earlier `work-<id>[a-z]?` rule. `work-<id>` always counts; `work-<id><letter>` counts toward `<id>` only when `<id><letter>` is not a task id on `docs/board/tasks.yaml`. With no readable board, only the exact `work-<id>` counts. The prompt match `task <id>` also rejects a trailing letter.
- Why: lettered ids like 0.16a, 5.8a and 6.1a are real board tasks, so the old rule double-counted one subagent file for both parent and sibling. Falling back to exact-only means a missing board under-counts rather than over-counts.
- risk: low

### 21 Oct 2026 · 0.16a prompt match is case-insensitive and needs the word "task" · decided by tdd-guide · risk: low
- Decided: the prompt matches `task <id>` in any case ("Task 0.16" counts); a bare id without the word "task" does not count.
- Why: lead prompts write both "task" and "Task"; requiring the word stops stray version numbers or ids mentioned in passing from pulling in unrelated files.
- risk: low

### 21 Oct 2026 · 0.16a only the first user message is treated as the prompt · decided by tdd-guide · risk: low
- Decided: the first entry with `message.role == "user"` is the prompt (a string or its text blocks joined). Later user messages, such as tool results or lead course-corrections, are ignored.
- Why: the plan says "first user message"; later messages can quote other task ids and would attribute the file wrongly.
- risk: low

### 21 Oct 2026 · 0.16a subagent files get no cwd fallback · decided by tdd-guide · risk: low
- Decided: the per-entry `cwd` fallback (for entries with no gitBranch) applies only to top-level lead files. Subagent files match only by prompt or branch.
- Why: builder worktree dirs are named `agent-<hash>`, not by task id, so the fallback would never match there. Applying it per entry would also count part of a file.
- risk: low

### 21 Oct 2026 · 0.16a a whole file can count for more than one task · decided by tdd-guide · risk: low
- Decided: attribution is checked per task, so if one subagent file's prompt names task A and it also runs on task B's branch, it counts for both.
- Why: rare in practice, and dropping it from one task silently would hide real work. Counts are per-task totals, not a partition.
- risk: low
