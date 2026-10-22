# Task 8.5a handoff: db, make preview and corrections queryable (8.5 Phase A)

Status: DONE
Tool calls used: 40

- Branch: `m8/8.5a-corrections-db` (built on local branch `work-85a`)
- Worktree: `.claude/worktrees/agent-a6b462c7caed10b9e`
- Plan: `docs/tasks/8.5/plan.md`, Phase A. Only `packages/db` changed; no migration, contracts,
  harness or apps change.

## What changed

- `packages/db/src/repositories/corrections.ts` (new): `correctionsRepo(db)` with `record`.
- `packages/db/src/repositories/agent-versions.ts`: `latest`.
- `packages/db/src/repositories/package-versions.ts`: `listForAgent`, `AGENT_PACKAGES_MAX`,
  `TeacherPackageSummary`.
- `packages/db/src/repositories/index.ts`: registers `corrections: guardAll('corrections', …)`;
  exports `AGENT_PACKAGES_MAX`, `TeacherPackageSummary`, `CorrectionRecordInput`,
  `CorrectionRecordResult`. The 8.4a `styleCards` line was already on this branch; both kept.
- `packages/db/src/repositories/README.md`: new "Test chat and corrections (task 8.5)" section.
- `packages/db/test/corrections.int.test.ts` (new): the acceptance proof (9 tests).
- `packages/db/test/repositories.int.test.ts`: isolation cases for the three new methods.

### Signatures for Phase B (all on `createRepositories(db)`, exported from `@edmate/db`)

```ts
repos.agentVersions.latest(scope: TeacherScope, agentId: string):
  Promise<{ version: number; config: AgentConfig } | null>
repos.packageVersions.listForAgent(scope: TeacherScope, agentId: string):
  Promise<TeacherPackageSummary[]>          // { packageId: string; name: string }[]
repos.corrections.record(scope: TeacherScope, input: CorrectionRecordInput):
  Promise<CorrectionRecordResult>           // { correctionId; chunkId; evalCaseId }
// CorrectionRecordInput = { moduleId: string; question: string; badAnswer: string;
//                           correctedAnswer: string }   (strict: extra keys are `invalid`)
```

Errors (`RepositoryError.kind`): bad scope → `scope`; bad id, unknown key, or a text that is empty
after trimming or longer than `LIMITS.turnTextMaxLength` code points → `invalid`; a missing or
another teacher's module in `record` → `not_found` (nothing written). `latest` → `null` and
`listForAgent` → `[]` for a missing or another teacher's agent.

## Evidence

`TEST_DATABASE_URL=…127.0.0.1:55485… corrections.int.test.ts` (own compose project `edmate85a`):

```
✓ test/corrections.int.test.ts (9 tests)
```

Proves: (1) a `corrections` row with the bad answer; (2) a `teacher_eval_cases` row with
`origin 'correction'` and the corrected answer; (3) a retrieval search for a close variant of the
question returns the new teacher-note chunk first (and its text has the corrected answer, not the
bad one); ghost module and another teacher's module → `not_found`, writing nothing; empty,
whitespace, over-cap or wrongly-typed texts and unknown keys → `invalid`, writing nothing; exactly
at the cap (in emoji code points) is accepted; `agentVersions.latest` picks the newest of 1/3/2 on
a draft agent, `null` for no version / other teacher / missing; `listForAgent` leaves out a package
with no version, orders newest first, `[]` for another teacher's agent.

`corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` with the edmate85a Postgres:

```
@edmate/db:test:   corrections.record                 teacher write cases=6 leaks=0
@edmate/db:test:  ✓ test/repositories.int.test.ts (102 tests)
@edmate/db:test:  ✓ test/corrections.int.test.ts (9 tests)
@edmate/db:test:  Test Files  56 passed (56)
@edmate/db:test:       Tests  956 passed | 4 skipped (960)
@edmate/db:test:   corrections.ts   |     100 |      100 |     100 |     100 |
 Tasks:    26 successful, 26 total
```

(The 4 skipped are pre-existing opt-in suites: recall, video ingest, HNSW.)

`python3 .githooks/secret-scan.py --all`: clean (see commit).

## Deviations

- `listForAgent` is capped at `AGENT_PACKAGES_MAX` (100) rows; the plan didn't name a cap.
- `record` also validates and trims `badAnswer` with `teacherNoteParts` (the plan said "capped at
  `LIMITS.turnTextMaxLength`"); the same helper as question/answer, so all three follow one rule.
- `docs/tasks/8.5/plan.md` was already in the repo; not copied.

## Decisions

### 22 Oct 2026 · 8.5a corrections and test-chat reads are teacher-scoped in the same statement · decided by builder · risk: high
- Decided: `corrections.record` writes only through `insertTeacherNote`'s `INSERT … SELECT FROM
  modules WHERE id = $m AND teacher_id = $t` (run first in the transaction; zero rows → `not_found`,
  rollback) and then inserts the `corrections` row with the scope's `teacher_id`, so a correction
  can never land on another teacher's module. `agentVersions.latest` filters `agent_versions` by
  `teacher_id` and `agent_id`; `packageVersions.listForAgent` filters `packages` by `teacher_id` and
  `agent_id` and its `EXISTS` on `package_versions` by `teacher_id` too. All three take a
  `TeacherScope` parsed before any SQL (`scope`), are wrapped by `guardAll` (driver errors
  scrubbed), and are covered by the isolation grid (`corrections.record` 6 write cases, 0 leaks; the
  two reads over every actor × target). Callers: only the teacher's own studio routes (Phase B,
  behind `withRole(['teacher'])`, with the scope built from the signed-in teacher's id), never a
  student route; drafts are readable only to their own teacher.
- Why: `packages/db/src/repositories/**` is a risky path ("keeping each teacher's and student's data
  apart"); these are the first reads that return draft agents and unpublished packages, so they must
  stay teacher-only.
- risk: high

### 22 Oct 2026 · 8.5a listForAgent returns at most 100 packages · decided by builder · risk: low
- Decided: `packageVersions.listForAgent` returns at most `AGENT_PACKAGES_MAX` = 100 rows, newest
  created first, then id.
- Why: every list read in this folder is bounded; a teacher has a handful of packages per agent,
  so 100 never cuts a real list, and the picker is not a completeness-critical read.
- risk: low

### 22 Oct 2026 · 8.5a the bad answer follows the teacher-note text rule · decided by builder · risk: low
- Decided: `badAnswer` is checked and trimmed with the same `teacherNoteParts` helper as the
  question and corrected answer (non-empty after trimming, at most `LIMITS.turnTextMaxLength` code
  points), and stored trimmed.
- Why: one rule for all three texts, the same cap the plan named, and no second length helper.
- risk: low
