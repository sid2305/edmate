# 0.3 handoff: `packages/contracts` as Zod schemas, with fixtures

Status: DONE
Branch: `m0/0.3-contracts`
Worktree: `.claude/worktrees/agent-ab3203860e805eb80`
Risky: every `packages/contracts/**` file (group "Contracts and ADRs"). Required reviewers: architect, security-reviewer, typescript-reviewer (opus).

## Acceptance evidence

`corepack pnpm turbo run build typecheck lint test --filter=@edmate/contracts... --filter=@edmate/harness...`:
```
@edmate/contracts:test:  Test Files  5 passed (5)
@edmate/contracts:test:       Tests  244 passed (244)
@edmate/contracts:test: Statements 100% (166/166) · Branches 100% (18/18) · Functions 100% (24/24) · Lines 100% (156/156)
@edmate/harness:test:   Test Files  1 passed (1)
@edmate/harness:test:        Tests  34 passed (34)
 Tasks:    11 successful, 11 total
```
Root `corepack pnpm build` / `test` / `lint` / `typecheck` / `format:check`: all tasks successful (contracts 244, harness 34, config 34, cli 7, web 2, worker 3 tests); Prettier clean.

**Fixtures round-trip** (`test/roundtrip.test.ts`): every valid fixture `parse(f)` strict-equals `f`, and `parse(JSON.parse(JSON.stringify(parsed)))` strict-equals `parsed`; every invalid fixture fails `safeParse` with an issue at its expected path. `test/registry.test.ts` fails if an exported `*Schema` is not registered, has no valid or no invalid fixture, or an invalid case names an unknown schema; it also checks one fixture per union variant (TurnEvent 10, ModelChunk 3, GuardResult 4, all 3 Entitlement sources) and every enum option.

**`z.infer` types match Core contracts**: `test/types.test.ts` has one `expectTypeOf<C.X>().toEqualTypeOf<Spec.X>()` per type (32 data types + 11 ports + `Tool<I,O>`), checked by `tsc` (typecheck includes `test/`). `test/spec-drift.test.ts` extracts the `ts` block under `## Core contracts` from the build plan and requires it to equal `test/spec-types.ts` after whitespace normalisation (minus `export ` and the header up to the import line). Deliberate mismatch (`temperature: z.number().optional()` instead of `.exactOptional()`), then reverted:
```
test/types.test.ts(33,36): error TS2554: Expected 1 arguments, but got 0.   // ModelRequest
test/types.test.ts(52,36): error TS2554: Expected 1 arguments, but got 0.   // ModelGateway
```
The drift test also has a case proving a changed field (`amountMinor: string`) is detected.

**`harness/testing` imports the fixtures**: `packages/harness/src/testing/index.ts` re-exports `@edmate/contracts/fixtures`; `src/testing/fixtures.test.ts` parses the first fixture of all 32 schemas and the named demo fixtures. Harness lint (purity rule) is green.

`python3 .githooks/secret-scan.py --all` on the staged tree: exit 0.

## Fix round 1 (security-reviewer, architect, typescript-reviewer)

Test-first: `test/hardening.test.ts` plus new invalid fixtures (32 new failing tests seen red, then green). After the fixes: contracts **282 tests**, coverage 100% (193/193 statements, 30/30 branches); harness 34. The turbo run on both filters: 11/11 successful. Root build, test, lint, typecheck and format:check are green. Secret scan clean.

1. Attachment: storageKey is at most 200 characters of `A-Za-z0-9/_.-`, with no leading `/` and no `..` segment. mime is image/png, jpeg, webp or heic; it's a regex rather than an enum because the spec types mime as `string`, and the type test caught the enum. bytes runs from 1 to 20 MB. There is no pdf kind in the spec, so no pdf.
2. `id()`: 1–128 characters of `A-Za-z0-9_-`. Fixture topic ids changed from `topic.x` to `topic_x`.
3. skillPayload: at most 16,384 UTF-16 units of `JSON.stringify`. Anything that can't be serialised (circular, BigInt) is rejected.
4. TurnInput.text: `.max(8000)` runs before the code-point refine.
5. GuardResult reason ≤ 500, rewrite text ≤ 8,000, SafetyAlert.excerptRedacted ≤ 8,000.
6. Each piiPattern is ≤ 500 characters and must compile as a RegExp.
7. Entitlement fixtures now mirror their package. allowed = `pkg.moduleIds`, locked = the teacher's other modules (`teacherModuleIds`, mod_test_01..04), skills = `pkg.skills`. A test asserts this for all three.
8. TurnContext superRefine checks four things: every retrieved chunk's moduleId is in allowedModuleIds, every chunk's teacherId matches the entitlement, packageId/packageVersion match `pkg`, and agentId matches `agent.id`. Each has an invalid fixture, and one test checks all five paths at once.
9. zod is now a peer dependency (4.6.7) plus a dev dependency of contracts. The harness lists zod 4.6.7 as a dependency because it now consumes contracts at runtime; rule 3 allows zod.
10. Comment on TurnInput: web merges the session studentId before parsing.
11. `omit.ts`: a comment says why the cast is safe.

