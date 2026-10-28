# 5.1b plan — ingest follow-ups from 5.1's review LOWs

## Accept (verbatim)
"the four LOWs in docs/tasks/5.1/review.md are fixed with tests where behaviour changes; the ingest
gate passes" (board `accept` for 5.1b). Shown by: `corepack pnpm turbo run typecheck lint test
--filter=@edmate/ingest...` green (13+ files, coverage gate), plus the new/updated unit tests below.

## Per-item status (checked against main, 28 Oct 2026)

1. **html.ts DomNode double cast** — OPEN. `packages/ingest/src/parse/html.ts:133` is still
   `walker.walk(body as unknown as DomNode)`; the hand-rolled `DomNode` interface (line 11-17) still
   makes `data` required while real domhandler/cheerio nodes (comments, `<br>`, element nodes with no
   text child) have it absent. Fix: a type guard on cheerio's node type (e.g. `AnyNode` from
   `domhandler`/`cheerio/slim`) that narrows to the walker's needs, replacing the double cast with one
   checked assertion; make `DomNode.data` optional and update `textOf`/`Walker` call sites (lines
   ~66-114) to treat `undefined` as `''`.
2. **pptx.ts attributes typed `Record<string, string | undefined>`** — OPEN.
   `packages/ingest/src/parse/pptx.ts:53-60` (`elements()`) still returns `Record<string, string>[]`;
   callers at lines 96 (`a['r:id']`), 100-101 (`a.Id`, `a.Target`) read attributes that are absent for
   malformed XML. Fix: change the return type to `Record<string, string | undefined>[]`, keep
   `elements[':@'] ?? {}` as-is, and make the two call sites (`slideOrder`, lines 87-109) handle
   `undefined` explicitly — they already throw `damaged()` when a value is missing, so this is a type
   fix with no behaviour change (no new test needed; existing damaged-PPTX fixtures cover it).
3. **package.json cheerio/slim + pdfjs-dist/legacy subpath** — `[wontfix]` in review.md, not one of
   the four `[deferred 5.1b]` items. Out of scope here.
4. **zip.ts destroys (not pauses) the stream on budget overflow** — OPEN.
   `packages/ingest/src/parse/zip.ts:48-49` still calls `stream.pause()` then rejects; JSZip's
   `internalStream()` returns its own `GenericWorker`/`StreamHelper` chain (not a Node `Readable`), so
   there is no public `.destroy()`. `pause()` only stops *future* chunks; the chunk already mid-flight
   (and the inflate work already scheduled for it) still completes. The closest real "destroy" in
   JSZip's own API is the worker's `.error(e)`, which marks the chain `isFinished`, propagates the
   error to `this.previous` (tearing down the inflate worker too), and calls `cleanUp()` — see
   `node_modules/.pnpm/jszip@3.10.2/node_modules/jszip/lib/stream/GenericWorker.js:74-96`. Fix: extend
   the local `Streamable` interface (zip.ts:13-15) with the worker-level `error(e: Error): void` JSZip
   exposes at runtime but omits from its public `.d.ts`, and call that instead of `.pause()` on
   overflow, before `reject(...)`.
5. **package.json: keep pdfjs-dist's optional `@napi-rs/canvas` out of installs** — OPEN.
   `packages/ingest/package.json` depends on `pdfjs-dist@6.4.299`, which lists `@napi-rs/canvas`
   (`1.0.11`) as an `optionalDependency` (`pnpm-lock.yaml:7882-7884`), which in turn lists 11
   platform-specific native binary packages as its own optionals (`pnpm-lock.yaml:5641-5653`;
   confirmed present and installed today at `pnpm-lock.yaml:1830-1901`). None of these packages carry
   `requiresBuild`/`hasBin` in the lockfile — napi-rs ships prebuilt binaries with no install script,
   the same pattern already called out for esbuild/`@swc/core`/`@parcel/watcher` in
   `pnpm-workspace.yaml:9-11` — so `allowBuilds` (pnpm-workspace.yaml:12-17) does not apply (there is
   no script to allow or block). The LOW's real ask is to stop *downloading* the unused binaries, not
   to block a script. Fix: add pnpm's `ignoredOptionalDependencies` setting next to `allowBuilds`:

   ```yaml
   # pnpm-workspace.yaml, new top-level key after allowBuilds (after line 17)
   ignoredOptionalDependencies:
     - "@napi-rs/canvas"
   ```
   One file, one new key (plus a one-line comment citing this task and docs/decisions/log.md's pin
   decision). This does not add, remove or swap a dependency or library — pdfjs-dist is unchanged,
   only its already-optional, already-unused-for-text-extraction native dependency stops being
   installed — so it is a config change, not a tech-stack change, and does not need an ADR.
   **Lockfile changes:** yes — `pnpm install` after this edit must drop the `@napi-rs/canvas` and
   `@napi-rs/canvas-*` entries from `pnpm-lock.yaml` (currently lines 1830-1901, 5607-5653, 7883-7884).
   The builder must run the install and diff the lockfile to confirm those entries are gone, not
   merely marked skipped, and then run the ingest suite (especially `pdf.test.ts`, `pdf-errors.test.ts`)
   to confirm text extraction is unaffected — it already doesn't touch canvas, per the pin decision in
   `docs/decisions/log.md:14500` and `docs/tasks/5.1/handoff.md:68`. If `ignoredOptionalDependencies`
   turns out not to be honored at this pnpm version (12.14.0, `package.json:5`) after a real install,
   stop and log a decision that it stays installed (amend the wontfix) rather than inventing another
   mechanism — do not touch `packages/contracts` or add a stub dependency to work around it.

No item needs an ADR; none touch `packages/contracts` or the tech stack.

## Files touched
- `packages/ingest/src/parse/html.ts` (type guard + optional `data`)
- `packages/ingest/src/parse/pptx.ts` (attribute type only)
- `packages/ingest/src/parse/zip.ts` (`error()` instead of `pause()` on overflow, `Streamable`
  interface extended)
- `packages/ingest/test/parse/zip.test.ts` (new test, item 4)
- `packages/ingest/test/parse/html.test.ts` and/or `pptx.test.ts` (only if the type-guard change
  alters any runtime behaviour for malformed input; otherwise typecheck + existing fixtures cover it)
- `pnpm-workspace.yaml` (new `ignoredOptionalDependencies` key, item 5)
- `pnpm-lock.yaml` (regenerated by `pnpm install`, item 5 only)

**Out of bounds:** everything else in `packages/ingest`, all of `packages/harness` (two builders are
running there — guardrails and the post-guard pipeline), `packages/contracts`, any other
`pnpm-workspace.yaml` key, `.npmrc` (does not exist; do not create one).

## Tests first
- `zip.test.ts`: a multi-chunk overflow case (reuse the existing `'a'.repeat(200_000)` bomb pattern,
  but a file large enough to span at least two `data` events) asserting that once the budget is
  exceeded, the worker chain is torn down — e.g. a spy/counter on a second large entry read from the
  same `zip` confirms no further chunks are processed after the error (not just that the promise
  rejects, which already passes today). Write this test to fail against the current `pause()`
  behaviour before changing zip.ts, per build-plan TDD.
- `html.test.ts`: a fixture with a comment node and a childless element (both lack `.data` today)
  confirming no throw and correct text output, if the guard changes runtime behaviour for these
  cases; otherwise this is typecheck-only and no new test is needed (state which in the handoff).
- pptx: typecheck-only; no behaviour change, no new test required (existing damaged-PPTX fixtures in
  `pptx.test.ts` already cover missing `r:id`/`Target`).
- Item 5: no unit test (install config); verified by lockfile diff + the full ingest suite passing
  with no network/model calls (unchanged — ingest tests already use fixtures only).

## Risky paths touched
None (checked against `.claude/skills/merge-gate/risk-paths.txt`): `packages/ingest/**` and
`pnpm-workspace.yaml` match none of the listed globs (not `packages/harness/guardrails`, not
`packages/harness/pedagogy`, not access/payments/auth, not `packages/contracts`, not `.claude`/
`.github`/`.githooks`). No `risk: high` decision needed.

## Open questions
- None blocking. One contingent question is already resolved above: if
  `ignoredOptionalDependencies` doesn't take effect, the builder logs a decision and stops rather than
  improvising — that is a build-time finding, not a plan-time blocker.

## Budget
Budget: 35 tool calls (1 phase, packages/ingest + pnpm-workspace.yaml)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm install, typecheck/lint/test for @edmate/ingest, secret
scan only)

## Exit conditions
Status: DONE when all four items are fixed (or item 5 is confirmed working and lockfile-diffed), the
new zip.ts test is red-then-green, and `corepack pnpm turbo run typecheck lint test
--filter=@edmate/ingest...` is green. Status: PARTIAL if past ~35 tool calls, if item 5's
`ignoredOptionalDependencies` doesn't hold up under a real install (log the decision, leave
`@napi-rs/canvas` installed, finish items 1/2/4 only), or if the zip.ts fix needs a change outside
`packages/ingest` (e.g. a `@types/jszip` patch) — hand back rather than touching other packages.
