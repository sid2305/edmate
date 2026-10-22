# 8.6 plan: Package builder (modules, skills, help limits, daily limit, live classes, price, trial, locked reply, AI cost estimate)

Board: milestone M8 · deps `1.3`, `5.1`, `5.2`, `8.1` (done). `needs_decision: default-model-mix` is
answered by B-42 (22 Oct 2026, human, risk: high). Packages touched: `packages/gateway`,
`packages/db`, `apps/web`. Four phases, one fresh builder each. Phases A and B share no file and can
run at the same time; C needs A and B merged; D needs C merged.

Build-order dependencies outside this task: **Phase C needs 8.4a merged** (`styleCards.latest`, the
id the agent's first version pins) and **8.3a** (merged: `courses.ensureDefault`, `outline.getOutline`).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Package builder: modules, skills, help limits, daily limit, live classes, price, trial, locked reply, AI cost estimate"
Accept: "two packages in < 15 minutes; estimate shown per package."

### How it is shown (paste into the last phase's handoff.md)

| Item | Evidence |
|---|---|
| Every field is set and stored | `PackageConfig` (contracts, unchanged) already has `moduleIds`, `skills`, `helpCeiling` + `finalAnswers` (help limits), `dailyMessageLimit`, `liveClassesPerMonth`, `pricePerMonth`, `trialDays`, `lockedReply`. Int test (Phase B): `packages.create` then `packages.saveVersion` round-trips every field through `package_versions.config`; version goes 1 → 2; `packages.name` follows the config name. |
| The teacher's agent exists | Phase B `agents.ensureDraft` creates the `agents` row (`draft`) and `agent_versions` v1 with the course id (8.3a), the latest style card id (8.4a), the newest signed prompt-pack set, `languages: ['en']` and `modelPolicy` from the model-mix table (B-42). Int test: two concurrent calls make one agent; `agentVersions.get` returns a config that passes `AgentConfigSchema`; a foreign course or style card id is `not_found`. This is the 8.4 plan's Q1 proof: `turnConfigStoreFor(...).load` reads that agent's style card. |
| Estimate shown per package | Phase A `turnCostMicroUsd(MODEL_MIX.paid, prices)` (unit test with fixed prices: exact micro-USD). Phase C every package in `GET/POST/PUT /api/studio/packages` carries `estimate: { typicalMicroUsd, maxMicroUsd }`. Phase D `PackagesView.test.tsx`: each package card shows "about $X a month per subscriber (up to $Y)"; the form shows the live estimate as the daily limit changes. |
| Two packages | Phase D component test: from an empty state, the "Free starter" and "Full course" presets, one edit each and Save create two packages (two POSTs with the exact bodies), and both cards render with estimates. |
| < 15 minutes | **Manual timed walkthrough** on the dev stack (precedent: 8.3 Phase C, 9.1 Lighthouse): a signed-in teacher with a style card and an outline creates two packages from scratch; start and end timestamps pasted into the Phase D handoff. Not a CI assertion (lessons.md: wall-clock bounds fail on shared CI runners). |
| Nothing charges | No `packages/payments` import; price is stored and shown only (Payments come last, 18 Oct 2026). |
| No contracts change | `git diff origin/main -- packages/contracts` is empty. |
| No real model calls | No phase calls a model; the estimate is arithmetic over the price table. |

## Scope decisions (MVP: US pilot, English only; logged in handoffs, not blockers)

1. **The model mix is one code table** in `packages/gateway/src/router/default-policy.ts`:
   `MODEL_MIX: { free: ModelPolicy; paid: ModelPolicy }`, both rows `{ small: anthropic
   claude-haiku-4-5, main: anthropic claude-sonnet-5 }` (B-42). `DEFAULT_MODEL_POLICY` becomes
   `MODEL_MIX.paid` (same export, so current importers, 8.4a's style-card runtime included, need no
   edit). A later live run changes one row in one file. See Q2.
2. **The model policy is per agent, not per package.** `AgentConfig.modelPolicy` is what the harness
   reads (`runner.ts` `turnPolicies(agent.modelPolicy)`). With both rows equal (B-42) the agent takes
   `MODEL_MIX.paid`. If the rows ever differ, a per-package policy is a contracts change with an ADR;
   noted, not built.
3. **One agent per teacher** (MVP: one course per teacher). `agents.ensureDraft` is idempotent under
   a per-teacher `pg_advisory_xact_lock` (same pattern as 8.3a's `courses.ensureDefault`); no
   migration, no unique index (keeps several courses per teacher open for later).
4. **Package versions are immutable**: every save writes a new `package_versions` row (next version =
   max + 1 under a `FOR UPDATE` lock on the `packages` row; the existing unique index
   `package_versions_package_id_version_key` is the race backstop). `packages.live_version` stays
   null: publishing is 8.7.
5. **The estimate depends on the daily limit only** (the mix is the same on every package). Per turn:
   one `main` call plus the `small` calls (router, guards, classifiers), from named provisional token
   constants (Q3). Per subscriber per month: typical = half the daily limit on 20 days; maximum = the
   full limit on 30 days. For a paid package the card also shows the maximum as a percentage of the
   price, with a plain warning above 25% (PRD cost check). USD only.
6. **No payment, no floor price.** Price is `{ amountMinor, currency: 'USD' }` (currency set by the
   server); `0` = free. A paid package starts with no payment until M10.
7. **No delete** of a package in this task (drafts are harmless, never shown to students before 8.7
   publishes them). See Q8.

## Migration

None. The latest migration is `0019_outline_topic_chunks.sql`; `agents`, `agent_versions`,
`packages`, `package_versions`, `courses` and `style_cards` already have every column this task
needs. (If a reviewer asks for a DB backstop, the next free number is `0020`; check
`packages/db/migrations/` at build time, since 8.3b/8.4a/8.5a run in parallel.)

## Phase A: packages/gateway: model-mix table, Sonnet 5 price, per-turn cost (budget 60)

Tests first:
- `packages/gateway/src/router/default-policy.test.ts` (new): `MODEL_MIX.free` and `.paid` both
  `small = claude-haiku-4-5`, `main = claude-sonnet-5`, both pass `ModelPolicySchema`, frozen;
  `DEFAULT_MODEL_POLICY === MODEL_MIX.paid`.
- `packages/gateway/src/pricing/estimate.test.ts` (new): `turnCostMicroUsd(policy, prices,
  assumptions)` with a fixed price table gives an exact integer micro-USD; a model missing from the
  price table **throws** a named error (`UnpricedModelError`, the model id only), never returns 0
  (lessons.md: a check that silently skips looks like a pass); the bundled table prices every model
  in `MODEL_MIX` (this test fails if someone changes the mix without adding a price).

Files:
- Modify `packages/gateway/src/router/default-policy.ts` (MODEL_MIX; header comment cites B-42),
  `packages/gateway/src/router/index.ts` (export `MODEL_MIX`).
- Modify `packages/gateway/src/pricing/prices.yaml` (add `claude-sonnet-5`, price per Q1; keep
  `claude-sonnet-4-5`, the seed still uses it) and regenerate `prices.generated.ts` with
  `corepack pnpm --filter @edmate/gateway generate:prices` (never hand-edit).
- Create `packages/gateway/src/pricing/estimate.ts`: `TURN_TOKEN_ASSUMPTIONS` (one named, commented
  table: main input/output tokens, small call count and tokens per call; Q3) and
  `turnCostMicroUsd`, reusing `cost.ts`'s arithmetic. Modify `packages/gateway/src/pricing/index.ts`
  (and `src/index.ts` if that is where the public exports live) to export them.
- Gate: `turbo run typecheck lint test --filter=@edmate/gateway...` (the `...` covers dependents,
  apps/web included).

State after Phase A: the mix and the per-turn cost exist and are exported; nothing in the studio
uses them yet; live turns of any agent built from `DEFAULT_MODEL_POLICY` now name `claude-sonnet-5`.

## Phase B: packages/db: agent bootstrap and package repository (budget 120)

Tests first:
- `packages/db/test/packages.int.test.ts` (new, real Postgres): `agents.ensureDraft` creates one
  agent + v1 (twice in parallel → one agent, one version); it rejects a course or style card that is
  not the scope's (`not_found`, nothing written) and a config failing `AgentConfigSchema`
  (`invalid`); `packages.create` writes the `packages` row and version 1 in one transaction and
  returns `{ packageId, version: 1 }`; a module of another teacher → `scope`, nothing written (no
  orphan `packages` row); `packages.saveVersion` writes version 2 and updates `packages.name`; a
  package of another teacher or another agent → `not_found`; `listForTeacher` returns each package
  once with its newest config, `liveVersion` null, ordered by creation, capped at `PACKAGES_MAX`
  (20); an audit row `package.save` per write with `{ packageId, version }` only (no price, no
  names).
- `packages/db/test/repositories.int.test.ts`: isolation `CASES` for `agents.ensureDraft`,
  `packages.create`, `packages.saveVersion`, `packages.listForTeacher` (`tsc` requires them).

Files:
- Modify `packages/db/src/repositories/agents.ts`: `ensureDraft(scope, { courseId, styleCardId,
  promptPackVersion, modelPolicy })` → `{ agentId, version }`. One transaction: advisory lock
  `agent:<teacherId>`; return the teacher's existing agent (and its newest version number) if any;
  else check the course and style card are the scope's (`FOR KEY SHARE`), insert `agents`
  (`draft`) and `agent_versions` v1 with a config parsed by `AgentConfigSchema` (`languages:
  ['en']`). The caller passes no teacher id inside the config; the repo builds it from the scope.
- Create `packages/db/src/repositories/packages.ts`: `packagesRepo(db)` with `create(scope, { agentId,
  draft })`, `saveVersion(scope, { packageId, draft })`, `listForTeacher(scope)`. `draft` is a
  `PackageConfig` without `id`, `version`, `teacherId`, `agentId` (`PackageConfigSchema.omit(...)`,
  local type, no contracts edit); the repo fills those from the scope and the rows and parses the
  full config with `PackageConfigSchema`. Module ownership: the same `FOR KEY SHARE` check
  `packageVersions.create` does, in the same transaction. Do not edit `package-versions.ts` (8.5a);
  the duplicated ~15-line check is logged as a follow-up to share once 8.5a merges.
- Modify `packages/db/src/repositories/index.ts` (wire `packages: guardAll('packages', ...)`, export
  `PACKAGES_MAX`, `PackageDraft`, `TeacherPackageRow`), `packages/db/src/repositories/map.ts` only if
  a new row parser is needed (prefer reusing `toPackageConfig`/`toAgentConfig`),
  `packages/db/src/repositories/README.md` (the two new repos/methods; ownership columns never
  updated: only `packages.name` changes).
- Gate: `turbo run typecheck lint test --filter=@edmate/db...`.

State after Phase B: a teacher's agent and packages can be created, versioned and listed through
`packages/db`; nothing calls them yet.

## Phase C: apps/web: studio packages API (budget 110)

Reads Phase A and B handoffs (exact names). Standalone modules on the `profile.ts` pattern, so it
edits none of `apps/web/src/studio/{index,routes,runtime,outline}.ts` (8.3b, 8.4a).

Tests first (memory backend, no database, no model: rule 4):
- `apps/web/src/studio/packages.test.ts`: GET with no agent → `{ packages: [], modules, setup }`
  where `setup` says whether a style card exists; POST creates the agent on first use (calls
  `courses.ensureDefault`, `styleCards.latest`, `agents.ensureDraft`, then `packages.create`) and
  returns the package with its estimate; POST with no style card → 409 `style_card_required`, nothing
  written; PUT `{ packageId, ...draft }` saves a new version; body validation (strict zod, ranges in
  Q4–Q7) → 400 with no write; `teacherId`/`agentId`/`currency` in the body are rejected by the strict
  schema, never read; a repo `scope`/`not_found` → 404; body over the size cap → 413 before parsing;
  every response `cache-control: no-store`.
- `apps/web/src/studio/costEstimate.test.ts`: `monthlyEstimate(perTurnMicroUsd, dailyLimit,
  priceMinor)` → `{ typicalMicroUsd, maxMicroUsd, shareOfPrice? }`, exact integers; free package
  has no `shareOfPrice`.
- `apps/web/src/studio/packagesRuntime.test.ts`: the lazy backend picks the newest signed prompt-pack
  set from the content dir; no signed set → `StudioUnavailableError` → 503, logged by code only.

Files:
- Create `apps/web/src/studio/packages.ts` (`createPackageHandlers(backend)`: `list`, `create`,
  `update`; imports `readJson`/`TOO_LARGE`/`MAX_BODY_BYTES` from `./routes` read-only),
  `apps/web/src/studio/packagesRuntime.ts` (repos from `serverDatabase()`, `contentDir` +
  `readPromptPackLibrary` + `newestSignedSet` for the pack version, `MODEL_MIX.paid`,
  `loadBundledPrices()` → per-turn cost computed once), `apps/web/src/studio/costEstimate.ts`
  (pure, no server imports, so the Phase D client form can import it), and the three tests above.
- Create `apps/web/app/api/studio/packages/route.ts`: `GET`, `POST`, `PUT`, each `withRole(['teacher'],
  ...)`. `ROUTE_POLICY`'s `/api/studio/**` row already allows these methods; `route-coverage.test.ts`
  picks the file up. Do not edit `apps/web/src/auth/**`.
- Gate: `turbo run typecheck lint test --filter=@edmate/web...`.

State after Phase C: a teacher can create, edit and list packages with estimates through the API.

## Phase D: apps/web: package builder page (budget 110)

Tests first: `apps/web/app/teacher/packages/PackagesView.test.tsx` (RTL + jest-axe, fetch stubbed
with an in-memory packages API, as `UploadsView.test.tsx`): empty state; "set up your style card
first" state with a link to the style card page when `setup` says none; the two-presets flow in the
acceptance table; editing a package saves a new version; module checkboxes come from the GET
`modules`; trial input hidden at price 0; the live estimate updates with the daily limit; the 25%
warning; zero axe violations. `page.test.tsx` for the role gate.

Files:
- Create `apps/web/app/teacher/packages/page.tsx`, `PackagesView.tsx` (client; list of package cards
  + one form; presets "Free starter" = $0, explain + practice, help ceiling 2, `finalAnswers:
  'after_attempt'`, 10 messages/day, 0 live classes, `lockedReply: 'name_package'`; "Full course" =
  $29, every offered skill, ceiling 3, 20/day, 2 live classes, 7-day trial), `PackagesView.test.tsx`,
  `page.test.tsx`.
- Modify `apps/web/app/teacher/view.tsx` + `view.test.tsx` (a "Packages" nav link) and
  `apps/web/messages/en.json` (a new top-level `packages` key; English only).
- Manual timed walkthrough (acceptance table) on the dev stack, timestamps in the handoff.
- Gate: `turbo run typecheck lint test --filter=@edmate/web...`.

State after Phase D (task done): a signed-in teacher builds and edits packages end to end with an
estimate on each; nothing is published or charged.

## Shared files (the lead orders the builds)

- Phase B: `packages/db/src/repositories/index.ts`, `packages/db/test/repositories.int.test.ts`
  (8.4a running; 8.5a's plan edits both), `packages/db/src/repositories/README.md` (8.5a). Unavoidable:
  every new repo method must be wired and listed in the isolation table.
- Phase D: `apps/web/app/teacher/view.tsx` + `view.test.tsx` (8.3 Phase C, 8.4 Phase B likely),
  `apps/web/messages/en.json` (8.3 Phase C, 8.4, 8.5). Unavoidable for the nav link and the strings.
- Phases A and C: none. C imports `apps/web/src/studio/routes.ts` (8.3b) read-only; Phase A changes
  the value of `DEFAULT_MODEL_POLICY` that 8.4a imports, not its shape.

## Files out of bounds

- `packages/contracts/**`, `docs/adr/**` (no contracts change; scope decision 2).
- `packages/db/src/repositories/{package-versions,agent-versions,style-cards,outline,corrections}.ts`
  (8.5a, 8.4a, 8.3a/b own them; this task only calls their methods).
- `apps/web/src/studio/{index,routes,runtime,outline,profile,files}.ts`, `apps/web/app/api/studio/outline/**`,
  `apps/web/src/auth/**` (risky; `ROUTE_POLICY` already allows `/api/studio/**`).
- `packages/payments/**` (M10), `packages/db/src/seed.ts` (keeps `claude-sonnet-4-5` so 9.0's try-it
  stays stable; Q9), `packages/harness/**`, `content/**`.
- A builder that finds it needs any of these stops at `Status: PARTIAL` and reports it.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- Phase B: `packages/db/src/repositories/**` (`agents.ts`, new `packages.ts`, `index.ts`, `map.ts`,
  `README.md`). **Reviewers: security-reviewer** (teacher data isolation; money fields). Recommend
  `database-reviewer` too as practice (advisory lock, row lock, version numbering), not
  gate-required (no migration). Phase B's handoff logs a `risk: high` decision.
- Phase A: `packages/gateway/src/router/**`, `src/pricing/**`: no match (only `packages/gateway/src/keys/**`
  is listed). Not gate-risky; the handoff still logs the B-42 implementation as a decision.
- Phase C: `apps/web/src/studio/**`, `apps/web/app/api/studio/**`: no match (`apps/web/src/auth/**`
  is imported, not edited). Phase D: `apps/web/app/teacher/**`, `apps/web/messages/en.json`: no match.
- `docs/tasks/8.6/**`: no match.

## Lead answers (22 Oct 2026)
- Q1: Claude Sonnet 5 costs $2 per million input tokens and $10 per million output tokens (cache read $0.20, 5-minute cache write $2.50), from the Claude pricing page (platform.claude.com/docs/en/about-claude/pricing), checked 22 Oct 2026. The planned rise to $3/$15 will not happen. Phase A adds `claude-sonnet-5` to `prices.yaml` at these numbers, and does not stop PARTIAL.
- Q2: accepted. The model mix is a code table, not a database table.
- Q3: accepted. The estimate's token assumptions are provisional and labelled so, and are replaced with 7.6 numbers when a live run lands.
- Q4–Q6: accepted as recommended. They are MVP limits; the lead logs them, and the human can change them later.
- Q7: accepted. A package needs a style card first: 409 with a link to the style card, never a blank card.
- Q8: accepted. 8.7 publish makes a fresh agent version; no package delete.
- Q9: accepted. Repointing the demo seed is a follow-up after 9.0.
- Presets: no preset shows the AI-cost warning at its default settings. Phase D sets the "Full course" default daily limit (or its price) so the at-most estimate stays under 25%, and logs the numbers as a decision.

## Open questions (each with a recommendation)

- **Q1. The `claude-sonnet-5` list price for `prices.yaml`.** It is not in the table, and an
  unpriced model meters with no cost and makes the estimate wrong. Recommend: the lead has
  `docs-lookup` confirm the provider's list price and writes it under "Lead answers" before Phase A;
  if it can't be confirmed, use Sonnet 4.5's $3 / $15 per million marked `# provisional (8.6)` in the
  yaml and logged, to be checked when 7.6's next live run lands. The builder never guesses.
- **Q2. "One config table": code or database?** Recommend the code table (scope decision 1): no
  migration, no admin screen, a one-row change in one file, reviewed like any PR. A database table
  (migration `0020`) only pays off once staff need to change the mix without a deploy.
- **Q3. Per-turn token assumptions for the estimate.** Recommend provisional constants in
  `TURN_TOKEN_ASSUMPTIONS`: main call 5,000 input / 500 output tokens; 4 small calls of 1,200 input /
  60 output. That is about $0.029 a turn at Sonnet 4.5-class prices, so a 20-message package shows
  about $5.70 typical and $17 maximum a month (matches the PRD cost check). Replace them with 7.6's
  measured cost per turn once a live sweep has run; the card says "estimate".
- **Q4. Price range.** Recommend $0 (free) or $1 to $1,000 a month in whole cents, USD only, no
  floor price until 10.4 decides revenue share; trial 0–30 days, paid packages only.
- **Q5. Skills offered.** Recommend every skill except `study_plan` (MVP-out in the PRD); at least
  one skill.
- **Q6. Limits.** Recommend daily messages 1–100 (default 20, the contract's default), live classes
  0–8 a month, at least one module, name 1–80 characters, at most 20 packages per teacher.
- **Q7. No style card yet.** Recommend 409 `style_card_required` and a link to the style card page;
  never create a blank card (the agent would have no voice).
- **Q8. A stale agent version.** The agent's v1 pins the style card and mix of the day it was made.
  Recommend: 8.7 (publish) cuts a fresh agent version with the latest style card, course and
  `MODEL_MIX` at publish time; 8.6 does not version the agent again. Package delete is deferred to a
  follow-up if a teacher asks.
- **Q9. The demo seed still names `claude-sonnet-4-5`.** Recommend a small follow-up board task to
  point `seed.ts` at the B-42 mix after 9.0's try-it guide is checked, so the demo isn't changed
  mid-test.

## Budget

Budget: 400 tool calls (4 phases: A 60, B 120, C 110, D 110; packages/gateway, packages/db, apps/web)

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm install/typecheck/lint/test/build, `generate:prices` in
Phase A, the secret scan). No `db:generate` (no migration), no network, no real model or payment
calls.

## Exit conditions

A phase ends `Status: DONE` when its own tests above, its gate (`typecheck lint test` with the
filter named in the phase) and `python3 .githooks/secret-scan.py --all` are green, and its "state
after" line is true; Phase D also needs the manual timed walkthrough in its handoff. A builder stops
at `Status: PARTIAL` past its phase budget (A 60, B 120, C 110, D 110), if a file under "Files out
of bounds" needs a change, if Phase C finds 8.4a's `styleCards.latest` not on `main`, or if Q1 has
no lead answer when Phase A starts.

## Status

READY
