# 9.2g handoff — Phase A

Status: DONE (Phase A)

## Summary

`teacherProfiles.listPendingForStaff` and `findBySlugForStaff` now both return the public display
name (slug-fallback), so staff approve the name students will see; the two mismatch cases in
`repositories.int.test.ts`'s `teacherProfiles.create` grid now use a well-formed `displayName` so
they exercise the duplicate-profile / slug-collision checks they're named for, not
`DisplayName`'s own length refinement.

Changed:
- `packages/db/src/repositories/map.ts`: `TeacherVerificationQueueRowSchema` gains
  `displayName: z.string().min(1)` (after `slug`, before `subject`); `toTeacherVerificationQueueRow`'s
  `row` param and mapped object gain `displayName`.
- `packages/db/src/repositories/teacher-profiles.ts`: `listPendingForStaff` and
  `findBySlugForStaff` selects each add
  `` displayName: sql<string>`coalesce(${teacherProfiles.displayName}, ${teacherProfiles.slug})` ``
  (same coalesce expression `discovery.ts` uses, task 9.2d); doc comments on both methods gain one
  clause noting the row now also carries the public display name.
- `packages/db/src/repositories/README.md`: § 9 and § 11's "name and email" sentences about
  `listPendingForStaff` each gain ", and the public display name (slug-fallback, same source as
  discovery's public reads, task 9.2g)".
- `packages/db/test/teacher-profiles.int.test.ts`: the oldest-first exact-shape test's `rowB`
  literal gains `displayName: 'Mr Beta'`, A's inline literal gains `displayName: 'Ms Alpha'`.
- `packages/db/test/repositories.int.test.ts`:
  - `teacherProfiles.listPendingForStaff`'s `check`: `Object.keys(row).sort()` now includes
    `'displayName'`.
  - `teacherProfiles.create`'s two mismatch cases ("a second profile for the same teacher",
    "another teacher's slug") now use `displayName: 'XX'` (was `'X'`), each with a one-line
    comment matching the existing comment style on the "a student scope id" case below them.

## Red-then-green evidence

Made all edits, then confirmed red by temporarily reverting the three source files
(`map.ts`, `teacher-profiles.ts`, `README.md`) back to `origin/main` via a tagged
`git stash` (applied, then dropped, never popped blind) and re-running
`vitest run test/teacher-profiles.int.test.ts test/repositories.int.test.ts` against the
test-only edits:

```
Test Files  2 failed (2)
      Tests  2 failed | 242 passed (244)
```

One failure was `teacher-profiles.int.test.ts`'s oldest-first `listPendingForStaff` test, on a
`toEqual` shape mismatch (actual row had no `displayName` key); the other was
`repositories.int.test.ts`'s `listPendingForStaff` exact-keys `check`, on the missing
`'displayName'` key — both because `map.ts`/`teacher-profiles.ts` did not yet select or map the
column. Restored the source edits (stash apply, then drop) and re-ran the same command: green.

```
Test Files  2 passed (2)
      Tests  244 passed (244)
```

## Decisions

### 26 Oct 2026 · 9.2g risky-path merge · decided by builder · risk: high
- Decided: this PR touches `packages/db/src/repositories/**` (map.ts, teacher-profiles.ts,
  README.md), a risky path under `.claude/skills/merge-gate/risk-paths.txt`. Required reviewer:
  `security-reviewer` (a staff-only identity-check surface changes shape). Recommended, not
  gate-required: `code-reviewer`, `typescript-reviewer`.
- Why: non-negotiable rule 6 requires naming the group and reviewer before the lead merges; Phase
  B will add the `apps/web/app/staff/**` / `apps/web/app/api/staff/**` group under the same risk
  path, confirmed again in the Phase B handoff.

### 26 Oct 2026 · 9.2g mismatch displayName value · decided by builder · risk: low
- Decided: used `'XX'` (not e.g. `'Teacher XX'`) for the two corrected mismatch-case
  `displayName` values, matching the plan's own example ("e.g. 'XX'").
- Why: plan named this exact value as its example; no reason to deviate.

## Gate

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db`
  → green. `Tasks: 8 successful, 8 total`. Coverage report: `All files 99.67% stmts / 97.88%
  branch / 99.65% funcs / 99.72% lines` (threshold kept). Full db test run: `Test Files 84 passed
  (84)`, `Tests 1782 passed | 4 skipped (1786)` — the 4 skips are pre-existing, unrelated perf/env
  skips in `recall.int.test.ts`, `video-ingest.int.test.ts`, `retrieval-hnsw.int.test.ts` (not
  touched by this task). The two files this task edits ran with **zero skips**: a separate
  `vitest run test/teacher-profiles.int.test.ts test/repositories.int.test.ts` reported
  `Test Files 2 passed (2)`, `Tests 244 passed (244)`.
- Diagnostic (non-blocking): `corepack pnpm turbo run typecheck --filter=...@edmate/db` — fails
  only in `apps/web`, exactly 2 `error TS` lines, both in
  `app/api/staff/verifications/route.test.ts`:
  - `(87,7): error TS2322` — a `listPendingForStaff` mock-return array literal missing
    `displayName`.
  - `(116,9): error TS2741` — a `findBySlugForStaff` mock-return object literal missing
    `displayName`.
  This is the Phase B checklist named in the plan; no other `apps/web` file failed typecheck from
  this diagnostic run (the plan's other named Phase B files — `client.test.ts`, `view.test.tsx`,
  `page.test.tsx` — use untyped/spread fixtures that don't fail typecheck, only their own test
  assertions, per the plan's own note).
- `corepack pnpm exec prettier --check` on all 5 changed files → `All matched files use Prettier
  code style!`.
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).

## Budget

Phase A tool calls used: 36
