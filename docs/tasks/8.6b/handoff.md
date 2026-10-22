# Handoff: 8.6b Agent bootstrap and package repository (Phase B of docs/tasks/8.6/plan.md)

Status: DONE

- Branch: `m8/8.6b-packages-repo` (built on local branch `work-86b`)
- Worktree: `.claude/worktrees/agent-a574f8ca5b6318e24`
- Tool calls used: 52

## What changed

All in `packages/db` (risky path `packages/db/src/repositories/**`). No contracts, harness, apps or
migration change.

- `src/repositories/agents.ts`: new `agents.ensureDraft`.
- `src/repositories/packages.ts` (new): `packagesRepo(db)` with `create`, `saveVersion`,
  `listForTeacher`; `PACKAGES_MAX = 20`; `PackageDraft`; `TeacherPackageRow`.
- `src/repositories/index.ts`: wires `packages: guardAll('packages', packagesRepo(db))`; exports
  `PACKAGES_MAX`, `PackageDraft`, `TeacherPackageRow`, `DraftAgentInput`.
- `src/repositories/README.md`: new section "Agent bootstrap and packages (task 8.6b)".
- `test/packages.int.test.ts` (new, 14 tests on Postgres).
- `test/repositories.int.test.ts`: isolation cases for `agents.ensureDraft`, `packages.create`,
  `packages.saveVersion`, `packages.listForTeacher` (plus a `pkgDraft` helper and one studio package
  per teacher created in `beforeAll` for `saveVersion` to target).
- `map.ts` unchanged (reuses `toPackageConfig`). `package-versions.ts` unchanged.

### Signatures for Phase C (all exported from `@edmate/db`)

```ts
repos.agents.ensureDraft(
  scope: TeacherScope,
  input: { courseId: string; styleCardId: string; promptPackVersion: string; modelPolicy: ModelPolicy },
): Promise<{ agentId: string; version: number }>

type PackageDraft = Omit<PackageConfig, 'id' | 'version' | 'teacherId' | 'agentId'>; // strict
const PACKAGES_MAX = 20;
interface TeacherPackageRow {
  packageId: string;
  agentId: string;
  liveVersion: number | null;
  config: PackageConfig; // newest version: config.version, config.name, ...
}

repos.packages.create(scope, { agentId: string; draft: PackageDraft }): Promise<{ packageId: string; version: number }> // version 1
repos.packages.saveVersion(scope, { packageId: string; agentId: string; draft: PackageDraft }): Promise<{ packageId: string; version: number }>
repos.packages.listForTeacher(scope): Promise<TeacherPackageRow[]> // oldest first, at most PACKAGES_MAX
```

Errors (`RepositoryError.kind`): `ensureDraft` foreign/missing course or style card `not_found`,
bad config or extra key `invalid`. `create` foreign/missing agent `not_found`, foreign/missing
module `scope`, teacher at `PACKAGES_MAX` `invalid`, extra key in the draft `invalid`.
`saveVersion` package not the teacher's or not of that agent `not_found`, foreign module `scope`.
Phase C maps `scope`/`not_found` to 404 and `invalid` to 400 (or 409 for the cap, its choice).

## Evidence

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55486/edmate corepack pnpm vitest run test/packages.int.test.ts` → `Tests  14 passed (14)`
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` (with the edmate86b Postgres) → see GATE below
- `python3 .githooks/secret-scan.py --all` → see SCAN below

## Deviations

- `packages.saveVersion` also takes `agentId` (the plan's signature had `{ packageId, draft }`), so
  the plan's "a package of another agent → `not_found`" test can be met: the row lock is on id,
  `teacher_id` and `agent_id`.
- The `package.save` audit row puts the package id in `target` (`package:<id>`) and only
  `{ version }` in `after`, not `{ packageId, version }`: the audit redactor reads a UUID that starts
  with digits (for example `26288156-…`) as a phone number and stores `[redacted]-…`.
- `create` enforces `PACKAGES_MAX` (the plan put the cap on `listForTeacher` only); otherwise a
  21st package would be stored but never listed.
- `ensureDraft` checks the course and style card on every call, even when the agent exists (the
  plan checked them only before creating), so a foreign id always fails closed.
- Handoff is at `docs/tasks/8.6b/handoff.md` (the brief said `docs/tasks/8.5a/handoff.md`, which
  is task 8.5a's file).

## Follow-ups

- Share the module-ownership check between `packages.ts` and `package-versions.ts` once 8.5a merges
  (duplicated ~12 lines, as the plan expected).
- The audit redactor (`redact-json.ts`) treats a digit-led UUID in a value as a phone number. Any
  repo that writes an id into `before`/`after` loses it. Worth a small fix task (skip UUID-shaped
  values).

## Decisions

### 22 Oct 2026 · 8.6b Teacher scope checks in the agent and package repositories · decided by builder · risk: high
- Decided: every new query filters by the scope's `teacher_id`. `agents.ensureDraft` key-share-locks the course and style card by id and teacher (else `not_found`) before returning or creating the agent, builds `teacherId` from the scope and parses the strict input and the full config before any SQL. `packages.create` checks the agent by id and teacher, `packages.saveVersion` row-locks the package by id, teacher and agent (else `not_found`), and both key-share-check every module by id and teacher (else `scope`). Drafts are strict, so a client-set `teacherId`, `agentId`, `id` or `version` is `invalid`. Only `packages.name` is ever updated. Callers: the teacher studio API (Phase C) with the signed-in teacher's own scope; no student or public caller.
- Why: teacher data isolation (README rule 3); a package must never unlock another teacher's modules or attach to another teacher's agent. The isolation grid covers all four methods.
- risk: high

### 22 Oct 2026 · 8.6b Package cap and versioning locks · decided by builder · risk: medium
- Decided: `packages.create` takes a per-teacher advisory lock (namespace 8602) and refuses a 21st package (`invalid`); `saveVersion` serialises on a `FOR UPDATE` lock of the package row and writes max + 1; `ensureDraft` uses a per-teacher advisory lock (namespace 8601) so two concurrent calls make one agent. No migration.
- Why: the cap (Q6) must hold under concurrent creates, and the list would otherwise hide packages past 20; the unique `(package_id, version)` index stays the backstop.
- risk: medium

### 22 Oct 2026 · 8.6b Audit row keeps the package id in target only · decided by builder · risk: low
- Decided: `package.save` audit rows store `target: package:<id>` and `after: { version }`.
- Why: the audit redactor mangles digit-led UUIDs in `after`; `target` is stored as is. No price or names are logged.
- risk: low
