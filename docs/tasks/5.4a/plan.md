# Task 5.4a: Access-filter follow-ups (5.4 review MEDIUM/LOW)

Board: milestone M13 · deps `5.4` · risk: risky · `python3 .claude/skills/board/board.py show 5.4a`.
Two phases (two packages), one fresh builder each, mirroring 5.4's own Phase A/B split.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Access-filter follow-ups (5.4 review MEDIUM/LOW): audit rule 1 also catches
db.query.chunks, namespace imports and public.chunks SQL; rule 2 needs a real scope filter; rule 5
covers apps/* once wired; wider file scan; zod Chunk schema in scopedRetrieval, copy then check,
safe id in errors, finite k; whole-turn property test of the access tools filter; cap total
leak-candidate characters; comment on the always-on modules.ids read; fix the flaky updatedAt
clock-skew assertion in packages/db/test/migrate.int.test.ts"

Accept: "each new audit rule is shown failing on a fixture; scopedRetrieval refuses wrong-typed
fields; migrate.int has no clock-skew flake; db and harness tests pass"

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Audit rule 1 (db.query.chunks, namespace imports, public.chunks) | `packages/db/test/access-audit.test.ts`: new fixture strings for `db.query.chunks.findMany(...)`, an aliased namespace import (`import * as t from '../schema/index.js'` + `t.chunks`) and `from public.chunks`, each shown failing rule 1 before the fix and passing after; `repos.chunks` (the Repositories member) still passes clean. |
| Audit rule 2 (real scope filter) | A fixture with the bare word "scope" inside a string literal or an unrelated identifier is shown NOT satisfying the tightened rule; a statement with `${scope}`, `scoped(` or `chunks.teacherId` still passes; the 5 pinned reads in `retrieval.ts` still pass unscathed. |
| Audit rule 5 (apps/*) | Rule 5's scan now also walks `apps/*` for direct `.search(`/`.probe(`/`.leakCheck(` on a `RetrievalIndex`-shaped call outside `access/scopedRetrieval.ts` / `guardrails/lockedLeak.ts`; today it reports none (apps are not yet wired to retrieval), and a fixture proves it would catch one. |
| Wider file scan | `sourceFiles()`/`SOURCE` also match `.cts`/`.cjs`/`.jsx`, and the walk also covers each package/app's top-level non-`src` source folders the builder finds in use (see Design). The scan's remaining limits (destructured/bracket access) are documented as a comment in `access-audit.test.ts`, not in `repositories/README.md` (out of bounds this task; see Files out of bounds). |
| zod Chunk schema, copy then check, safe id, finite k | `packages/harness/src/access/scopedRetrieval.test.ts`: a chunk with a non-string `text` (or other wrong-typed field) is refused with `RetrievalScopeError` and never reaches the result; a getter-style object whose fields differ between two reads is checked and copied from one snapshot; the error message for a bad id is short and well-formed even when the raw id is adversarial; `k = Infinity` (and other non-finite k) returns `[]` without calling the index. Existing cases (extra keys dropped, score optional, type-level cases) still pass. |
| Whole-turn property, access tools filter | `packages/harness/src/access/turn.property.test.ts`: a new case drives one turn through a `decide` stub that ignores the entitlement and offers every registered tool (bypassing `decide`'s own policy pre-filter), then shows the model is still never offered, and a named `tool_call`, an unentitled tool never runs — proving `access/tools.ts`'s filter alone (not `decide`'s) catches it. |
| Cap total leak-candidate characters | `packages/db/src/repositories/retrieval.ts`: `CandidatesSchema` refuses a batch whose candidates are each within the per-item and count caps but whose total character count exceeds a new `LEAK_CANDIDATES_TOTAL_CHARS_MAX`; `test/retrieval-leak.int.test.ts` shows a batch at the limit passes and one over it is refused (reusing the existing `guarded.leakCheck(...).rejects.toMatchObject(...)` pattern at line ~392). |
| Comment on modules.ids read | `retrieval.ts`'s `lockedIndexFor` doc comment states plainly that `repos.modules.ids` is read on every `leakCheck` call, even when the cache is warm, that this is intentional (the key can't be known before it), and that the leakCheck SLO (`test/retrieval-leak.int.test.ts`'s timing case) still holds with it. |
| migrate.int.test.ts clock-skew fix | The brittle cross-statement `updatedAt` ordering assertion at `packages/db/test/migrate.int.test.ts:526` no longer compares two independently-read wall-clock timestamps for strict ordering; the test still proves the publish wrote a fresh `updatedAt` and the right `status`/`liveVersion`. Run `turbo run test --filter=...@edmate/db -- migrate.int` (or the full db int suite) 3× locally with Postgres up to show it no longer flakes. |
| db and harness tests pass | `turbo run typecheck lint test --filter=...@edmate/harness` and `...@edmate/db --force --concurrency=1` (Postgres up), plus the secret scan. |

## Source findings this task closes (from `docs/tasks/5.4/review.md`, all `[deferred 5.4a]`)

Checked against the current code (it has moved since the 5.4 review); every finding below still
applies as described — none is already fixed:

1. **MEDIUM**, audit rule 1 (`access-audit.test.ts:96` in the old review, now `namesChunksTable`
   at `access-audit.test.ts:91-103`): misses `db.query.chunks.findMany()`, a namespace import
   under any alias (today only `s`/`schema`/`tables` are hardcoded in the `member` regex), and
   schema-qualified SQL (`from public.chunks`, which the current `sqlText` regex doesn't match
   because of the `public.` prefix between `from` and `chunks`).
2. **MEDIUM**, `scopedRetrieval.ts` `copyChunk` (now lines 36-48, called from `checkScope` at
   line 69): copies fields with no runtime type check after only an `isObject` check; a
   non-string `text` (or wrong-typed `id`/`moduleId`/etc.) still reaches the returned chunk.
3. **LOW**, `scopedRetrieval.ts` `checkScope` (now lines 55-71): reads `c.teacherId`/`c.moduleId`
   at line 66, then `copyChunk` reads the same fields again at line 69 — two reads of a
   getter-backed object could disagree.
4. **LOW**, `scopedRetrieval.ts` line 67: the error message is `` `chunk ${String(c.id)} is
   outside the entitlement's scope` `` — the raw id, however adversarial, is embedded directly.
5. **LOW**, `scopedRetrieval.ts` `search` (now lines 84-93): `const n = Math.floor(k)` then
   `!(n > 0)` — `Math.floor(Infinity) === Infinity`, and `Infinity > 0` is true, so `k = Infinity`
   is never rejected; the index is called with `n = Infinity` and `.slice(0, Infinity)` is a
   no-op cap.
6. **LOW**, `turn.property.test.ts`: the real `decide` step filters tools by entitlement before
   `access/tools.ts`'s `offeredTools` gets a turn, so a mutation that removed `offeredTools`'s
   filter would not fail this property. Confirmed: no stub or mutation-style test of this exists
   anywhere in `packages/harness/src/access/*` today (checked `tools.property.test.ts` too — it
   tests the pure registry functions, not a full turn).
7. **LOW**, audit rule 2 (`chunkReads`, now lines 106-113): `scoped: /\bscope\b|\bscoped\(|chunks\.teacherId/` —
   the bare word `scope` anywhere in the statement (including inside a string literal, since
   `chunkReads` runs on `code()`, which strips comments but not strings) counts as scoped.
8. **LOW**, audit rule 5 (now lines 204-212): `const harness = files.filter((f) =>
   f.startsWith(HARNESS_SRC))` — apps are never scanned. Confirmed apps are not yet wired to
   retrieval: grepping `apps/**/*.ts` (excluding tests) for `.search(`/`.probe(` on anything
   retrieval-shaped found only `repos.discovery.search` (teacher discovery, unrelated),
   `buffer.search` (`String.prototype.search` in `apps/web/src/chat/sse.ts`) and a `.search({`
   on `apps/web/app/teachers/page.tsx` (also discovery/search-params, not chunks). So today
   extending the scan reports zero violations; the value is closing the gap before M9 wires the
   student app to retrieval.
9. **LOW**, audit file scan (`SOURCE`/`sourceFiles`, now lines 19-48): `SOURCE` doesn't match
   `.cts`/`.cjs`/`.jsx`; `sourceFiles()` only walks each package's `src` and each app's `src`/`app`
   — any package's `scripts`/`bin` folder (or any other top-level source folder) is never reached
   at all, not merely skipped by `SKIP_DIRS`.
10. **LOW**, `retrieval.ts` `leakCheck` (`CandidatesSchema`, now lines 465-470, and `index.hits(
    list.data)` at line 613): per-candidate length and candidate count are both capped
    (`LEAK_CANDIDATE_MAX_LENGTH`, `LEAK_CANDIDATES_MAX`), but nothing caps the **sum** of all
    candidates' lengths, so a maximal-count, maximal-length batch is still up to
    2,048 × 65,536 ≈ 128 MB run through `index.hits()` synchronously; the `leakTimeoutMs` race
    can't interrupt a running synchronous call, only the awaiting caller.
11. **LOW**, `retrieval.ts` `lockedIndexFor` (now lines 538-553): the existing comment (added in
    5.4) explains *why* `revision` and `modules.ids` are read before the cache key is known, but
    doesn't say outright that this read happens on *every* `leakCheck` call even when the cache
    entry is already warm, and that this is accepted because the SLO still holds.
12. Not in `review.md`, but in the board task's title: a flaky `updatedAt` ordering assertion at
    `packages/db/test/migrate.int.test.ts:526` compares two independently-read wall-clock
    timestamps (`agent.updatedAt` from an insert, `published.updatedAt` from a later update) with
    `toBeGreaterThanOrEqual`; under clock skew between the test runner and a remote/containerized
    Postgres (or sub-millisecond timestamp rounding) this can read as `published < agent`.

No finding from the review's deferred list is already fixed; none is dropped.

## Design

### Phase A — harness (`packages/harness`)

- **`scopedRetrieval.ts`**: replace `isObject`/`copyChunk` in `checkScope` with a single parse
  through a **non-strict** view of the contracts `ChunkSchema` (`@edmate/contracts`), e.g.
  `z.object(ChunkSchema.shape)` (the `.shape` pattern is already used in
  `pipeline/assemble.ts`/`assemble.test.ts`). Non-strict (not `ChunkSchema` itself, which is
  `z.strictObject`) so that an index attaching extra top-level keys still has them silently
  dropped — matching the existing, already-approved "copies only the Chunk fields: extra keys an
  index adds are dropped" test — while a wrong-typed field (non-string `text`, etc.) now fails the
  parse and throws `RetrievalScopeError`, closing MEDIUM #2. The scope check (`teacherId`,
  `moduleId` against `allowed`/`locked`) then reads the **parsed** object's fields, not the raw
  input, closing LOW #3 in the same change. The parsed `id` is already bounded (`id()`: 1-128
  safe characters) by the schema, so embedding it in the error message is now safe by
  construction, closing LOW #4 without extra code — keep the message as `` `chunk ${c.id} is
  outside the entitlement's scope}` `` (parsed, not `String(raw.id)`).
- **`scopedRetrieval.ts` `search`**: require `Number.isFinite(k)` alongside `n > 0` (so `Infinity`,
  `-Infinity` are treated as invalid, same as the existing `0`/`-1`/`NaN`/`0.5` cases — no new
  branch, just widen the one guard), closing LOW #5.
- **`turn.property.test.ts`**: add one deterministic `it()` (not a 2,000-iteration property) that
  builds a custom `decide`-shaped step which ignores `ctx.entitlement.skills` and offers every
  tool in the registry, wires it into `testSteps({ admit, entitle, buildContext, decide:
  <stub>, generate })`, drives a turn whose model names a tool outside the entitlement's skills,
  and asserts (a) that tool is never in any `ModelRequest.tools`, and (b) it never runs
  (`tools.runs`). This proves `generate.ts`'s `offeredTools(...)` call (the access filter) is
  itself suf16ficient, not merely redundant with `decide`'s own `policyTools(...)` pre-filter,
  closing LOW #6.
- No new files in Phase A.

### Phase B — db (`packages/db`)

- **`access-audit.test.ts` rule 1** (`namesChunksTable`): add a `db.query.<alias>.chunks` /
  `.query.chunks` detector (drizzle's relational API); generalise the `member` check from the
  hardcoded `s|schema|tables` list to any alias actually bound by a matching namespace import
  (`import * as <alias> from '<schema/internal/@edmate\/db path>'` → flag `<alias>.chunks`), so
  `t.chunks` (or any other alias) is caught without widening to flag unrelated identifiers like
  `repos.chunks` (which must keep passing clean — it's the Repositories member, not the table);
  widen `sqlText` to allow an optional schema-qualifier (`(?:\w+\.)?` before `chunks`) so `from
  public.chunks` is caught too.
- **`access-audit.test.ts` rule 2** (`chunkReads`): tighten `scoped` to require one of the
  literal substrings `${scope}`, `scoped(` or `chunks.teacherId` in the statement, dropping the
  bare `\bscope\b` word match. Re-verify (and if needed, update) the existing "scoped"/"bare"
  fixtures at lines 229-239, and confirm all 5 of `retrieval.ts`'s pinned reads still pass (two use
  `scoped(`, two use `${scope}`, one — `material()`'s `eq(chunks.teacherId, teacherId)` — uses the
  literal `chunks.teacherId`).
- **`access-audit.test.ts` rule 5**: widen the harness-only scan to also cover `apps/*` for
  retrieval-index-shaped `.search(`/`.probe(`/`.leakCheck(` calls (reuse `callsSearchOrProbe`/
  `callsLeakCheck` against `sourceFiles().filter((f) => f.startsWith('apps/'))` the same way as
  for harness, with an allowlist that's empty today or lists only what the builder actually finds
  — expected to be empty per the Source findings section above). A fixture proves it would catch
  a direct `repos.retrieval.search(q, scope, k)`-shaped call in an app file.
- **File scan widening**: add `cts`/`cjs`/`jsx` to `SOURCE`; walk each package's and app's other
  top-level source folders the builder finds actually used for shipped code (e.g. a `scripts` or
  `bin` folder that isn't test-only or build tooling) alongside `src`/`app` — check what exists
  today before deciding exactly which folders to add, so the audit doesn't start scanning
  generated or tooling output. Document the scan's remaining known limits (destructured and
  bracket-access member reads are still out of reach) as a code comment directly in
  `access-audit.test.ts`'s top-of-file doc comment, not in `packages/db/src/repositories/README.md`
  (see Files out of bounds — that file is being edited by another builder on 12.2f right now).
- **`retrieval.ts`**: add `LEAK_CANDIDATES_TOTAL_CHARS_MAX` (derive it the same way as the
  existing per-candidate/count caps' doc comment — the harness's largest legitimate batch total,
  with at least 4× headroom) and enforce it in `CandidatesSchema` via `.refine()` (sum of
  `.length` over the array). Add the explicit "read on every call, even when warm, intentional,
  SLO holds" sentence to `lockedIndexFor`'s doc comment (reference the leakCheck timing test by
  name rather than a specific millisecond number, so the comment doesn't go stale).
- **`retrieval-leak.int.test.ts`**: one new case alongside the existing count/length-limit tests
  (~line 376-396) showing a batch within the per-item and count caps but over the new total-chars
  cap is refused, and one at the new limit still passes.
- **`migrate.int.test.ts`**: replace the brittle `expect(published?.updatedAt.getTime())
  .toBeGreaterThanOrEqual(agent!.updatedAt.getTime())` with an assertion that doesn't depend on
  cross-statement wall-clock ordering — e.g. assert `published?.updatedAt` is a valid `Date` (and,
  if a before/after bound is wanted, compare it against a timestamp taken once in the test's own
  process before the insert, with a generous tolerance) — while keeping the
  `status`/`liveVersion` assertions that are the actual point of the test.

## Files to create

- None. (Both phases only modify existing files and add test cases/fixtures within existing test
  files — no new source or test files.)

## Files to modify

**Phase A** (`packages/harness`):
- `packages/harness/src/access/scopedRetrieval.ts`
- `packages/harness/src/access/scopedRetrieval.test.ts`
- `packages/harness/src/access/turn.property.test.ts`

**Phase B** (`packages/db`):
- `packages/db/test/access-audit.test.ts`
- `packages/db/src/repositories/retrieval.ts`
- `packages/db/test/retrieval-leak.int.test.ts`
- `packages/db/test/migrate.int.test.ts`

## Files out of bounds

- `packages/db/src/repositories/chunks.ts`, `packages/db/src/repositories/map.ts`,
  `packages/db/src/repositories/README.md`, and any `apps/web` studio/staff file — another
  builder is on 12.2f touching exactly these. If any 5.4a finding needs one of them (it doesn't,
  per the Design section above, which routes the audit's scan-limit note into
  `access-audit.test.ts` instead of `README.md`), defer that part of the finding and say so in the
  handoff rather than touching the file.
- `apps/worker/src/commit/**`, `packages/db/src/repositories/learner.ts`,
  `packages/db/src/repositories/sessions.ts` — 6.5c.
- `packages/db/test/repositories.int.test.ts`, `apps/worker` ingest files — 8.2i (not yet started;
  avoid anyway).
- `packages/contracts/**`, `docs/adr/**` — no contracts or port change; `ChunkSchema` is reused
  read-only, not modified.
- `packages/harness/src/guardrails/**`, `packages/harness/src/pedagogy/**` — unchanged (5.4's own
  scope limits, still apply).
- `packages/harness/src/pipeline/tools.ts`, `packages/harness/src/access/tools.ts`,
  `packages/harness/src/access/index.ts` — the tool filter itself is unchanged; Phase A's new test
  exercises it through `generate.ts`/`decide.ts`, it doesn't modify `access/tools.ts`.
- `packages/harness/src/access/entitlement.ts`, `property.test.ts`, `retrieval.property.test.ts`,
  `tools.property.test.ts` — unaffected by this task's findings; don't touch.
- 5.5's calculator/tools; 5.3a's remaining items (HNSW query rewrite, IDF batching, the script's
  Node note, recalibration, the out-of-course set) — a separate task.
- Any `packages/db/src/repositories/README.md` cache-rule or isolation-grid text — unchanged.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/harness/src/access/**` (Phase A: `scopedRetrieval.ts`, `scopedRetrieval.test.ts`,
  `turn.property.test.ts`) — group "The access filter ... money ... sign-in ... keeping each
  teacher's and student's data apart" → **security-reviewer**.
- `packages/db/src/repositories/**` (Phase B: `retrieval.ts`) — same group → **security-reviewer**.
- Not risky: `packages/db/test/**` (`access-audit.test.ts`, `retrieval-leak.int.test.ts`,
  `migrate.int.test.ts`) — explicitly listed as not-risky in 5.4's own plan and not matched by any
  glob in `risk-paths.txt`. No contracts, ADR, guardrails, pedagogy, `.claude` or `.github` path is
  touched.
- Each phase's handoff logs a `risk: high` decision (the board task itself carries `risk: risky`);
  `review.md` for each phase names **security-reviewer** (plus code-reviewer, typescript-reviewer
  as usual).

## Tests first

**Phase A** — write/extend before the source change:
1. `scopedRetrieval.test.ts`: a chunk with a wrong-typed field (non-string `text`, non-string
   `id`, etc. — one `it.each`) → `RetrievalScopeError`, never reaches the output (red against
   today's `copyChunk`, green after the `ChunkSchema`-based parse).
2. `scopedRetrieval.test.ts`: extend the existing `k = %s` case list to include `Infinity` and
   `-Infinity` → `[]`, no call (red today, green after the `Number.isFinite` guard).
3. `scopedRetrieval.test.ts`: an adversarial `id` (e.g. containing the out-of-scope marker text, or
   very long) on a stray chunk — assert the thrown message does NOT contain the marker/raw text
   (this is naturally green once the id is schema-validated before use, but write it as a
   regression case).
4. `turn.property.test.ts`: the new decide-stub case, written to fail against today's code only if
   `access/tools.ts`'s filter were removed — confirm by reading (not modifying) `access/tools.ts`
   that the filter is still there, so this test should already be green; its value is as a
   regression guard, not a red/green cycle in this task.
5. Then make the two source changes in `scopedRetrieval.ts`; confirm the existing
   `scopedRetrieval.test.ts` cases (extra keys dropped, score optional, type-level
   `@ts-expect-error` cases) still pass unchanged.

**Phase B** — write/extend before the source change:
1. `access-audit.test.ts`: new fixture-fails-then-passes cases for rule 1 (`db.query.chunks`,
   aliased namespace import, `from public.chunks`), rule 2 (bare "scope" word inside a string no
   longer counts; `${scope}`/`scoped(`/`chunks.teacherId` still do), and rule 5 (a fixture
   `apps/*`-shaped direct search call is caught). Run them red against the current regexes, then
   green after the regex changes.
2. `access-audit.test.ts`: confirm the real scan still finds `PINNED_CHUNK_READS` scoped reads in
   `retrieval.ts` and still reports the allowlisted `RetrievalIndex` implementers only, unchanged.
3. `retrieval-leak.int.test.ts`: the new total-chars-cap case (over the limit refused, at the
   limit passes) — red against today's `CandidatesSchema`, green after the `.refine()`.
4. `migrate.int.test.ts`: run the file 3× locally with Postgres up before touching it, to confirm
   the flake is real and roughly how often it occurs, then fix and re-run 3× to show it's gone.

## Gate

- Phase A: `turbo run typecheck lint test --filter=...@edmate/harness` (dependents: db, web,
  worker — per `docs/lessons.md`'s "gate dependents in briefs", confirm nothing downstream imports
  `scopedRetrieval`'s exact error message or relies on the pre-fix `k=Infinity` behavior; expected
  to be fine since this is a bug fix, not a signature change).
- Phase B: `turbo run typecheck lint test --filter=...@edmate/db --force --concurrency=1` with
  Postgres up, plus the secret scan.

## Open questions (each with a recommendation)

- **Q1. Should `access-audit.test.ts` rule 5 extend to `apps/*` now, even though apps aren't yet
  wired to retrieval (checked: zero current hits)?** Recommend: yes, extend now — it's cheap (reuse
  the same `callsSearchOrProbe`/`callsLeakCheck` helpers against a wider file list), the finding
  explicitly asks for it "once wired," and closing the gap before M9 starts wiring the student app
  is safer than doing it under M9's time pressure. Log the (expected-empty) allowlist for apps the
  same way as for harness.
- **Q2. Should `scopedRetrieval.ts`'s new parse use `ChunkSchema` itself (`z.strictObject`) or a
  non-strict view (`z.object(ChunkSchema.shape)`)?** Recommend: non-strict — `ChunkSchema` is
  `strictObject`, and using it directly would turn the existing, review-approved "extra keys an
  index adds are dropped" behavior into a scope-error (since strict objects reject unknown keys),
  breaking `scopedRetrieval.test.ts`'s current passing case. The non-strict shape view keeps that
  behavior while still catching wrong-typed known fields.
- **Q3. Exactly how should the `migrate.int.test.ts` clock-skew assertion be loosened?** Recommend:
  drop the specific `updatedAt >= agent.updatedAt` cross-statement comparison; keep (or replace it
  with) an assertion that `published.updatedAt` is a valid, recent `Date` and that
  `status`/`liveVersion` changed — those are what the test is actually checking for. If a
  before/after bound is still wanted, compare against a timestamp read once by the test process
  itself (e.g. just before the insert) with a tolerance of at least a few seconds, not against
  another DB-returned timestamp.
- **Q4. Which non-`src`/`app` folders (if any) does the file-scan widening actually need to walk?**
  Recommend: the builder greps the repo first (e.g. `find packages apps -maxdepth 2 -type d` or
  similar, excluding `node_modules`/`dist`) to see whether any package currently ships source
  outside `src` (a `scripts` or `bin` folder with real, non-test, non-tooling code) before adding
  it to `sourceFiles()` — don't guess; only widen to folders that actually exist and actually carry
  shippable code today, to avoid scanning build tooling or scripts that are deliberately exempt.

## Decisions (draft, for the handoff)

- The audit's scan-limit note moves into `access-audit.test.ts`'s own top-of-file comment, not
  `packages/db/src/repositories/README.md`, because another builder (12.2f) is editing that file
  concurrently (planner, low).
- `scopedRetrieval.ts`'s chunk parse uses a non-strict view of the contracts `ChunkSchema`
  (`z.object(ChunkSchema.shape)` or equivalent), not the strict schema itself, to preserve the
  existing "extra keys dropped" behavior while catching wrong-typed fields (planner, medium; Q2).
- `access-audit.test.ts` rule 5 is extended to `apps/*` now, ahead of M9's retrieval wiring
  (planner, low; Q1).
- No ADR and no `packages/contracts` change — `ChunkSchema` is read, not modified (risk: high,
  logged per the board task's `risk: risky` and the risky paths touched above).

## Budget

Budget: 70 tool calls (2 phases, packages: harness, db)

## Allowed tools

Read, Grep, Glob, Edit, Bash (tests, typecheck, lint, and the secret scan only — no installs
beyond `corepack pnpm install` if needed, no new dependencies).

## Exit conditions

- **DONE**: both phases' gates (`turbo run typecheck lint test`) are green, every item in the
  "How it is shown" table has the described test, `access-audit.test.ts`'s fixtures demonstrate
  each tightened/widened rule failing before the fix and passing after, `migrate.int.test.ts`
  passes 3 consecutive local runs with Postgres up, and the handoff logs the `risk: high` decision
  naming security-reviewer.
- **PARTIAL**: a builder stops and hands off with what's green so far if — past roughly 35 tool
  calls in a single phase with no green commit yet; a fix touches a file outside this plan's
  modify list (e.g. the migrate.int.test.ts flake turns out to need a schema or migration change,
  not a test change); or `access-audit.test.ts` rule 5's `apps/*` extension turns up an actual
  unscoped call (that's a new, separate finding, not a trivial audit-only fix — stop and hand off
  rather than fixing the app code under this plan).

## Lead answers (27 Oct 2026)
- Q1: extend audit rule 5 to apps/* now. If it finds a live violation, stop with PARTIAL and report it; don't fix app code in this task.
- Q2: non-strict `z.object(ChunkSchema.shape)`, so extra keys are still dropped; keep the existing "extra keys dropped" test green.
- Q3: drop the cross-statement timestamp-ordering compare; keep the status and liveVersion assertions.
- Q4: the builder greps the repo for the folders to walk before widening the scan, and lists the folders chosen in the handoff.
- Build runs as two fresh builders, Phase A (harness) then Phase B (db), on one branch; about 35 tool calls each.