## exactOptionalPropertyTypes cases
None needed a workaround. zod 4.6.7 has `.exactOptional()`, which infers `key?: T` (no `| undefined`), so every optional key is exactly equal to the spec type, both directions. All optional fields use `.exactOptional()`: `AgentConfig.regulatedSubject`, `PackageConfig.trialDays`, `Entitlement.subscriptionId`, `Chunk.score`, `Message.sources`, `TurnInput.text/skill/skillPayload/attachments`, `TurnContext.persona`, `TeacherQuestion.moduleHint/answeredAt`, `TurnEvent.locked.packageName`, `ModelPolicy.fallback`, `ModelRequest.tools/temperature/cacheKey`, `LearnerProfile.lastSummary`, `TurnTrace.guards[].action`. `z.partialRecord` gives exactly `Partial<Record<…, string>>`. Required `unknown` keys (`TurnEvent.skill.payload`, `ModelChunk.tool_call.args`, `tools[].inputSchema`) infer as required `unknown`. At runtime an explicit `undefined` on an optional key is rejected (invalid fixture "explicit undefined for an optional key"). No mutual-assignability helper was needed.

## Changes
- `packages/contracts/src/`: `limits.ts` (`LIMITS`, `countChars`, `countWords`), `formats.ts` (field-format helpers, not exported from the index), `shared.ts`, `model.ts`, `teacher.ts`, `access.ts`, `locale.ts`, `memory.ts` (incl. `EvidenceEvent`), `turn.ts`, `safety.ts`, `trace.ts`, `ports.ts` (type-only), `index.ts`.
- `packages/contracts/fixtures/`: `valid/*.ts` (typed with `satisfies`), `invalid/*.ts` (`{ schema, name, value, path }`), `invalid/case.ts`, `omit.ts`, `index.ts` (`schemas`, `validFixtures`, `invalidFixtures` keyed by type name, named demo constants).
- `packages/contracts/test/`: `spec-types.ts`, `spec-drift.test.ts`, `types.test.ts`, `registry.test.ts`, `roundtrip.test.ts`, `refinements.test.ts`.
- `packages/contracts`: `package.json` (zod 4.6.7 exact, a peer + dev dependency since fix round 1; `.` and `./fixtures` exports to `dist/src` and `dist/fixtures`, `test` script, vitest/coverage/@types/node dev deps, description), `tsconfig.json` (noEmit; src, fixtures, test), `tsconfig.build.json`, `vitest.config.ts` (80% thresholds; actual 100%).
- `packages/harness`: `package.json` (`./testing` export, `test` script, vitest dev deps; zod 4.6.7 since fix round 1), `tsconfig.build.json` (excludes `*.test.ts` from dist), `vitest.config.ts`, `src/testing/index.ts`, `src/testing/fixtures.test.ts`.
- `pnpm-lock.yaml`, `README.md` (contracts line), `.prettierignore` (spec copy).

