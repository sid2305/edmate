# 12.4b handoff: publish refuses a regulated-subject agent without staff approval

Status: DONE

- Branch: `m12/12.4b-publish-regulated-block` (built on local `work-124b`)
- Worktree: `.claude/worktrees/agent-a23a24759d564ac5c`
- Plan: `docs/tasks/12.4/plan.md`, Phase B

## Summary
`publish.startRun` and `publish.goLive` now refuse an agent that staff flagged with a regulated
subject and have not approved, with `PublishRefusedError('invalid', …, 'regulated_unapproved')`.
`startRun` checks right after the `suspended` check, under the existing agent `FOR UPDATE` lock and
before any write (the stale-run update included). The staff-set `agents.regulated_subject` column
is now the only source of the new version's `regulatedSubject` (no longer copied from version N).
`goLive` re-checks the approval under its agent lock, and also refuses when the run's agent version
subject differs from the agent's current subject (staff flagged, changed or cleared it after the
run started). The lock order (advisory, profile, agent, run) is unchanged; the only new read is the
run's agent version config, unlocked (versions are never updated). The worker and studio pass the
reason through unchanged (no source edit).

## Files
- `packages/db/src/repositories/publish.ts`: `regulated_unapproved` in `PublishRefusal`;
  `regulatedSubjectOf` helper (parses the column with the contracts enum via `stored`, so a bad
  value is `integrity`); the two checks; doc comments.
- `packages/db/test/publish.int.test.ts`: cases (a)–(e); the old "carries the regulated subject"
  case now sets the subject through `regulatedSubjects`, plus a case that a subject only in the old
  version is not copied.
- `apps/worker/src/gate/processor.test.ts`: one case, a `regulated_unapproved` goLive refusal ends
  the run `error` with that code (test only).

## Tests (acceptance evidence)
Seen red first: 11 new cases failed before the change (`expected Error: resolved to be an instance
of RepositoryError`, and the subject-copy assertions).

- `TEST_DATABASE_URL=… corepack pnpm vitest run test/publish.int.test.ts` (disposable
  pgvector:pg16 container) → `Tests  42 passed (42)`
  - (a) flagged, unapproved → `invalid` / `regulated_unapproved`, 1 version, 0 runs; also refused
    before a stale open run is touched.
  - (b) after approval the run starts and the version has `regulatedSubject: 'health'`.
  - (c) a run started before the flag, before a revoke, with a subject later changed or cleared,
    or flagged then approved after the run's version was cut, is refused at `goLive`: agent stays
    draft, no package live, no `agent.publish` audit row, run still `running` (the worker ends it
    `error` / `regulated_unapproved`, worker test).
  - (d) every existing publish case is green; an approved, unchanged subject goes live with one
    `agent.publish` audit row.
  - (e) changing the subject clears the approval: refused again until re-approved, then the version
    carries the new subject.
- Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --filter=@edmate/worker`
  with `TEST_DATABASE_URL` (after merging origin/main) → `Tasks: 32 successful, 32 total`;
  db coverage `publish.ts 100 | 98.82 | 100 | 100` (the uncovered branch is the existing
  `open.changes ?? []`). Worker Redis int tests skip locally, as before.
- `python3 .githooks/secret-scan.py --all` → clean.

## Decisions

### 22 Oct 2026 · 12.4b Publish refuses flagged, unapproved agents at start and go-live · decided by builder · risk: high
- Decided: `startRun` refuses a flagged agent with no approval (`invalid` / `regulated_unapproved`)
  right after the `suspended` check, under the existing agent `FOR UPDATE` lock and before any write;
  `goLive` re-checks it under its agent lock and also refuses when the run's version subject is not
  the agent's current staff subject. The refused run stays `running` and the worker ends it `error`
  with the reason as its code (its existing path). Lock order unchanged (advisory, profile FOR
  SHARE, agent FOR UPDATE, run FOR UPDATE); the one new read (the run's version config) takes no
  lock. The staff column is the only source of a new version's `regulatedSubject`. Reviewers:
  security-reviewer (the publish block, risky path `packages/db/src/repositories/**`) and
  database-reviewer (the goLive re-check, no new lock, lock order).
- Why: plan Phase B and acceptance "flagged agents cannot publish without staff approval"; lessons
  on lock order and failing closed.
- risk: high

### 22 Oct 2026 · 12.4b A subject mismatch at go-live reuses the regulated_unapproved reason · decided by builder · risk: low
- Decided: when staff change or clear the subject after a run started, `goLive` refuses with the
  same `regulated_unapproved` reason (also when staff cleared the flag), not a new reason word.
- Why: the plan names one reason; the teacher's fix is the same (publish again, with approval if
  flagged), and the studio and worker need no new mapping.
- risk: low

## Deviations
None. No migration, schema, contracts or other apps/ source edits.

## Left to do
Nothing for 12.4b. Phase C (12.4c staff API) and D (12.4d staff page, teacher refusal text) remain.

Tool calls used: 38
