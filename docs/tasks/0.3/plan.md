# Task 0.3: `packages/contracts`, every Core contracts type as Zod, with fixtures

Board: `python3 .claude/skills/board/board.py show 0.3` · Milestone M0 · deps: 0.1 (done) · branch: `m0/0.3-contracts`

**Risky.** Every file under `packages/contracts/**` is in the "Contracts and ADRs" group of `risk-paths.txt`. Required reviewers: `architect`, `security-reviewer`, `typescript-reviewer` (opus). The handoff needs a `risk: high` decision (draft below).

## Acceptance (verbatim, from `docs/board/tasks.yaml`)

Title: "`packages/contracts`: every type in Core contracts as Zod, with fixtures in `packages/contracts/fixtures`"

Accept: "fixtures round-trip parse/serialize; exported `z.infer` types match Core contracts; `harness/testing` can import the fixtures."

### How each part is shown (paste in handoff.md)

| Part | Evidence |
|---|---|
| Fixtures round-trip | `test/roundtrip.test.ts`. Every valid fixture: `Schema.parse(f)` deep-equals `f`, and `Schema.parse(JSON.parse(JSON.stringify(parsed)))` deep-equals `parsed`. Every invalid fixture fails `safeParse` at its expected issue path. `test/registry.test.ts` fails if any exported schema has no valid fixture or no invalid fixture. Paste the vitest output with counts. |
| `z.infer` types match Core contracts | `test/spec-types.ts` is a verbatim copy of the build plan's Core contracts `ts` block, with `export` added and one `import type { ZodType } from 'zod'`. `test/types.test.ts` has one `expectTypeOf<X>().toEqualTypeOf<Spec.X>()` per type (both directions, so exact). It is checked by `tsc` (the `typecheck` script includes `test/`). `test/spec-drift.test.ts` pulls the `ts` block under `## Core contracts` out of `docs/edmate-harness-build-plan.md`, normalises whitespace, strips `export ` and the import line, and requires it to equal `spec-types.ts`. So the copy can't drift, and a later spec edit without a contracts change fails CI. Paste the typecheck output, plus one deliberate mismatch shown failing (then reverted). |
| `harness/testing` imports the fixtures | `packages/harness/src/testing/index.ts` re-exports `@edmate/contracts/fixtures`. `packages/harness/src/testing/fixtures.test.ts` imports from it and parses one fixture per schema. `pnpm turbo run typecheck lint test --filter=@edmate/harness...` is green, so the purity rule accepts the import. |

## Design