## Deviations
- `src/formats.ts` added (not in the plan's layout): shared field-format builders (`id`, `count`, `timestamp`, `market`, `currencyCode`, `tier`), kept out of the public index.
- `fixtures/omit.ts` added: a helper to drop a key for "missing field" fixtures (rest destructuring tripped `no-unused-vars`).
- `.prettierignore` gains `packages/contracts/test/spec-types.ts`: Prettier would reformat the verbatim spec copy (whitespace is normalised, but Prettier also changes punctuation and comment placement).
- Harness `build` now uses a new `tsconfig.build.json` (same as `tsconfig.json` minus test files), so tests don't ship in `dist`.
- `invalidFixtures` is keyed by schema name and each case also carries `schema` (the plan showed both shapes).
- PR size: about 650 lines of schemas and 420 of tests, plus about 170 lines of spec copy and the fixtures, so it is over 600 lines excluding fixtures; most of the growth is Prettier wrapping at the repo's print width.
- The harness test uses a minimal `{ safeParse }` type instead of importing zod. Fix round 1 added zod to the harness after all (see item 9), which the plan had kept out.
- Not written: `docs/tasks/0.3/review.md` (the lead writes it from the three reviewers).

## Decisions

### 18 Oct 2026 · 0.3 Contracts created · decided by team lead · risk: high
Decided: The shared contracts now exist as Zod schemas, exactly matching the build plan's Core contracts. Tests fail if the code and the spec drift apart. Unknown fields are rejected, and the limits in the spec comments are enforced. From now on, changing a contract needs an ADR.
Why: Every package builds on these shapes; the tests prove they match the spec.
Alternatives: Hand-written TypeScript types without runtime checks.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Ports live in contracts · decided by team lead · risk: medium
Decided: The ports (Guard, Tool, RetrievalIndex, the stores, UsageMeter, ModelGateway, TraceSink, AlertSink) are type-only interfaces in packages/contracts/src/ports.ts, with no Zod schemas and no fixtures. The db, gateway and ingest adapters implement them by importing contracts, although the spec's repo layout says the harness defines them.
Why: Adapters can implement them without depending on the harness; functions can't be Zod data.
Alternatives: Define them in packages/harness.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Spec shapes kept as written · decided by team lead · risk: low
Decided: TurnEvent hint_rung keeps rung as a number and TurnTrace guards keep action as a plain string, as the spec says; at runtime hint_rung must be a whole number from 0 to 4.
Why: No type change to the spec, but bad rungs are still caught.
Alternatives: Change the types to the rung union and the guard action enum (needs an ADR).
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Conditional rules enforced · decided by team lead · risk: medium
Decided: Four rules from the spec comments are checked at runtime: an entitlement has a subscriptionId exactly when its source is subscription; no module is both allowed and locked (fail closed); a message turn needs text; a skill_action turn needs a skill. Each has a valid and an invalid fixture. TeacherQuestion.answeredAt has no rule.
Why: The spec states them in comments; checking them stops bad data at the boundary.
Alternatives: Leave them to the code that uses the data.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Field formats · decided by team lead · risk: medium
Decided: Timestamps are ISO 8601 with Z or an offset. Languages are a lowercase 2–3 letter primary tag. Currency is three capital letters. Market is a two-capital-letter ISO 3166 code or the word "global" (no invented codes; the pilot market stays your decision). Ids are any non-empty string. Counts, token numbers, versions, minor-unit amounts and cost are whole numbers from 0 up. Mastery p is between 0 and 1. Characters are counted as Unicode code points and words as runs of non-space. Attachment mime must start with image/.
Why: The spec gives these fields as plain strings and numbers; these are the narrowest formats it implies.
Alternatives: No format checks.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 No default message limit in the contract · decided by team lead · risk: low
Decided: PackageConfig.dailyMessageLimit is required in the contract; the studio and the seed fill in 20.
Why: A Zod default would make the field optional in the input type and break the exact match with the spec.
Alternatives: A Zod default of 20.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Zod version and strict objects · decided by tdd-guide · risk: low
Decided: Contracts pin zod 4.6.7 exactly (the newest stable 4.x on npm today). Every object schema is strict, so unknown keys are errors, not silently dropped; a client-sent packageId on a turn is rejected. Optional fields use Zod's exactOptional, so the types match the spec exactly and an explicit undefined is rejected.
Why: Zod 4 has the features the plan needs; strict objects catch typos and client-sent access fields.
Alternatives: zod 3; stripping unknown keys.
Reversible: Yes for the version; strictness only by ADR.

### 18 Oct 2026 · 0.3 Prompt-pack version is semver · decided by tdd-guide · risk: low
Decided: AgentConfig.promptPackVersion must be a semantic version such as 1.0.0 or 2.1.0-rc.1, because the spec comment says one semver pins the prompt-pack set.
Why: Catches values like "latest" that would break pinning.
Alternatives: Any string.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Size caps and safe formats · decided by tdd-guide · risk: medium
Decided: After review, the contracts cap sizes and narrow formats the spec left open. Ids are 1–128 letters, digits, _ or -. An attachment storage key is a relative path of at most 200 safe characters with no ".." part; an attachment is a PNG, JPEG, WebP or HEIC image of 1 byte to 20 MB. A skill payload is at most 16 KB of JSON. Turn text is also capped at 8,000 UTF-16 units before the 4,000-character count. Guard reasons are at most 500 characters; rewrite text and alert excerpts at most 8,000. Each locale PII pattern is at most 500 characters and must be a valid regular expression. The numbers live in LIMITS.
Why: Untrusted or model-made data reaches storage, prompts and alerts; small fixed caps stop abuse and runaway output at the boundary.
Alternatives: No caps; caps enforced only in the API layer.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Turn context must be consistent · decided by tdd-guide · risk: medium
Decided: A turn context is rejected if a retrieved chunk comes from a module the entitlement doesn't allow or from another teacher, or if the entitlement's package id, package version or agent id don't match the package and agent in the context.
Why: Fails closed if a bug ever mixes another package's or teacher's material into a turn.
Alternatives: Leave the checks to the pipeline code.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 One shared zod copy · decided by tdd-guide · risk: low
Decided: Contracts lists zod 4.6.7 as a peer dependency (and a dev dependency for its own tests), and each consumer installs zod itself; the harness now lists zod 4.6.7 because it uses the contracts at runtime.
Why: Every package then shares one zod, so schemas and their types stay compatible.
Alternatives: zod as a normal dependency of contracts.
Reversible: Yes.

### 18 Oct 2026 · 0.3 Review · decided by team lead · risk: low
Decided: The type cast in packages/harness/src/testing/fixtures.test.ts stays for now; the ports-in-contracts note goes into ADR-0002 (task 0.4). MEDIUM review findings were fixed in this PR, not deferred, because contracts freeze on merge.
Why: The cast is test-only and narrow; fixing contracts later would need an ADR and three reviewers.
Alternatives: Defer the MEDIUMs to a follow-up task.
Reversible: Yes.
