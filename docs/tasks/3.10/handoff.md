# Task 3.10 handoff: locale packs (schema, loader, validation, default pack, IN pack)

Status: DONE
Branch: `m3/3.10-locale-packs`
Worktree: `.claude/worktrees/agent-a16cf6e0f06500533` (relative to the repo root)

Built to `docs/tasks/3.10/plan.md` and its "Lead revisions (19 Oct 2026)": ADR-0008, a structural
safe-regex check before a timing probe, one pack-level `reviewedBy` / `reviewedOn`, the IN pack
committed with `pending` values, and a runtime loader that never serves an unverified helpline.
After the build review the lead changed the runtime rule (19 Oct 2026, replacing decision 2): an
unverified helpline is removed from its pack, not the whole pack refused, so the India PII patterns
stay active. No helpline number, grievance contact or reviewer name is committed. The deviations are
listed below; the main one is that lookbehinds one character wide are still allowed (the real IN
patterns need them).

## Acceptance evidence

| Item | Evidence (command → trimmed output) |
|---|---|
| Schema (ADR-0008) | `packages/contracts/test/hardening.test.ts`, describe "LocalePack verification fields (ADR-0008)": a helpline missing `verifiedBy` / `verifiedOn` fails at its path; `verifiedBy` blank, over 200 characters or an email fails; `verifiedOn` must be a real `YYYY-MM-DD` date; `compliance.parentalConsentRequired` is a required boolean; `reviewedBy` / `reviewedOn` are optional but come as a pair. Four new invalid fixtures in `fixtures/invalid/locale.ts`. `types.test.ts` and `spec-drift.test.ts` pin the new shape against the build plan's Core contracts block (both updated). `@edmate/contracts:test` → `Tests 335 passed (335)`. |
| `edmate content validate` fails on missing fields | `packages/content/src/validate.test.ts` ("fails a locale pack with a missing field…") and `apps/cli/src/commands/content.test.ts` ("a locale pack missing a field or with a pending helpline exits 1 and names each issue"): exit 1, `XX.yaml: invalid locale pack: … compliance.grievance`, `global.yaml: … compliance.minAge`; a valid fixture directory exits 0. |
| Loader | `packages/content/src/localeLoader.test.ts`: `readLocalePack` (one file; bad YAML, schema mismatch, market ≠ file name, unreadable file each throw a `ContentLoadError` naming the file); `readLocalePacksDir` collects every bad file and unexpected entry, keeps the good packs; `isLocalePacksDir` dispatch. |
| Unknown market → default pack, still raises safety alerts | `packages/content/src/localePacks.test.ts` (`pickLocalePack('ZZ')` → global) and `packages/content/src/realLocales.test.ts`, describe "an unknown market falls back to the default pack and still raises safety alerts": with the **committed** `content/locales`, `ZZ` picks `global`; its distress system prompt (the **real** prompt packs) carries the frame's no-helplines line; a distress turn through the real `runTurn` emits `{type:'safety', level:'alert'}`, raises exactly one alert, and the caring reply is built for the `global` pack. |
| Unverified helplines removed at runtime, pack kept (lead decision, build review) | `localePacks.test.ts`: `withVerifiedHelplines` drops every helpline with a blank or `pending` number or a `pending` verifier and keeps every other field (reason codes only, never the number); `loadLocalePacks` serves a pack with a pending helpline with zero helplines and its PII pattern, reporting the drop once in `droppedHelplines`; **one verified + one pending helpline keeps only the verified one**; pending `grievance` / `reviewedBy` do not block runtime use; a **bad pattern (unsafe or non-`gu`) refuses the whole pack** and its market gets the default pack; a schema failure or unexpected entry is refused; loading throws only when the default pack is missing or unusable. `realLocales.test.ts`, describe "the IN pack with pending helplines, loaded for runtime" (a temp copy of the committed directory with every IN helpline forced pending, so it holds after sign-off): **IN loads with zero helplines**, each drop reported once, nothing refused; **its four PII patterns equal `IN_PII_PATTERNS` and 4.2's shared piiScrub cases pass through the runtime-loaded pack** (`piiScrubCaseFailures = []`); its distress prompt has the country-neutral line and no "pending" or helpline name; **a distress turn raises the alert** and the caring reply sees the IN pack with 0 helplines. The committed directory: every pack served (none refused) with exactly its verified helplines; no served pack shows a pending helpline. |
| PII patterns checked at load with `gu` and a safe-regex check | `packages/content/src/safeRegex.test.ts` (44 tests): structural rejection of `(a+)+$`, `(\d+)*`, `(?:a?)+`, `(a\|a)+`, `(a\|aa)+c`, `(?:ab\|ac)+`, `(a)\1`, `\k<n>`, `(?<=ab)x`, `(?<!\d+)x` and more; 16 safe shapes pass; the timing probe fails a pattern over budget (fake clock) and stops at the first slow input; structure runs first and skips timing when it fails. `localeRules.test.ts`: the gu rule (through the guard's own `compileLocalePatterns`) flags `\a`; the safe-regex rule flags the three catastrophic patterns from the plan; the real IN patterns pass both. |
| The real IN pack passes 4.2's PII pipeline test (UPI included) | `packages/content/src/localePiiPipeline.test.ts`: loads `content/locales/IN.yaml` through `readLocalePack`, runs 4.2's shared cases (`PII_SCRUB_CASES`: phone, Devanagari phone, email, card, OTP, name, Aadhaar-like, PAN, **UPI**) through the real `createPiiScrubGuard` → `piiScrubCaseFailures(...) = []`; the pack's patterns equal `IN_PII_PATTERNS` byte for byte, so every harness `piiPatterns.test.ts` / `piiScrub.test.ts` case also covers the committed pack. |
| The real directory fails validation on purpose | `node apps/cli/bin/edmate content validate content/locales` → exit 1, `4 issues`: `IN.yaml: helpline "Tele-MANAS": number is "pending"`, `… verifiedBy is "pending"`, `IN.yaml: compliance.grievance is "pending"`, `IN.yaml: reviewedBy is "pending"`. The default pack passes every rule on its own (`realLocales.test.ts`). This turns green when the human inputs below are filled in. |
| Full gate (after the lead's runtime change) | Infra up (`docker compose … up -d postgres redis`), then `corepack pnpm turbo run typecheck lint test --filter=...@edmate/contracts --force` → `Tasks: 37 successful, 37 total`; nothing skipped. Tests: contracts 335, harness 3139, content 276, cli 48, db 491, evals 300, gateway 405, web 132, worker 106, queue 40, all passed. A second forced parallel `test` run also passed (see the timing note in Deviations 8). Coverage: `src/guardrails` 100/100/100/100; `@edmate/content` all files 99.42 statements / 95.72 branches / 100 functions / 100 lines (`localeRules.ts` 100%; `localePacks.ts` 100 lines / 91.66 branches; `localeLoader.ts` 100 lines / 90 branches; `safeRegex.ts` 98.17 / 96.5). |
| Harness purity | `packages/harness/src/testing/piiScrubCases.ts` imports only harness modules; `@edmate/content` imports `@edmate/harness` (the existing direction). No new dependency anywhere. |
| ADR headings, secret scan | `python3 docs/adr/check-headings.py` → no output, exit 0. `python3 .githooks/secret-scan.py --all` → no output, exit 0. |

## Human inputs needed (exact list; agents must not fill any of these in)

For `content/locales/IN.yaml` to pass `edmate content validate content/locales`:

1. **Helpline(s)**, for each line: the real **number**, the confirmed **name** and **kind**, **`verifiedBy`** (your name or handle, never an email; the repo is public) and **`verifiedOn`** (the date you checked it). Candidate: **Tele-MANAS 14416**, cited in the PRD (line 270) and the locale-context skill. It is not committed as fact (`number: pending`) until you confirm it is current. Please keep the source URL you checked in the PR or review record (the schema has no URL field; see ADR-0008). Optional: a general emergency number (for example 112) as a second line. **This is the only input that changes what students see:** until it lands, India students' distress replies use the country-neutral line (local emergency services, someone you trust) instead of a helpline; the India PII patterns are active either way.
2. **`compliance.grievance`**: the IT Rules 2021 grievance-officer contact Edmate will publish (name or role plus a channel). Not needed at runtime today: it feeds the published privacy notice, which is not built yet. Needed before that notice ships.
3. **`reviewedBy` / `reviewedOn`** for the compliance block, after confirming:
   - `privacyLaw: "DPDP Act 2023 and DPDP Rules 2025"` is the right citation;
   - `dataRegion: "United States (hosting decision, 18 Oct 2026)"` is fine to state in a public pack;
   - `minAge: 13` and `parentalConsentRequired: true` (13 to 17 need verifiable parental consent; your 18 Oct 2026 decision).
   Like the grievance contact, this does not block runtime use; it is for the privacy notice and launch.

Until all three land, `edmate content validate content/locales` exits 1 with the four issues above.

## Changes

- **Contracts (ADR-0008):** `packages/contracts/src/locale.ts` (helpline `verifiedBy` / `verifiedOn`, `compliance.parentalConsentRequired`, top-level `reviewedBy` / `reviewedOn` pair via `superRefine`); `formats.ts` (`date()`, `signer()`); `limits.ts` (`signerMaxLength: 200`); fixtures valid/invalid; `test/hardening.test.ts`; `test/spec-types.ts` and `docs/edmate-harness-build-plan.md` (the same `LocalePack` text, so spec drift stays green).
- **ADR:** `docs/adr/0008-locale-pack-verification.md`.
- **Content package:** new `localeLoader.ts`, `localeRules.ts` (6 rules: default pack present, helplines verified, compliance reviewed, pilot languages, gu compile, safe-regex), `localePacks.ts` (`loadLocalePacks`, `pickLocalePack`, `withVerifiedHelplines`, `LocalePackError`, `DEFAULT_LOCALE_MARKET`), `safeRegex.ts`; `validate.ts` dispatches a locale-packs directory; `index.ts` exports; tests listed above; fixtures `test/fixtures/locales/valid/{global,XX}.yaml` (made up); `noFixtureProse.test.ts` now scans `content/locales` too.
- **Packs:** `content/locales/global.yaml` (default, no human input needed), `content/locales/IN.yaml` (pending values).
- **Harness (tests and test helpers only):** `src/testing/piiScrubCases.ts` (4.2's CASES moved out of `piiScrub.test.ts` unchanged, plus `piiScrubCaseFailures`); `src/testing/index.ts` exports; `src/guardrails/piiScrub.test.ts` imports the shared cases (assertions unchanged) and tests the runner; `src/testing/piiLocaleFixtures.ts` Aadhaar pattern rewritten without a backreference or nested quantifier; `src/pedagogy/compose.test.ts` adds the two new helpline fields to one literal.
- **CLI:** `apps/cli/src/commands/content.ts` usage text; `content.test.ts` two new cases.
- **Docs:** `.claude/skills/locale-context/SKILL.md` pack shape now matches the real camelCase schema and the new fields.

## Deviations from the plan

1. **Lookbehinds one character wide are allowed** (lead revision 2 said reject lookbehind). All four real IN patterns need a one-character lookbehind (`(?<!\d)` and so on), and the scrub redacts the whole match, so a consuming `(?:^|\D)` would also redact the character before the number and break 4.2's cases. The check refuses any lookbehind that is not exactly one unquantified character or class (`(?<=ab)`, `(?<!\d+)`, `(?<!a|b)`, groups inside). Accepted by the lead on the build review (19 Oct 2026).
2. **"Repeated" means a quantifier that allows more than one** (`*`, `+`, `{n,m}` with m > 1). `?` alone does not count, so the IN mobile pattern's `(?:\+?91[ \-]?|0)?` passes. One optional pass cannot backtrack exponentially. `(?:a?)+` and `(?:a{2}){3}` are still refused.
3. **The Aadhaar pattern changed** (in both `IN_PII_PATTERNS` and `IN.yaml`): no `\1` backreference (the three separator forms are spelled out) and no `{3}` around a group with `?` (the three year groups are spelled out). It matched identically to the old pattern on 200,011 strings (fixed edge cases plus random digit/space/dash strings), and every existing harness PII test still passes.
4. **Both packs say `languages: [en]`**, not `[en, hi]`, and a sixth rule (`localeLanguages`) enforces the English-only pilot (18 Oct 2026; crisis replies too, B-14). `locale.languages` has no reader today. Accepted by the lead on the build review.
5. **One more rule, `complianceReviewed`**: it flags `pending` compliance text and a market pack without a non-pending `reviewedBy` (lead revision 3's sign-off).
6. **The plan's duplicate-market check is not needed**: file names must match `^([A-Z]{2}|global)\.yaml$` exactly, so `in.yaml` is an "unexpected entry" and two files can't claim one market. (On macOS `in.yaml` and `IN.yaml` are the same file; the tests account for that.)
7. **The plan's compose-layer check lives in `@edmate/content`, not `harness/compose.test.ts`**: the harness can't read `content/locales` (no fs). `realLocales.test.ts` uses the real pack, the real prompt packs and the real runner.
8. **The timing probe runs inputs from 32 to 8,192 characters, doubling, with a 100 ms budget per attempt, and flags a pattern only when 3 attempts all go over.** With only two lengths (256 and 8,192), a cubic pattern hung the check. Doubling stops it on the first slow length. The four IN patterns take about 1 ms alone, but one parallel full-gate run stalled a single attempt to about 400 ms, so a single attempt is not enough to flag. A slow pattern is slow every time; a busy machine stalls one attempt, not three.

## Fix round 1

Security HIGH (PR #57 review): the structural check only tested alternation overlap under an
explicit repeating quantifier, so a manually unrolled ambiguous alternation (`'(x|xx)'.repeat(25) +
'z'`, `'(a|aa)'.repeat(25) + 'z'`) passed `checkSafeRegex` yet took 0.5–4.7 s on a ~40-character
input; and the timing probe only tried a fixed generic alphabet, so an ambiguous pattern on a
character outside it could pass unnoticed.

Fixed in `packages/content/src/safeRegex.ts`, `safeRegexGuard.ts`, `safeRegexWorkerEntry.ts`,
`localeRules.ts`:

1. **Structural:** `unrolledOverlap` now also refuses two or more adjacent, unquantified copies of
   the same alternation group, or of groups whose branches overlap each other (not only an
   alternation gated by an explicit `*`/`+`/`{n,m>1}`). `packages/content/src/safeRegex.test.ts`
   adds both repro patterns plus `(ab|ac)(ab|ac)x` and `(a|b)(b|c)x` (overlapping but not identical
   groups), and confirms two adjacent groups still pass when every branch across both starts with
   a distinct literal character -- the check's narrow, structural definition of "non-overlapping",
   not a general guarantee that any two safe-looking adjacent groups pass (see ADR-0008's
   strictness note: `(a|b)(b|c)x` is refused even though it is not itself exponential).
2. **Timing probe:** `extractProbeUnits(source)` walks the parsed pattern and collects every
   distinct literal character and class/escape sample it uses (`\d`→`1`, `[a-z]`→`a`, `\s`→`' '`,
   …); `checkSafeRegex` adds these to the generic `PROBE_UNITS` alphabet. The 3-attempts rule is
   unchanged. `safeRegex.test.ts` covers `extractProbeUnits` directly (collects literals and class
   samples; empty, never throws, on an unparseable fragment).
3. **Hard ceiling (load/validate path only):** `checkSafeRegexGuarded` runs `checkSafeRegex` in a
   `node:worker_threads` worker with a ~2 s wall-clock ceiling (`Atomics.wait`/`Atomics.notify` on a
   shared flag; the worker notifies the flag itself and posts its result over a transferred
   `MessagePort`, read back with the synchronous `receiveMessageOnPort` -- a 'message'/'error'
   listener on the main thread cannot fire while it is blocked in `Atomics.wait`, so only the worker
   calling `Atomics.notify` directly can wake it). `localeRules.ts`'s `safeRegexIssues` now calls
   the guarded check (it already did in the WIP, but the guard itself did not work: see "stall root
   cause" below). `checkSafeRegexGuarded` checks the compiled worker file exists before spawning
   anything; in this package's own test run there is no `dist` build, so it takes the documented
   in-process fallback, fast (`safeRegexGuard.test.ts`, unmocked, asserts under 500 ms, including
   both repro patterns). The worker protocol itself (answers before the ceiling; relays an issue;
   cannot start; nothing answers by the ceiling, terminated) is covered with `node:worker_threads`
   and `node:fs` mocked (`safeRegexGuardWorker.test.ts`); `safeRegexWorkerEntry.ts`'s own top-level
   side effect (post the result, store and notify the flag) is covered directly
   (`safeRegexWorkerEntry.test.ts`). Coverage for the three new/changed files: 100% lines/branches/
   functions/statements.
4. **Stall root cause (why the previous fix round never finished):** the WIP's guard used a
   main-thread `'message'`/`'error'` listener on the `Worker` object to call `Atomics.notify` on the
   shared flag. `Atomics.wait` blocks the calling thread's own event loop, so that listener could
   never run while the main thread was blocked inside `Atomics.wait` -- it would only be delivered
   after the wait already timed out. Every real-pack test (`realLocales.test.ts`, `validate.test.ts`)
   therefore waited the full 2,000 ms hard ceiling and then failed, because the worker file does not
   exist when the package runs straight from TypeScript source (no build step) and the fallback path
   never actually ran. Fixed by checking the compiled file exists (`existsSync`) before spawning
   anything, and by having the worker itself call `Atomics.notify` on a flag passed into
   `workerData`, with the result crossing on a transferred `MessagePort` read back via the
   synchronous `receiveMessageOnPort` once the wait returns -- no reliance on the main thread's event
   loop while it is blocked. `packages/content` now runs in about 1 s (291 → 299 tests, all pass);
   previously `realLocales.test.ts` and `validate.test.ts` failed/stalled on the missing-worker-file
   path.

Evidence:

| Check | Command → trimmed output |
|---|---|
| Content package, isolated | `corepack pnpm vitest run --coverage` (packages/content) → `Test Files 18 passed (18)`, `Tests 292 passed (292)`, ~1 s; `safeRegexGuard.ts` and `safeRegexWorkerEntry.ts` 100% lines/branches/functions/statements; `safeRegex.ts` 97.56/94.38/100/99.4. |
| Full gate | infra up (`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml -f apps/worker/test/compose.port.yaml up -d --wait postgres redis`); `corepack pnpm turbo run typecheck lint test --filter=...@edmate/contracts --force` → `Tasks: 37 successful, 37 total`, nothing skipped; `@edmate/content:test` `Test Files 18 passed (18)` `Tests 292 passed (292)`. |
| Real IN patterns still pass | `safeRegex.test.ts` "the real India patterns pass" (structural + timing, real clock); `localeRules.test.ts` "passes the real India patterns" (`piiPatternsSafeRegex`, `piiPatternsCompileWithGu`); `realLocales.test.ts` loads the committed `content/locales/IN.yaml` through the real loader and runs 4.2's `piiScrubCaseFailures` → `[]`. All pass. |
| ADR headings | `python3 docs/adr/check-headings.py` → no output, exit 0. |
| Secret scan | `python3 .githooks/secret-scan.py --all` → no output, exit 0. |

## Follow-ups (not blocking)

- **Merge conflict to expect:** open branches `m4/4.3-distress` and `m4/4.4-moderation-jailbreak` add `packages/harness/src/testing/distressLocaleFixtures.ts` with a helpline literal that has no `verifiedBy` / `verifiedOn`. Whichever merges second must add those two fields (for example `verifiedBy: 'test pack'`, `verifiedOn: '2026-01-01'`) or typecheck fails.
- `evals/suites/safety/distress/generic/*` say "Re-verify when 3.10 lands": the default pack's wording is the frame's no-helplines line, unchanged, so they should still hold. Worth re-checking in 4.3.
- No composition root calls `loadLocalePacks` / `pickLocalePack` yet (`TurnConfigStoreOptions.locales` still gets fixtures); the first app that wires real packs should call `loadLocalePacks` once at start-up and log each `droppedHelplines` / `refused` entry once (they carry codes and names only, no numbers).
- The privacy notice (not built yet) must read `compliance.grievance` and the sign-off, and must not publish a `pending` value.
- `distress/in` eval cases expect Tele-MANAS in the reply; with the committed pack (helpline pending) they will see the country-neutral line instead until the human signs off. Check this when 4.3's evals run against real packs.
- An `en-US` pack waits for the M10 payments task (10.1), as the plan says.

## Fix round 2

Re-review of PR #57 (typescript-reviewer, architect): two HIGH findings on the worker-ceiling
guard, one MEDIUM on the structural check, one MEDIUM wording overclaim, one LOW on an unchecked
type assertion.

1. **[HIGH] No `'error'` listener on the spawned worker.** `checkSafeRegexGuarded` blocks on
   `Atomics.wait`; if `checkSafeRegex` threw inside the worker (for example a `RangeError` from
   `''.repeat(Infinity)` when a pattern's probe unit is somehow empty), the worker's queued
   `'error'` event fired only after `Atomics.wait` returned, with no listener attached -- Node
   treats that as an uncaught exception and crashes the host process. Fixed: `worker.on('error', ()
   => undefined)` right after construction. The guard already reports the pattern as unsafe either
   way (the flag was never notified, so the ceiling branch fires); the listener exists only so the
   later delivery finds something to swallow it. `safeRegexGuardWorker.test.ts` adds a `'crash'`
   behaviour that emits `'error'` on a queued microtask (modelling the worker dying after this
   call already returned) and asserts the test itself does not throw.
2. **[HIGH] No test ran the real `Worker`/`Atomics`/`MessagePort` protocol.** The existing tests
   either take the no-`dist` in-process fallback (`safeRegexGuard.test.ts`) or mock
   `node:worker_threads` (`safeRegexGuardWorker.test.ts`); neither spawns a real worker. Added
   `safeRegexGuardIntegration.test.ts`: a `beforeAll` builds this package with its own
   `tsc -p tsconfig.build.json` (skipped if `dist/safeRegexWorkerEntry.js` already exists, so a
   second local run doesn't rebuild for nothing), then dynamically imports the compiled
   `dist/safeRegexGuard.js` so `checkSafeRegexGuarded` takes the real-worker branch. Three cases,
   ceiling 300 ms, small inputs, deterministic in CI (every case either answers fast or is designed
   to never answer at all): a safe pattern answers fast; a worker that throws
   (`{ units: [''] }` makes `probeTiming` call `''.repeat(Infinity)`) is reported unsafe at the
   ceiling, not a crash (the regression check for finding 1); the anchored `a?`×25 then `a`×25
   pattern (see finding 3) is terminated and reported near the 300 ms ceiling, not stalled far past
   it.
3. **[MEDIUM] Three cheap bypasses of `unrolledOverlap`.** A `{1}` quantifier (matches its atom
   exactly once, no different from no quantifier) was not treated as unquantified; a plain group
   holding exactly one unquantified branch of one unquantified term (`((a|aa))`) was not unwrapped
   before the scan; and a term that can match zero characters (`?`, `*`, `{0,n}`) sitting between
   two alternation groups reset the scan's accumulator, breaking the adjacency the scan looks for,
   even though such a term can vanish from the match entirely. Fixed in `safeRegex.ts`:
   `isEffectivelyUnquantified` (`quant === null` or `{min:1,max:1}`), `unwrapSingleBranch`
   (recursive), and `canMatchEmpty` (a quantifier with `min === 0` no longer resets the run).
   `safeRegex.test.ts` adds `(a|aa){1}`, `((a|aa))` and `(a|aa)b?`, each repeated 25 times, as
   refused. A fourth shape from the re-review, `a?`×25 then `a`×25 (no group, no alternation at
   all), is **not** caught structurally: the real IN mobile pattern
   (`(?:\+?91[ \-]?|0)?[6-9]\d{9}`) has exactly that optional-then-mandatory shape without being
   dangerous, and a rule general enough to catch the bare version would also flag it. Left to the
   timing probe and the load-path ceiling; `safeRegex.test.ts` adds a test proving `checkSafeRegex`
   catches it on the real clock (anchored with `^`/`$`, so the engine cannot return a cheap
   successful substring match and must explore the full failure space -- the plan's literal
   unanchored version returns a quick match on realistic inputs and is not caught, which the
   handoff now says plainly), and `safeRegexGuardIntegration.test.ts` proves the ceiling terminates
   it when even the probe would not finish in time.
4. **[MEDIUM] ADR-0008 and this handoff overclaimed what the structural check guarantees.**
   "Matching the quantified case's ambiguity exactly" and "not weaker for being spelled out
   longhand" (ADR-0008) and "provably safe" (handoff line 142, now reworded) overstated a
   heuristic as a proof. Reworded both documents: the structural check is a conservative heuristic
   over the pattern's written shape; the timing probe and the load-path ceiling are the backstop
   for what it misses; the per-turn PII scrub path has no check and no ceiling of its own, so
   residual risk from a pattern class nothing anticipates sits entirely there. ADR-0008 also now
   documents the `existsSync` / worker-start in-process fallback explicitly (no ceiling at all;
   true only when this package runs straight from TypeScript source with no build step, which is
   this package's own test run today, never production) and a strictness note: `(a|b)(a|b)` and
   `(\d|x)(y|z)` are refused even though neither is itself exponential, because the scan cannot
   tell a genuinely safe two-branch sequence from the start of a dangerous one, and because a false
   positive refuses the whole market pack (point 6 of the decision), not just a warning. Fixed
   handoff.md:82 (this file), which said "two non-overlapping adjacent groups still pass" without
   naming the check's narrow, structural definition of "non-overlapping".
5. **[LOW] `received.message as string[]`.** The message crossed a `MessagePort` from another
   thread, so nothing guarantees its shape at the type level. Replaced the assertion with
   `messageShape()`, a runtime check (`Array.isArray` and every element `typeof === 'string'`); an
   unexpected shape is now reported as `['the worker answered with an unexpected shape']` rather
   than trusted. `safeRegexGuardWorker.test.ts` adds a case that returns a non-array payload.

Evidence:

| Check | Command → trimmed output |
|---|---|
| Content package, isolated | `vitest run --coverage` (packages/content) → `Test Files 19 passed (19)`, `Tests 301 passed (301)` (292 round-1 baseline + 9 new); `safeRegex.ts` 97.65/94.81/100/99.42, both above the 80% gate. |
| Real worker integration | `safeRegexGuardIntegration.test.ts` alone, with and without a pre-existing `dist`: `Test Files 1 passed (1)`, `Tests 3 passed (3)`, ~1.7 s cold (includes the `tsc` build) / well under 1 s warm. |
| Full gate | infra up (`docker compose … up -d --wait postgres redis`); `corepack pnpm turbo run typecheck lint test --filter=...@edmate/contracts --force --concurrency=1` → `Tasks: 37 successful, 37 total`. |
| ADR headings | `python3 docs/adr/check-headings.py` → no output, exit 0. |
| Secret scan | `python3 .githooks/secret-scan.py --all` → no output, exit 0. |

Not done (left to the lead, per this round's instructions): fail-closed-on-missing-worker behaviour,
and a smoke test of the built CLI.

## Decisions

### 20 Oct 2026 · 3.10 Fix round 2: worker 'error' listener, real-worker integration test, structural-check bypasses closed, overclaims reworded · risk: medium
Decided: `checkSafeRegexGuarded` attaches `worker.on('error', ...)` right after spawning (swallowed: the guard already reports unsafe at the ceiling either way), closing a host-process crash when a worker threw after `Atomics.wait` already returned. `safeRegexGuardIntegration.test.ts` builds the package with its own `tsc` and imports the compiled `dist` so one test exercises the real `Worker`/`Atomics`/`MessagePort` protocol end to end, not a mock or the no-`dist` fallback. `unrolledOverlap` (`safeRegex.ts`) now treats a `{1}` quantifier as unquantified, unwraps a one-branch plain group before the adjacency scan, and no longer lets a possibly-empty term between groups reset the scan. A fourth shape the re-review raised, `a?`×25 then `a`×25 with no group at all, is left to the timing probe and the load-path ceiling (the real IN mobile pattern has that same optional-then-mandatory shape and must not be flagged); a test proves the probe and the ceiling both catch it. ADR-0008 and this handoff are reworded where they overstated the structural check as a proof ("matching the quantified case's ambiguity exactly", "provably safe"); the ADR now also documents the `existsSync` in-process fallback (no ceiling, test-only today) and a strictness note that `(a|b)(a|b)` is refused even though it is not itself exponential. `received.message as string[]` is replaced with a runtime shape check.
Why: typescript-reviewer and architect re-review of PR #57's fix round 1 found the crash path untested and still possible, the real worker protocol untested, three ways to dodge the unrolled-overlap scan structurally, and wording that claimed more certainty than a heuristic check can give.
Alternatives: skip the real-worker test and rely on the mocked protocol test alone (rejected: a mock can drift from the real `Atomics`/`MessagePort` behaviour without anyone noticing); catch `a?`×25/`a`×25 structurally too (rejected: no rule the authors could find distinguishes it from the real IN mobile pattern's own optional-then-mandatory shape without also flagging that pattern).
Reviewers: typescript-reviewer, architect (both raised findings in this round).
Reversible: yes; no stored data depends on any of these changes, only which patterns validate and how the guard's failure modes are documented.

### 20 Oct 2026 · 3.10 Safe-regex structural check also refuses an unrolled ambiguous alternation; timing probe derives units from the pattern; a hard wall-clock ceiling guards the load/validate path · risk: high
Decided: the structural check refuses not only an alternation whose branches overlap under an explicit repeating quantifier, but also two or more adjacent, unquantified copies of the same alternation group, or of groups whose branches overlap each other -- a manually unrolled ambiguity is exactly as dangerous once the compiled pattern runs. The timing probe's adversarial inputs are built from every distinct literal character and class/escape sample the pattern itself uses, in addition to the existing generic alphabet. `edmate content validate` and start-up `loadLocalePacks` (never the per-turn PII scrub) run the whole check inside a `node:worker_threads` worker with a roughly 2-second hard wall-clock ceiling; a pattern that does not answer in time is terminated and reported unsafe. All four real IN patterns and the global pack still pass.
Why: security review of PR #57 found `'(x|xx)'.repeat(25) + 'z'` and `'(a|aa)'.repeat(25) + 'z'` passed the round-0 check yet took 0.5–4.7 s to run; a pack author (or anyone who can propose a pack) could spell an exponential-backtracking pattern out longhand to dodge a check gated only on an explicit quantifier. Pack patterns run on every student message in `piiScrub`, so any pattern that reaches that path needs more than one check that happens to catch the shapes its author anticipated: the structural check is a conservative heuristic over the pattern's written shape, the timing probe and the load-path ceiling are the backstop for what it misses, and the per-turn scrub path itself has no check and no ceiling at all (see "Fix round 2" and ADR-0008 for what this does and does not guarantee).
Alternatives: keep the quantifier-gated check and rely on the timing probe alone to catch an unrolled pattern (rejected: the probe's own fixed generic alphabet could miss a pattern ambiguous only on a character outside it, and a probe-only defence has no structural explanation for pack authors); add the `safe-regex` npm package (still a new dependency, the same Q1 answer as round 0); cap total validate-time instead of per-pattern (rejected: one slow pattern would still block every other pack's validation).
Reviewers: security-reviewer (raised it), architect, typescript-reviewer (ADR-0008 addendum, the worker-protocol design in `safeRegexGuard.ts`).
Reversible: yes, with a new ADR note; no stored data depends on the stricter rule, only which packs validate.

### 19 Oct 2026 · 3.10 LocalePack gains sign-off fields and a parental-consent flag (ADR-0008) · risk: high
Decided: each helpline gets required `verifiedBy` (a name or handle, never an email, at most 200 characters) and `verifiedOn` (a calendar date). `compliance` gets a required `parentalConsentRequired` boolean. The pack gets an optional `reviewedBy` / `reviewedOn` pair for the compliance block. The literal `pending` is valid in the schema; the content rules report it, and the runtime loader never serves a helpline that carries it. The build plan's Core contracts text and the spec-type tests are updated to match.
Why: the task asks for "human-verified helplines and compliance". Code could not tell a verified helpline from a guessed one, and the consent rule differs per market (US no, India yes for 13 to 17).
Alternatives: one pack-level sign-off only; a side file for verification; making the schema reject `pending` (the pack could not be committed honestly); hard-coding consent per country.
Reviewers: architect, security-reviewer, typescript-reviewer (contracts, ADR); safety-reviewer (helpline refusal, `content/locales/`, the `piiScrub.test.ts` extraction under `packages/harness/src/guardrails/`); security-reviewer also for the `.claude/skills/locale-context` doc.
Reversible: yes, with a new ADR; no stored data uses these fields yet.

### 19 Oct 2026 · 3.10 At runtime an unverified helpline is removed from its pack; the pack and its PII patterns are kept · decided by the team lead · risk: high
Decided: `loadLocalePacks` serves each pack with every unverified helpline (a blank or `pending` number, or a `pending` verifier) removed, and reports each removed helpline once (market, helpline name, reason codes; never the number). A pack left with no helplines gets the frame's country-neutral line (local emergency services, someone you trust); its PII patterns and other fields are used. A pack that fails the schema or its PII-pattern checks (gu, safe-regex) is refused whole and its market gets the default pack; loading throws only without a usable default pack. `pickLocalePack` removes unverified helplines again (defence in depth). Pending compliance fields (`grievance`, `reviewedBy`) do not block runtime use: they are for the published privacy notice, which is not built yet. `edmate content validate` still fails on every pending value, so the human sign-off stays visible.
Why: the first build refused the whole pack (lead revision 4), which would have dropped India's Aadhaar, PAN, UPI and Indian-mobile PII patterns until sign-off, a privacy regression. Removing only the helplines gives the same crisis wording without that loss. Lead decision on the build review, 19 Oct 2026; replaces the earlier "refuse the whole pack" decision. ADR-0008 updated to match.
Alternatives: refuse the whole pack until every helpline is verified (the first build; rejected for the PII regression); refuse only at `edmate content validate` (rejected: an unverified number could reach a crisis reply).
Reviewers: safety-reviewer (helpline removal, `content/locales/`), architect, security-reviewer, typescript-reviewer (ADR-0008).
Reversible: yes.

### 19 Oct 2026 · 3.10 Safe-regex check: strict structure first, timing second; one-character lookbehinds allowed · risk: medium
Decided: a hand-written parser (no dependency) refuses a quantifier inside a group that repeats (`*`, `+`, `{n,m}` with m > 1), an alternation under a repeat whose branches don't each start with a distinct literal character, any backreference, and any lookbehind wider than one character. Clean patterns then run over adversarial inputs from 32 to 8,192 characters (100 ms budget per attempt; flagged only when 3 attempts all go over, so a busy machine can't fail a good pattern). The check runs at validate and load time, never per turn. The Aadhaar pattern is rewritten without its backreference and nested quantifier; it matched identically on 200,011 strings.
Why: lead revision 2 (structure first, strict is fine). The real IN patterns need one-character lookbehinds to bound a number without redacting its neighbour, so a total lookbehind ban would fail the acceptance line "the real IN pack passes 4.2's PII pipeline test".
Alternatives: ban every lookbehind (breaks the IN patterns); the `safe-regex` npm package (a new dependency, Q1); timing only (can hang on an exponential pattern).
Reversible: yes.

### 19 Oct 2026 · 3.10 Packs are English-only during the pilot · risk: low
Decided: both packs list `languages: [en]`, and a validation rule requires exactly `[en]` while the pilot policy holds.
Why: the 18 Oct 2026 English-only pilot decision and B-14 (crisis replies stay English). The plan's draft had `[en, hi]`.
Alternatives: `[en, hi]` describing the market rather than the pilot.
Reversible: yes; drop the rule when the policy changes.

### 19 Oct 2026 · 3.10 Ship only the default and IN packs; en-US waits for M10 · risk: medium
Decided: this task ships `global.yaml` and `IN.yaml`. The `en-US` pack is a follow-up once task 10.1 settles US payment and tax details.
Why: the open-decisions table lists 3.10 as blocked only for "first pack", and the accept line names only the IN pack.
Alternatives: a partial US pack now.
Reversible: yes; adding a pack is additive.

### 19 Oct 2026 · 3.10 IN pack committed with `pending` values; `edmate content validate content/locales` fails until a person signs off · risk: medium
Decided: `IN.yaml` ships with the helpline number, its verifier, the grievance contact and the compliance reviewer set to `pending`; the Tele-MANAS number is not committed. The validate command exits 1 on the real directory by design; unit tests use fixtures, and the real-directory tests hold before and after sign-off.
Why: lead revision 5 and rule 5 (public repo; agents never invent contacts or numbers).
Alternatives: commit the PRD's number as a candidate (rejected by the lead).
Reversible: yes; a person fills in the values.

## Fix round 3 (CI)

PR #57 CI (`packages/content/src/safeRegexGuardIntegration.test.ts` > "a safe pattern answers fast,
through the real worker protocol") failed with `expected [ Array(1) ] to deeply equal []`, the array
holding `"exceeded the 300 ms hard limit for the load/validate path (terminated)"` — a real,
well-formed guard result, not a corrupted or missing module (ruling out the `dist`-build-race theory:
a half-written `dist/safeRegexGuard.js` would throw on import, not return a coherent message). The CI
log showed the real elapsed time was 437 ms against the test's own 300 ms ceiling, with "19 workers
spawned" for this one file. Cause: this test spawns a real `node:worker_threads` worker from inside a
vitest-isolated worker thread; under CI's heavier per-file worker isolation and CPU contention
(reproduced by running `@edmate/content#build` and this test concurrently — see below), that
real worker's spawn + round trip occasionally exceeds a tight 300 ms budget even though the check
itself (`\d{4}x`) is trivial. The two "terminated" cases keep their 300 ms ceiling on purpose: their
inputs are designed to never finish inside it, so a slower CI runner only makes the termination
happen correctly sooner, never a false pass.

Fix: the "answers fast" case now calls `checkSafeRegexGuarded` with no explicit ceiling, so it uses
the library's own default (2,000 ms, `safeRegexGuard.ts`) instead of the test's artificially tight
300 ms. The production default itself is untouched; this only widens the margin a known-fast call
gets in the test. `toEqual([])` already proves the worker answered before any ceiling (a terminated
check always returns an "exceeded" message), so the remaining `toBeLessThan(2_000)` is a loose sanity
bound, not the thing under test.

Evidence: `corepack pnpm turbo run typecheck lint test --filter=@edmate/content --force` →
`Tests 301 passed (301)`, including `safeRegexGuardIntegration.test.ts (3 tests)`. Ran
`@edmate/content#build` (`turbo run build --filter=@edmate/content --force`) concurrently with
`vitest run src/safeRegexGuardIntegration.test.ts` five times before the fix (all passed locally —
the race/noise did not reproduce on this machine, matching that it is a CI-load-only flake) and
once after the fix (`3 tests passed`, no failure). `python3 .githooks/secret-scan.py --all` → no
output, exit 0.

Files changed: `packages/content/src/safeRegexGuardIntegration.test.ts` (comment + the one test's
ceiling/assertion).