### Dependencies and version pin
- `zod`: an exact pin (no caret, matching 0.1's exact pins) to the newest stable **4.x**, in `packages/contracts` `dependencies`. The builder confirms the version with `docs-lookup` / `search-first` and logs it.
- Zod 4 is required for: `z.strictObject`, `z.partialRecord`, `z.iso.datetime`, exhaustive `z.record(z.enum(...))`, and `z.unknown()` keys that are not made optional.
- Contracts dev dependencies: `vitest` 5.0.5, `@vitest/coverage-v8` 5.0.5, `@types/node` 22.20.5 (copy the versions from `apps/worker`).
- Harness: add `vitest` and `@vitest/coverage-v8` as dev dependencies, plus a `test` script. Do **not** add zod to the harness yet; no harness code needs it.

### Rules for every schema
- **No transforms, defaults, coercion or preprocess.** Input type equals output type, so round-trips are exact and `z.infer` is the spec type.
- **`z.strictObject` everywhere**: unknown keys are rejected, not stripped. A client-sent `packageId` on `TurnInput` is therefore an error (access filter rule 1), and fixture typos are caught.
- **Naming:** `export const AgentConfigSchema = …; export type AgentConfig = z.infer<typeof AgentConfigSchema>`. String unions become `z.enum` (for example `SkillSchema`, with `SkillSchema.options` usable as the list).
- **Limits** from the spec comments are exported as one `LIMITS` const (`src/limits.ts`): 4,000 characters, 2 attachments, 300 style-card words, 60 summary words, help rungs 0–4. `admit` (3.2) reuses them instead of copying the numbers.
- **Refinements** (`.refine` / `.superRefine`) never change the inferred type. See the open questions for the ones proposed.

### Module layout (`packages/contracts/src/`, no import cycles; order = dependency order)
| File | Types |
|---|---|
| `limits.ts` | `LIMITS` |
| `shared.ts` | `Lang`, `Skill`, `Money`, `ErrorCode`, `Usage`, `ToolName` |
| `model.ts` | `ModelPolicy`, `ModelRequest`, `ModelChunk` |
| `teacher.ts` | `AgentConfig`, `StyleCard`, `PackageConfig` |
| `access.ts` | `Entitlement` |
| `locale.ts` | `LocalePack` |
| `memory.ts` | `LearnerProfile`, `EvidenceEvent` |
| `turn.ts` | `ChunkKind`, `SourceRef`, `Chunk`, `Attachment`, `Message`, `TurnInput`, `Intent`, `Attempt`, `Persona`, `TurnContext`, `PedagogyDecision`, `TeacherQuestion`, `TurnEvent` |
| `safety.ts` | `SafetyAlert`, `GuardResult` (`z.union`; `ok:false` has three variants, so it can't be a single discriminated union) |
| `trace.ts` | `TurnTrace` (reuses the `PedagogyDecision` move enum and `IntentSchema`) |
| `ports.ts` | **Type-only** (functions can't be Zod data): `Guard`, `Tool<I,O>`, `RetrievalIndex`, `EntitlementStore`, `ProfileStore`, `TranscriptStore`, `CorrectionStore`, `TeacherQuestionStore`, `UsageMeter`, `ModelGateway`, `TraceSink`, `AlertSink`. No fixtures (see Q1). |
| `index.ts` | re-exports all of the above |

The "embeddings are platform-wide config" comment is not a type, so no schema.

### Fixtures (`packages/contracts/fixtures/`)
- `valid/<module>.ts`: typed constants (`satisfies` the inferred type), so they are checked at compile time and at runtime. Use at least one minimal case (required fields only) and one full case (every optional field) per schema, plus one value per variant of each union (`TurnEvent` ×10, `ModelChunk` ×3, `GuardResult` ×4, all three `Entitlement.source` values).
- `invalid/<module>.ts`: `{ schema: 'TurnInput', name, value: unknown, path: ['text'] }` cases, at least one per schema. They cover each limit (4,001 characters, 3 attachments, 301-word style card, 61-word summary), negative or float `amountMinor`, lowercase currency, out-of-range `helpCeiling` and rung, an unknown key (`packageId` on `TurnInput`), `subscriptionId` missing for a subscription, overlapping allowed/locked modules, and a bad timestamp.
- `index.ts`: exports `validFixtures` / `invalidFixtures` keyed by schema name, plus named constants (`demoAgentConfig`, `demoPackageFree`, …) that `harness/testing` and the scripted gateway (2.6) will reuse.
- **Public repo:** all data is obviously synthetic: ids like `stu_test_01`, "Example Helpline" with a non-routable number like `000-000-0000`, no names, emails or real excerpts. The builder runs `python3 .githooks/secret-scan.py --all` before each push.

### Package wiring (`packages/contracts`)
- `tsconfig.json`: `noEmit`, includes `src`, `fixtures`, `test` (used by `typecheck`, so the `expectTypeOf` assertions run).
- `tsconfig.build.json`: `rootDir: "."`, includes `src` and `fixtures`, emits `dist/src` and `dist/fixtures`. The `build` script uses it.
- `package.json` `exports`: `"."` → `./dist/src/index.{js,d.ts}`, `"./fixtures"` → `./dist/fixtures/index.{js,d.ts}`. Add a `test` script (`vitest run --coverage`) and update the description.
- `vitest.config.ts`: coverage on `src/**` and `fixtures/**`, 80% thresholds.
- Harness: `package.json` gets `"./testing"` → `./dist/testing/index.{js,d.ts}`. Check that the harness `tsconfig.build`/`include` emits `src/testing`. The harness purity regex `^@edmate\/contracts($|\/)` already allows the subpath.

## Files

**Create**
- `packages/contracts/src/{limits,shared,model,teacher,access,locale,memory,turn,safety,trace,ports}.ts`
- `packages/contracts/fixtures/index.ts`, `fixtures/valid/*.ts`, `fixtures/invalid/*.ts`
- `packages/contracts/test/{spec-types.ts,types.test.ts,spec-drift.test.ts,roundtrip.test.ts,registry.test.ts,refinements.test.ts}`
- `packages/contracts/tsconfig.build.json`, `packages/contracts/vitest.config.ts`
- `packages/harness/src/testing/index.ts`, `packages/harness/src/testing/fixtures.test.ts`, `packages/harness/vitest.config.ts`
- `docs/tasks/0.3/handoff.md`

**Modify**
- `packages/contracts/src/index.ts`, `packages/contracts/package.json`, `packages/contracts/tsconfig.json`
- `packages/harness/package.json` (`./testing` export, test script, vitest dev deps); `packages/harness/tsconfig*.json` only if `src/testing` isn't already emitted
- `pnpm-lock.yaml`
- `README.md` (one line: contracts and fixtures exports), `docs/board/tasks.yaml` (lead only)

**Out of bounds**
- `docs/edmate-harness-build-plan.md`: no spec edits. If an open question needs a shape change, stop and return it to the lead.
- `docs/adr/**` (task 0.4), `packages/harness/src/{access,guardrails}/**`, `packages/config/**` (no lint or tsconfig preset changes), `.claude/**`, other packages and apps.

## Tests first (order)
1. `spec-types.ts` + `spec-drift.test.ts` (fails until the copy is exact).
2. `types.test.ts` against empty schemas (typecheck fails).
3. `registry.test.ts` + `roundtrip.test.ts` + `refinements.test.ts` with the fixtures (fail).
4. Implement the schemas module by module in dependency order until green.
5. Harness `fixtures.test.ts`, the exports and the build.
6. `corepack pnpm turbo run build typecheck lint test --filter=@edmate/contracts... --filter=@edmate/harness...`, then the secret scan.

Coverage of new code ≥ 80% (the schemas are declarative; the refinements need 100% branch coverage via `refinements.test.ts`).

## Risky paths touched (checked against risk-paths.txt)
- `packages/contracts/**` (every contracts file above): group "Contracts and ADRs". Reviewers: **architect, security-reviewer, typescript-reviewer (opus)**.
- `packages/harness/src/testing/**`, `packages/harness/package.json`, `packages/harness/vitest.config.ts`, `pnpm-lock.yaml`, `README.md`, `docs/tasks/0.3/**`: no match.
- No migrations. No safety prefixes (guardrails, prompt packs, skills, locales, safety/locked evals, alerts).

**ADR: not required for this first version.** The build plan says "Task 0.3 creates them; changing one afterwards needs an ADR" (Core contracts intro; rule 2 is about *changing* contracts). `docs/adr/` doesn't exist yet (task 0.4), and 0.7's design waived the ADR for 0.3 only. Every contracts change after 0.3 merges needs an ADR. The three reviewers and the `risk: high` entry still apply.

## Planned `risk: high` decision (handoff `## Decisions`)
### <date> · 0.3 Contracts created · decided by team lead · risk: high
Decided: The shared contracts now exist as Zod schemas, exactly matching the build plan's Core contracts. Tests fail if the code and the spec drift apart. Unknown fields are rejected, and the limits in the spec comments are enforced. From now on, changing a contract needs an ADR.
Why: Every package builds on these shapes; the tests prove they match the spec.
Alternatives: Hand-written TypeScript types without runtime checks.
Reversible: Only by ADR.

Other decisions to log: the zod version; strictObject; port placement (Q1); the formats in Q4; the refinements in Q3; no default for `dailyMessageLimit` (Q5).

## Open questions (lead decides; none blocks the build)
- **Q1. Where do ports live?** Repo layout says "`harness` defines ports"; Core contracts says these types live in `packages/contracts`. *Recommend:* type-only interfaces in `contracts/src/ports.ts` (db, gateway and ingest implement them without depending on harness). Harness re-exports them later. No Zod and no fixtures for function interfaces.
- **Q2. Mismatched shapes within the spec.** `TurnEvent.hint_rung.rung: number`, but rungs are `0|1|2|3|4` elsewhere. `TurnTrace.guards[].action?: string`, but GuardResult actions are an enum. *Recommend:* keep the spec types as written; enforce `rung` as an integer 0–4 at runtime only. No type change.
- **Q3. Conditional rules the spec states in comments only.** *Recommend these refinements:* `Entitlement.subscriptionId` required when `source='subscription'` and absent otherwise; `allowedModuleIds ∩ lockedModuleIds = ∅` (fail closed); `TurnInput` `kind='skill_action'` needs `skill`, and `kind='message'` needs `text`. No rule for `TeacherQuestion.answeredAt` (the spec says nothing).
- **Q4. Formats for plain `string` fields.** *Recommend:*
  - timestamps: ISO 8601 with an offset (`z.iso.datetime({ offset: true })`);
  - `Lang`: `/^[a-z]{2,3}$/` (primary subtag only);
  - currency: `/^[A-Z]{3}$/`;
  - `market`: ISO 3166-1 alpha-2 `/^[A-Z]{2}$/`. A "global English" pilot would need a user-assigned code (for example `XW`); decide that with the pilot market;
  - ids: non-empty strings with no format (pseudonymous);
  - counts, tokens, `amountMinor`, `costMicroUsd`: non-negative safe integers;
  - `p` in [0,1];
  - "characters" counted as Unicode code points; "words" split on whitespace;
  - `mime` starts with `image/`.
- **Q5. `dailyMessageLimit` "default 20".** A Zod default would make the field optional in the input type and break exact equality. *Recommend:* field required in the contract; studio and seed apply 20.

## Risks
- **`exactOptionalPropertyTypes` vs Zod `.optional()`** (Zod may infer `?: T | undefined`, which is not exactly the spec's `?: T`). The builder checks the pinned zod for an exact-optional API. If there is none, the type test treats `| undefined` on optional keys as equal through one documented helper, logged as a decision. Do not change the spec copy.
- **PR size** may exceed 600 lines excluding fixtures (schemas about 350, `spec-types.ts` about 170, tests about 250). Count `spec-types.ts` as fixture-like; flag it in the handoff.
- **Drift test brittleness:** keep the normalisation simple (whitespace, `export `, the import line). Document the regeneration step in a comment in `spec-types.ts`.

## Lead answers (18 Oct 2026; the human delegated contracts decisions to the lead)

- **Q1 Ports:** accepted. Type-only interfaces in `packages/contracts/src/ports.ts` (no Zod, no fixtures). Log as a decision (risk: medium): the spec's Repo layout says the harness defines them; adapters in db/gateway/ingest implement them by importing contracts.
- **Q2:** accepted. Keep `hint_rung.rung: number` and `guards[].action: string` as the spec says; enforce rung 0–4 with a Zod refinement.
- **Q3:** accepted, all four refinements, each with a valid and an invalid fixture.
- **Q4:** accepted, with one change: market is an ISO 3166 alpha-2 code **or the literal `global`** (no invented codes; the pilot market itself stays an open human decision). Log it.
- **Q5:** accepted. Required, no Zod default.
- **exactOptionalPropertyTypes risk:** where Zod's optional output can't equal the spec type exactly, assert mutual assignability in the type tests and record each such case in the handoff.
- **Parallel task:** 0.2 is being built at the same time and adds a dependency to apps/worker, so `pnpm-lock.yaml` may conflict at merge. Whichever merges second rebases on main, re-runs `corepack pnpm install` and the gates. Don't touch apps/ or docker/.
- The handoff needs the drafted `risk: high` decision (required by the gate for packages/contracts).
