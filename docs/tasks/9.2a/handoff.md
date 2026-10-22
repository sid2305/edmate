# 9.2a: public discovery repository, search index, 200-teacher dev seed

## Summary

Adds `packages/db`'s public discovery surface (no `apps/web` changes — Phases B/C are separate):

- `teacherProfiles.search`: a generated `tsvector` column (`setweight(subject, 'A') || setweight(bio, 'B')`, `simple` dictionary) plus GIN indexes `teacher_profiles_search_idx` (on `search`) and `teacher_profiles_languages_idx` (on `languages`). Migration `packages/db/migrations/0020_teacher_profile_search.sql`, additive only.
- `discoveryRepo(db)` with `search(input)` and `teacherBySlug(input)` — public, no teacher/student scope, following the `agents.owner` / `packageVersions.liveForAgent` precedent: the whole input is parsed like a scope (`RepositoryError('scope', method)` on a malformed input, never `invalid`). Only a **verified** teacher with a **live** agent and a **live** package version is ever reachable; a pending/rejected teacher, a draft/suspended agent, no live package, or a newer draft package version are all invisible — never an error, never distinguishable from "not found" (no enumeration).
- `buildDiscoverySeed(n)` (pure, deterministic) and the `db:seed-discovery --fake-teachers <n>` CLI (`runSeedDiscoveryCli`), which refuses outside `NODE_ENV!=production` or on bad/missing input, before any DB connection. Every seeded teacher is fabricated (`seed-` ids, `@example.invalid` emails) and cannot start a chat (synthetic course/style-card ids).

## Exports for Phase B (`@edmate/db`'s root barrel, `src/index.js`)

```ts
discoveryRepo(db) // wired into createRepositories(db).discovery
repos.discovery.search(input: unknown): Promise<{ teachers: PublicTeacherCard[]; hasMore: boolean }>
repos.discovery.teacherBySlug(input: unknown): Promise<PublicTeacherPage | null>

interface PublicTeacherCard {
  slug: string; displayName: string; subject: string; bio: string;
  languages: string[]; packageCount: number; hasFree: boolean;
}
interface PublicTeacherPage extends PublicTeacherCard { agentIds: string[] }

DISCOVERY_PAGE_SIZE = 20
DISCOVERY_MAX_PAGE = 50
DISCOVERY_QUERY_MAX_LENGTH = 100
```

`search` input: `{ q?: string (max 100), language?: string (BCP-47-ish tag), page?: number (1..50) }` — `{}` is a valid "browse all" call. `teacherBySlug` input: `{ slug: string }` (lower-case-hyphen slug, 3–60 chars). Both throw `RepositoryError` with `kind: 'scope'` on a malformed input (never SQL). `bio` on a search card is truncated to 280 chars; `teacherBySlug`'s bio is not.

## Files

- `packages/db/src/schema/users.ts` — `teacherProfiles.search` generated column + 2 GIN indexes.
- `packages/db/src/repositories/discovery.ts` (new) — the repository.
- `packages/db/src/repositories/teacher-profiles.ts` — exported `Slug`, `LanguageTag` (read-only reuse by `discovery.ts`).
- `packages/db/src/repositories/index.ts` — wires `discovery` into `createRepositories`; re-exports the types/constants above.
- `packages/db/src/repositories/README.md` — documents the public reads.
- `packages/db/src/discovery-seed.ts` (new) — `buildDiscoverySeed`.
- `packages/db/src/cli.ts` — `runSeedDiscoveryCli`.
- `packages/db/src/bin/seed-discovery.ts` (new) — CLI wrapper; `package.json`'s `db:seed-discovery` script.
- `packages/db/migrations/0020_teacher_profile_search.sql` + `migrations/meta/_journal.json`, `meta/0020_snapshot.json`.
- Tests: `test/discovery.int.test.ts` (new, Postgres), `test/discovery-seed.test.ts` (new, unit), `test/repositories.int.test.ts` (new `discovery.search`/`discovery.teacherBySlug` isolation cases), `test/leak.test.ts` (new scrub cases), `test/schema.test.ts` (new generated-column/index assertions), `test/scope.test.ts` (new `users`-read exception for `discovery.ts`; `discovery.search` excluded from the generic bad-scope grid — see Decisions).

