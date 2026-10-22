# 9.2 plan: Discovery and teacher pages (server-rendered) with packages and the teaching scorecard

Board: milestone M9 · deps `1.3`, `1.7`, `7.8`, `9.1` (all done). Packages touched: `packages/db`
(Phase A), `apps/web` (Phases B and C). Three phases, one fresh builder each, in order: B needs A
merged (the repository methods), C needs B merged (shared `en.json` keys and the discovery module).
MVP scope: US pilot, English only (standing rules).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Discovery and teacher pages (server-rendered) with packages and the teaching scorecard"
Accept: "search < 1 s on a 200-teacher seed."

### How it is shown (paste into the last phase's handoff.md)

| Item | Evidence |
|---|---|
| Search < 1 s on a 200-teacher seed (CI part) | Phase A `packages/db/test/discovery.int.test.ts` (real Postgres): seeds 200 verified teachers plus private decoys, runs `ANALYZE`, then (1) **index check**: inside a transaction with `SET LOCAL enable_seqscan = off`, `EXPLAIN (FORMAT JSON)` of the search SQL names `teacher_profiles_search_idx` for a text query and `teacher_profiles_languages_idx` for a language filter (shows the predicate is indexable, whatever the table size); (2) **one statement per search** (count the pg client's `query` calls around one `discovery.search`, expect 1: no N+1); (3) a **loose 5 s gross-regression bound** per search, never 1 s (lessons.md "Wall-clock bounds fail on shared CI runners"). The test also prints p50/p95/max over 50 mixed searches; the numbers are pasted in the Phase A handoff but not asserted. |
| Search < 1 s (end to end, manual) | Phase B: on the compose stack, `db:seed-discovery --fake-teachers 200`, `next build` + `next start`, then 20 runs each of `curl -s -o /dev/null -w '%{time_total}'` on `/teachers`, `/teachers?q=finance`, `/teachers?q=python+beginner`, `/teachers?lang=en`; p50/p95/max pasted into the Phase B handoff. Pass = p95 < 1 s. Not a CI assertion. |
| Only public data is reachable | Phase A int tests: pending, rejected, role-changed (profile row of a non-teacher user), verified-with-draft-agent, verified-with-suspended-agent and verified-with-no-live-package teachers never appear in `search` and give `null` from `teacherBySlug`; a draft package version newer than the live one is never shown; result objects have exactly the documented keys (no user id, email, phone, photo, payout ref, verification status, package config internals). Phase B/C page tests: `notFound()` for every non-public slug, and only `PackageOffer` fields render. |
| Server-rendered | `/teachers` and `/teachers/[slug]` are async server components (`dynamic = 'force-dynamic'`), no client component and no client fetch; the search form is a plain `GET` form; Phase C `generateMetadata` gives the teacher page a title and description. |
| Packages on the teacher page | Phase C page test: the live packages from `packageVersions.liveForAgent` (unchanged, 9.3) render name, price ("Free" at 0), trial, daily messages, live classes and skills; the "Choose a package" link goes to `/packages/<agentId>` (9.3's page, which keeps its own student sign-in). |
| Teaching scorecard | Phase C `ScorecardPanel` renders a `PublicScorecard` (three categories: hints before answers, locked content, accuracy; whole percent rounded **down**; "not measured yet" for `measured: false`) and an honest "no published scorecard yet" state for `null`, never zeros. `toPublicScorecard(raw)` parses a stored 7.8 `Scorecard` shape and fails closed to `null`. Where the data comes from: Q1. |
| No contracts change | `git diff origin/main -- packages/contracts docs/adr` is empty. |

## Scope decisions (logged in the handoffs, not blockers)

1. **Who is public.** A teacher appears only when all hold: `teacher_profiles.verification_status =
   'verified'`, `users.role = 'teacher'`, an agent with `status = 'live'` and `live_version` set, and at
   least one package of that agent with `live_version` set and a matching `package_versions` row (the
   exact join `packageVersions.liveForAgent` uses). Anything else is absent from search and `null` by
   slug, so the page 404s the same way for "missing" and "private" (no enumeration).
2. **What is public per teacher:** `slug`, `displayName` (`users.name`, Q2), `subject`, `bio` (search
   cards get the first 280 characters, cut on the server), `languages`, `packageCount`, `hasFree`;
   the teacher page also gets the live agent ids (already public via `agents.owner`, needed for the
   `/packages/<agentId>` link). Never `userId`, email, phone, photo, payout ref or verification
   status (implicitly "verified").
3. **Search:** one SQL statement. Free text matches a new generated `teacher_profiles.search`
   tsvector (`setweight(to_tsvector('simple', subject), 'A') || setweight(to_tsvector('simple', bio),
   'B')`, GIN index), AND of prefix terms built with `queryTerms` + `tsTerm` imported read-only from
   `retrieval.ts` (quoted literals: no input can make `to_tsquery` raise, 5.4 precedent). Optional
   `language` filter (`languages @> array[$1]`, GIN index). Order: `ts_rank` desc then `slug` with a
   query, `subject` then `slug` without. Page size 20, `page` 1–50, fetch 21 to set `hasMore`. Input
   `q` ≤ 100 characters (the page trims longer input before the call).
4. **Not built (follow-ups for the lead to file):** a "goal" facet (no column; teachers' bios carry
   exams and jobs, which text search finds); a language select in the UI (English-only pilot; the
   `lang` URL parameter works and is tested, so the select is one component later); reviews, the
   sample conversation, the teaching-style text and the photo on the teacher page (no data yet, or
   prompt material); a public JSON API (Q4); adding `/teachers` to 9.1a's Lighthouse set.
5. **A failure is visible.** No `try/catch` that turns a repository error into "no teachers found":
   errors propagate to Next's error page. Teacher-written text renders as plain React text (no
   markdown, no links, no `dangerouslySetInnerHTML`).
6. **Price formatting** is a new `apps/web/src/discovery/format.ts` (`formatPrice` with the
   currency's own fraction digits via `Intl.NumberFormat` defaults, "Free" at 0). `PackageCompare`'s
   private copy is 9.3b's to replace (9.3b already lists the fraction-digit fix); 9.2 does not edit it.

## Migration

One additive migration, `00NN_teacher_profile_search.sql` (the latest on `main` today is `0019`;
the builder checks `packages/db/migrations/` and the journal at build time, since 8.x tasks run in
parallel): `ADD COLUMN search tsvector GENERATED ALWAYS AS (...) STORED`, `CREATE INDEX
teacher_profiles_search_idx ... USING gin (search)`, `CREATE INDEX teacher_profiles_languages_idx ...
USING gin (languages)`. No drop, no delete, no data rewrite beyond the generated column. Generated
with `corepack pnpm --filter @edmate/db db:generate` from the schema edit, never hand-written.

## Phase A: packages/db: discovery repository, search index, 200-teacher seed (budget 100)

Tests first:
- `packages/db/test/discovery.int.test.ts` (new, real Postgres): the acceptance rows above (index
  check, one statement, loose bound, printed timings); every decoy in scope decision 1 is absent
  from `search` and `null` by slug; exact result keys; `hasFree` and `packageCount` count only live
  versions; AND semantics ("python beginner" needs both), prefix ("fin" finds "finance"), tsquery
  syntax and quotes in `q` (`'`, `\`, `&|!():*`, emoji, 100 characters) return results or `[]`,
  never throw; an all-stop-word query behaves like no query; `language` filter; ordering and
  paging (`hasMore`, page 2 disjoint from page 1, page 51 → `invalid`); bad input (`q` over 100,
  bad language tag, extra keys) → `invalid` before any SQL; `teacherBySlug` with a malformed slug →
  `invalid`.
- `packages/db/test/discovery-seed.test.ts` (new, unit): `buildDiscoverySeed(200)` is deterministic,
  gives 200 distinct slugs prefixed `seed-`, emails ending `@example.invalid`, every package config
  passes `PackageConfigSchema`; the bin refuses without `--fake-teachers <n>` and when `NODE_ENV` is
  `production` (exit code 1, nothing written).
- `packages/db/test/repositories.int.test.ts`: isolation `CASES` for `discovery.search` and
  `discovery.teacherBySlug`, `scope: 'public'`, on the `agents.owner` / `liveForAgent` pattern
  (`tsc` requires them). `packages/db/test/leak.test.ts`: both methods in the scrubbed-error list.
- `packages/db/test/schema.test.ts`: `teacher_profiles.search` is a generated tsvector with a GIN
  index (as the `chunks` test does).

Files:
- Modify `packages/db/src/schema/users.ts` (`search` generated column, two GIN indexes; the
  `tsvector` custom type from `_shared.ts`) and generate the migration + meta snapshot/journal.
- Create `packages/db/src/repositories/discovery.ts`: `discoveryRepo(db)` with
  `search({ q?, language?, page? })` → `{ teachers: PublicTeacherCard[]; hasMore: boolean }` and
  `teacherBySlug({ slug })` → `PublicTeacherPage | null` (`agentIds` capped at 5). Strict zod inputs
  via `parseArg`; one select each; export `DISCOVERY_PAGE_SIZE`, `DISCOVERY_MAX_PAGE`,
  `DISCOVERY_QUERY_MAX_LENGTH` and an internal `searchQuery(...)` (the drizzle query object) so the
  test can `EXPLAIN` the exact SQL the repo runs. Reuse the slug and language regexes by exporting
  them from `teacher-profiles.ts` only if that is a one-line `export` change; otherwise copy them with
  a comment (do not otherwise edit `teacher-profiles.ts`).
- Modify `packages/db/src/repositories/index.ts` (wire `discovery: guardAll('discovery', ...)`; export
  the constants and the `PublicTeacherCard` / `PublicTeacherPage` types; update the "one exception"
  comment to name the public reads), `packages/db/src/repositories/README.md` (the public reads and
  what they never return).
- Create `packages/db/src/discovery-seed.ts` (pure `buildDiscoverySeed(n)`: synthetic teachers
  "Seed Teacher 001…", US/en, verified, a live agent and one or two live packages each, rotating
  pilot subjects and template bios; no real names or data) and `packages/db/src/bin/seed-discovery.ts`
  (dev only: refuses in production and without the explicit flag; idempotent by id; prints that these
  teachers can't start a chat, since they get no agent version or content). Modify
  `packages/db/package.json` (`db:seed-discovery` script).
- Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`.

State after Phase A: `repos.discovery.search` and `.teacherBySlug` return public-only teacher data
in one indexed statement; a dev stack can be filled with 200 fake teachers; nothing renders them yet.

## Phase B: apps/web: discovery page and entry points (budget 80)

Reads the Phase A handoff (exact names). Tests first (repos mocked, no database, no model):
- `apps/web/src/discovery/searchParams.test.ts`: `parseDiscoveryParams(searchParams)` → `{ q?,
  language?, page }`; trims, cuts `q` at 100, drops a bad `lang` or `page` (falls back to defaults,
  never throws), takes the first value of a repeated parameter.
- `apps/web/app/teachers/page.test.tsx`: renders for an anonymous visitor (`requireRole` never
  called), passes the parsed params to `discovery.search`, shows cards (name, subject, excerpt,
  languages, "Free package" badge when `hasFree`) linking to `/teachers/<slug>`, an empty state with
  the query echoed as text, next/previous links that keep `q` and `lang`; a repository error
  propagates (no "no results" on failure); nav shows "Sign in" for anonymous and "Home" + sign-out
  for a student; `jest-axe` zero violations.
- `apps/web/app/page.test.ts`: anonymous `/` now redirects to `/teachers` (Q3); student, teacher
  and staff unchanged. `apps/web/app/home/view.test.tsx`: a "Find a teacher" nav link to
  `/teachers`.

Files:
- Create `apps/web/src/discovery/searchParams.ts` (+ test), `apps/web/src/discovery/TeacherCard.tsx`,
  `apps/web/src/discovery/nav.ts` (`publicNav(principal)` from `currentPrincipal()`; imports
  `signOutAndRedirect` from `app/home/actions` read-only), `apps/web/app/teachers/page.tsx`
  (+ `page.test.tsx`).
- Modify `apps/web/messages/en.json` (new top-level `discovery` key only), `apps/web/app/page.tsx`
  + `page.test.ts` (anonymous → `/teachers`), `apps/web/app/home/view.tsx` + `view.test.tsx` (nav
  link only).
- Manual timed run (acceptance table) on the compose stack, timings in the handoff.
- Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`.

State after Phase B: anyone can search verified, published teachers at `/teachers`; `/` sends
visitors there; cards link to teacher pages that 404 until Phase C.

## Phase C: apps/web: teacher page, packages and scorecard (budget 90)

Reads the Phase A and B handoffs. Tests first:
- `apps/web/src/discovery/format.test.ts`: `formatPrice` (USD cents, a zero-decimal currency such as
  JPY, 0 → "Free").
- `apps/web/src/discovery/scorecard.test.ts`: `toPublicScorecard(raw)` keeps only `key`, `measured`,
  `percent` (floored to a whole number), `pass`; returns `null` for anything that fails the schema
  (missing category, unknown key, percent out of 0–100, extra nesting), never a partial card.
- `apps/web/src/discovery/components.test.tsx`: `PackageList` (public offer fields only; trial shown
  only when > 0), `ScorecardPanel` (`null` state; "not measured yet"; 99.6 shows 99, not 100),
  `jest-axe` zero violations.
- `apps/web/app/teachers/[slug]/page.test.tsx`: malformed slug and a `null` from `teacherBySlug` →
  `notFound()`; renders name, subject, bio, languages, the packages of each live agent from
  `liveForAgent`, the scorecard panel and a "Choose a package" link to `/packages/<agentId>`;
  `generateMetadata` title "<name>, <subject> | Edmate" and a 160-character description, and the
  default title for a non-public slug; anonymous access works.

Files:
- Create `apps/web/src/discovery/format.ts`, `scorecard.ts` (`PublicScorecard` type, schema,
  `toPublicScorecard`), `PackageList.tsx`, `ScorecardPanel.tsx`, their tests, and
  `apps/web/app/teachers/[slug]/page.tsx` (+ `page.test.tsx`). The page passes `scorecard={null}`
  until the data source in Q1 exists.
- Modify `apps/web/messages/en.json` (new top-level `teacherPage` key only).
- Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`.

State after Phase C (task done): server-rendered teacher pages show a verified teacher's profile,
live packages and the scorecard panel; a student can go from `/teachers` to a teacher page to 9.3's
package compare.

## Shared files (the lead orders the builds)

- Phase A: `packages/db/src/repositories/index.ts`, `README.md`, `packages/db/test/repositories.int.test.ts`,
  `packages/db/test/leak.test.ts` (8.6b in review; 8.5b/8.5d/8.3c and the 8.8/8.9 db phases edit
  the same files); `packages/db/migrations/**` + `meta/_journal.json` (any task adding a migration:
  number collision); `packages/db/package.json` (scripts only).
- Phase B: `apps/web/messages/en.json` (8.6 Phase D, 8.5, 8.8, 8.9 studio pages); `apps/web/app/home/view.tsx`
  + `view.test.tsx` (9.4a, 9.3b may touch `/home`; 9.2 adds one nav link only and does not touch
  `home/page.tsx`); `apps/web/app/page.tsx` + `page.test.ts` (9.1b's `HOME_PATH`/`TEACHER_PATH`
  constants).
- Phase C: `apps/web/messages/en.json` only.
- Not touched: the teacher studio (`apps/web/app/teacher/**`, `apps/web/src/studio/**`).

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**` (no contracts change).
- `packages/db/src/repositories/{package-versions,agents,retrieval,subscriptions}.ts` (call or import
  only); `teacher-profiles.ts` except a one-line `export` of its slug/language regexes.
- `packages/db/src/seed.ts` (keeps 9.0's try-it stable; the demo teacher appears once staff verify
  it, as the try-it guide already does).
- `apps/web/src/auth/**` (risky; `ROUTE_POLICY` needs no change: pages are not API routes, and no
  `/api/teachers` route is built, Q4), `apps/web/app/packages/**` (9.3b), `apps/web/src/chat/**`,
  `apps/web/app/home/page.tsx` (9.3b, 9.4a), `apps/web/app/teacher/**`, `packages/evals/**` (8.7),
  `packages/payments/**`.
- A builder that finds it needs any of these stops at `Status: PARTIAL` and reports it.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- Phase A: `packages/db/src/repositories/**` (`discovery.ts`, `index.ts`, `README.md`, maybe a one-line
  export in `teacher-profiles.ts`). **Reviewers: security-reviewer** (public, unauthenticated reads:
  what leaves the database for anyone). Recommend `database-reviewer` too as practice (generated
  column, GIN indexes, query plan), not gate-required (the migration drops and deletes nothing). The
  Phase A handoff logs a `risk: high` decision.
- `packages/db/src/schema/**`, `packages/db/migrations/**`, `packages/db/src/bin/**`,
  `packages/db/src/discovery-seed.ts`, `packages/db/test/**`: no match.
- Phases B and C: `apps/web/app/teachers/**`, `apps/web/src/discovery/**`, `apps/web/app/page.tsx`,
  `apps/web/app/home/view.tsx`, `apps/web/messages/en.json`: no match (`apps/web/src/auth/**` is
  imported, not edited).
- `docs/tasks/9.2/**`: no match.

## Open questions (each with a recommendation; none blocks the build)

- **Q1. Where the scorecard comes from.** Nothing stores a scorecard yet: 7.8 left storage and the
  "published with each agent version" wiring to 8.7 (lead, 21 Oct 2026, 7.8 Q3), and 8.7 is still
  `todo`. A 9.2 storage choice would pre-empt 8.7's design (for example, package-change gates run only
  the locked suite and cut no new agent version, so a column on the immutable `agent_versions` may not
  fit). Recommend: 9.2 ships the panel, `PublicScorecard` and `toPublicScorecard` (fail closed) with
  the honest "no published scorecard yet" state, and 8.7's plan stores the scorecard and passes it
  through `toPublicScorecard` on the teacher page (a one-line wiring). No fabricated or seeded
  scorecard (PRD S14: it must match the latest gate run). Alternative: Phase A adds an append-only
  `agent_scorecards` table and a public read (about +25 calls in Phase A, and 8.7 writes to it).
- **Q2. The teacher's name in public.** The only name is `users.name` (from sign-in). Recommend:
  show it on verified teachers' cards and pages (teacher pages are public by design, PRD; staff have
  checked identity) and file a follow-up for a teacher-set public display name in the profile (8.1
  form). Search does not match on the name in 9.2 (it lives in another table).
- **Q3. Anonymous `/`.** Recommend: send anonymous visitors to `/teachers` instead of `/sign-in`
  (9.1 left the landing page to 9.2; discovery is the MVP landing, a marketing page comes with the
  launch phase). Staff still go to `/sign-in`.
- **Q4. `GET /api/teachers` and `/api/teachers/:slug`.** Recommend: not built in 9.2; the
  server-rendered pages are the only consumers, and a public JSON API is more surface (scraping, no
  rate limit yet). The `ROUTE_POLICY` rows stay for when a client needs them.
- **Q5. Found while planning (outside 9.2):** 9.3's public reads (`agents.owner`,
  `packageVersions.liveForAgent`, used by `/packages/<agentId>`) do not check the teacher's
  verification, so a teacher rejected after publishing stays startable by typed URL. Recommend a
  follow-up board task: on `setVerification(..., 'rejected')`, suspend the teacher's agents (or add
  the verified join to both reads), with a test.

## Lead answers (22 Oct 2026)
- Q1: accepted. The scorecard panel says "no scorecard yet" until 8.7 stores one; no scorecard storage in 9.2.
- Q2: accepted for the pilot. A verified teacher's sign-in name (`users.name`) shows publicly, since a teacher who publishes chooses to be found. A teacher-set public display name is a follow-up (9.2d). The lead logs this `risk: medium` in Phase A, and the human can change it.
- Q3: accepted. Anonymous visitors to `/` go to `/teachers`.
- Q4: accepted. No public `/api/teachers` endpoints; the pages read through the repository.
- Q5: accepted. Follow-up 9.3c: the package page and `subscriptions.start` refuse a package whose teacher is no longer verified.
- Build order: Phase A starts after 8.6b (#136) merges and runs `git merge origin/main` before it pushes (shared repository index, README, int tests and migrations journal). Phases B and C merge main before pushing (shared en.json).

## Budget

Budget: 270 tool calls (3 phases: A 100, B 80, C 90; packages/db, apps/web)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm install/typecheck/lint/test/build, `db:generate` in Phase A,
`docker compose`, `db:migrate`, `db:seed-discovery`, `next build`/`next start` and `curl` against
localhost for Phase B's timed run, the secret scan). No network beyond localhost, no real model or
payment calls.

## Exit conditions

A phase ends `Status: DONE` when its own tests above, its gate (`typecheck lint test` with the filter
named in the phase) and `python3 .githooks/secret-scan.py --all` are green and its "state after" line
is true; Phase A's handoff also has the printed p50/p95 timings and the `risk: high` decision, and
Phase B's handoff has the manual timed run (p95 < 1 s). A builder stops at `Status: PARTIAL` past its
phase budget (A 100, B 80, C 90), if a file under "Files out of bounds" needs a change, if Phase B or
C starts without the previous phase merged on `main`, or if the manual p95 is 1 s or more (report the
numbers and the slow step; do not tune blindly).

## Status

READY
