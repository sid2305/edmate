# 8.7e handoff: scorecard on the public teacher page (8.7 Phase E)

Status: DONE

- Branch: `m8/8.7e-public-scorecard` (built locally as `work-87e`)
- Worktree: `.claude/worktrees/agent-a3e4ca8cc1619761a`
- Plan: `docs/tasks/8.7/plan.md` (Phase E)
- Tool calls used: 24

## Summary

The public teacher page (`apps/web/app/teachers/[slug]/page.tsx`, 9.2c) now reads the stored
scorecard instead of always passing `null`.

- A new `teacherScorecard` helper in the page loader calls
  `repos.publish.publicScorecard({ agentId })` for the teacher's (one, MVP) agent
  (`teacher.agentIds[0]`), and if it returns a stored card, runs it through 9.2c's
  `toPublicScorecard` before handing it to `ScorecardPanel`.
- `publish.publicScorecard` already fails closed for a draft/suspended agent or an unverified
  teacher (it joins on `agents.status = 'live'` and a verified profile), so the loader needs no
  extra draft check: it just renders whatever comes back.
- A thrown read (network blip, a bad row) is caught, logged as `teacher_page.scorecard_read_failed`
  with only the `Error.name` (never the message), and treated as `null` -- the page still renders,
  it never 500s.
- No agent at all (`agentIds` empty) skips the call and renders `null` directly.
- Only the public fields `toPublicScorecard` returns reach the page: no run id, judge model, cost
  or per-origin split, matching what `ScorecardPanel` already shows.

## Files

- `apps/web/app/teachers/[slug]/page.tsx`: added `teacherScorecard()`, wired its result into
  `<ScorecardPanel scorecard={...} />` in place of the hard-coded `null`.
- `apps/web/app/teachers/[slug]/page.test.tsx`: added a `publicScorecard` mock to
  `serverDatabase().repos.publish`, a `STORED_SCORECARD` fixture, and four tests (see below).
  No other files touched.

## Tests

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/web...
→ Tasks: 34 successful, 34 total (web: Test Files all passing; app/teachers/[slug]/page.test.tsx 24 tests)
python3 .githooks/secret-scan.py --all → clean
```

Written first (red before the loader change), then made green:
- "shows the no published scorecard yet panel when publicScorecard returns null" -- asserts the
  call is `{ agentId: 'agent-1' }` and the panel shows the empty state.
- "shows the stored scorecard through toPublicScorecard when publicScorecard returns one" -- a
  full stored card (with `byOrigin`, `total`, `passed`, `measuredAt` -- fields the public
  projection drops) renders the two measured percentages and "Not measured yet" for the
  unmeasured category, never the empty-state text.
- "never renders a scorecard for a draft (not live) agent" -- `publicScorecard` returning `null`
  (as it does for a draft agent by construction) still shows "no scorecard yet".
- "shows no scorecard (not a 500) when the scorecard read fails, logging only the error name" --
  a rejected promise with a message containing `secret detail` renders the empty state and the
  `console.error` call never contains that detail.

## Decisions

### 22 Oct 2026 · 8.7e the loader reads the first agent id only · decided by builder · risk: low
- Decided: `teacherScorecard` calls `publicScorecard` with `teacher.agentIds[0]`, not every agent
  id the page lists packages for.
- Why: 8.7 and the MVP rules fix one agent per teacher; `agentIds` on the discovery row is a list
  only because the packages section was written generically (9.2c). Reading just the first id
  avoids a second, redundant call and keeps the scorecard tied to the agent whose packages the
  page already shows first.
- risk: low

## Left to do

None -- 8.7 Phase E is the last phase of task 8.7; task 8.7 is complete after this merges.