## Tests

`corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` — green (26/26 tasks), 100% coverage on `discovery.ts`; `python3 .githooks/secret-scan.py --all` — clean.

Postgres integration (own compose project `edmate92a`, torn down with `-v` after each run):
- `discovery.int.test.ts`: 16/16 passed — index usability (GIN names appear on a standalone predicate; the real join-driven statement never falls back to `Seq Scan` on `teacher_profiles`, per lessons.md's planner-brittleness caution), one SQL statement per search (`pool.query` spy), decoy invisibility (pending/rejected/student-role/draft-agent/suspended-agent/no-live-package/newer-draft-version), exact public key shapes, AND/prefix search semantics, language filter, paging, bad input never reaching SQL.
- 50 mixed searches over the 200-teacher seed, printed (never asserted tight): **p50=2.7ms p95=4.4ms max=7.3ms**. The `<5s` assertion is a gross-regression guard only.
- Full suite (`vitest run`, all of `@edmate/db`): 1054 tests, all passing after fixes (see Decisions).

## Decisions

### 22 Oct 2026 · 9.2a Lead accepts the public discovery repository in packages/db/src/repositories/discovery.ts · decided by lead · risk: high
- Decided: merge the public, unauthenticated discovery read (packages/db/src/repositories/discovery.ts, index.ts, teacher-profiles.ts) after security-reviewer, database-reviewer, code-reviewer and typescript-reviewer all approved; it exposes only slug, display name, subject, bio, languages, package count and hasFree for verified teachers with a live agent and a live package version.
- Why: every decoy (pending, rejected, student role, draft or suspended agent, no live package, draft version) is tested absent; input is parsed by strict zod before any SQL and the tsquery is a bound parameter.
- risk: high (risky path packages/db/src/repositories/**). Follow-ups in 9.2d; request-level rate limiting on the public /teachers routes belongs to 9.2b.

### 22 Oct 2026 · 9.2a Lead ratifies 'scope' errors for bad public input in packages/db/src/repositories/discovery.ts · decided by lead · risk: low
- Decided: discovery.search and discovery.teacherBySlug throw RepositoryError('scope', method) on malformed input, not 'invalid' as the plan's prose said; the code-reviewer's MEDIUM on this is wontfix. Phase B maps 'scope' from these two methods to a 400 or an empty result.
- Why: it matches the only two existing public-read methods (agents.owner, packageVersions.liveForAgent); a third convention would be worse.
- risk: low

### 22 Oct 2026 · 9.2a Public display name comes from users.name · decided by builder · risk: medium
- Decided: displayName on the discovery card and page is the teacher's users.name; discovery.ts is a documented exception to scope.test.ts's "never reads users" guard, touching only users.role and users.name, never email or phone (tested).
- Why: teacherProfiles has no display-name column (lead answer Q2), and the WHERE clause limits this to public rows.
- risk: medium

### 22 Oct 2026 · 9.2a discovery.search is excluded from the generic bad-scope grid · decided by builder · risk: low
- Decided: scope.test.ts's "every method rejects a bad scope" grid skips discovery.search, whose own malformed-input cases live in discovery.int.test.ts and leak.test.ts.
- Why: {} is a legitimate browse-all call for search, not a bad scope.
- risk: low

### 22 Oct 2026 · 9.2a GIN-index test asserts no seq scan plus GIN usability on a join-free query · decided by builder · risk: low
- Decided: at seed scale Postgres picks the btree join index for the full statement, so the test asserts no Seq Scan on teacher_profiles and, separately, that both GIN indexes are used when they are the only access path.
- Why: a scale-dependent plan assertion would be brittle (database-reviewer MEDIUM on this test is deferred to 9.2d).
- risk: low

### 22 Oct 2026 · 9.2a Seed CLI lives in cli.ts · decided by builder · risk: low
- Decided: the db:seed-discovery command is an exported function in packages/db/src/cli.ts with a 5-line bin wrapper, like every other bin in the package.
- Why: follows the existing convention.
- risk: low

## Left to do

Nothing outstanding for Phase A's scope. Phase B/C (apps/web discovery pages, consuming the exports above) are separate tasks.

Status: DONE

Tool calls used: 216 (harness count)
