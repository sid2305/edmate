# Task 3.10: Locale packs — schema, loader and validation; a safe default pack; the first pack for the pilot market

Board: `board.py show 3.10` · M3 · deps 2.6, 3.6, M0 · branch `m3/3.10-locale-packs` · `needs_decision: pilot-market` (resolved below) · `risk: risky`.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Locale packs: schema, loader and validation; a safe default pack; the first pack for the pilot market with human-verified helplines and compliance."

Accept: "`edmate content validate` fails on missing fields; an unknown market falls back to the default pack and still raises safety alerts; PII patterns are validated at load with the `gu` flags and a safe-regex check; the real IN pack passes 4.2's PII pipeline test (UPI included)."

### Pilot-market decision (resolves `needs_decision: pilot-market`)
Decision log, 18 Oct 2026: "The pilot runs in the US and India, with locale packs en-US and en-IN." But the Open-decisions table's own "Blocks" column reads **"3.10 (first pack), 10.1, 13.6"** — i.e. 3.10 ships the *first* pack only, and the payment-provider decision (Razorpay India / merchant-of-record US, same date) blocks the US pack's real payment fields at **10.1** (M10, payments — explicitly last per `CLAUDE.md`). The accept line itself only ever names the **IN** pack. So this plan builds: the schema, the loader, a safe **default/fallback** pack (`market: global`), and the real **IN** pack. It does **not** build an `en-US` pack — that is a follow-up task once M10 picks the US pack's payment and tax details. Not an open question (evidence is consistent); flagged under Decisions for the handoff.

### How it will be shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Schema | `packages/contracts/test/types.test.ts` + `hardening.test.ts`: `LocalePackSchema` accepts a helpline with `verifiedBy`/`verifiedOn` and a `compliance.parentalConsentRequired` boolean; rejects a helpline missing either field; existing piiPatterns/format tests unchanged. |
| Loader | `packages/content/src/localeLoader.test.ts`: reads one `content/locales/<MARKET>.yaml` file into a validated `LocalePack`; reads a directory of them into a `Map<market, LocalePack>` plus file-level errors, collected (not fail-fast), mirroring `readContentTree`. |
| `edmate content validate` fails on missing fields | `apps/cli/src/commands/content.test.ts`: running against a locale-packs directory with a file missing `compliance.grievance` (etc.) exits 1 and prints the issue; a fully valid directory exits 0. |
| Unverified helpline refused | `packages/content/src/localeRules.test.ts`: a pack with any helpline whose `verifiedBy` is the literal `pending` (or missing) is an issue, named by market and helpline; a pack with no helplines at all is **not** an issue (rule 4 of the locale-context skill: empty helplines is a valid, honest state). |
| Default pack / unknown-market fallback | `packages/content/src/localePacks.test.ts`: `pickLocalePack('global', packs)` and `pickLocalePack('zz', packs)` (an unmapped market) both return the `global` pack; `packages/harness/src/pedagogy/compose.test.ts` (existing suite, unchanged) already proves an empty `helplines` array renders the pack's `no-helplines` prompt-pack line — re-run with the *real* default pack's `piiPatterns`/`helplines: []` as one more case, proving "still raises safety alerts" end to end at the compose layer. |
| gu-flag + safe-regex check at load | `packages/content/src/localeRules.test.ts`: a pattern that compiles bare but not with exactly `gu` (e.g. one relying on `i`) is an issue; a structurally catastrophic pattern (`(a+)+$`, `(a\|a)+`, `(a\|aa)+c`) is an issue; the real default and IN patterns pass both checks. |
| Real IN pack passes 4.2's PII pipeline test | `packages/harness/src/guardrails/piiScrub.test.ts` (existing file, extended): the shared `CASES` table is exported from a new `packages/harness/src/testing/piiScrubCases.ts`; a new `packages/content/src/localePiiPipeline.test.ts` loads `content/locales/IN.yaml` through the real loader, builds `createPiiScrubGuard()` from `@edmate/harness` with `{ locale: <loaded IN pack> }`, and runs the same shared cases table (phone, email, card, OTP, name, **and** `IN_PII_PATTERNS`'s aadhaar/PAN/**UPI**/phone-in) — 100% pass, same as the fixture pack today. |
| Helplines stay pending until verified | `content/locales/IN.yaml` ships with its one candidate helpline (Tele-MANAS) carrying `verifiedBy: pending`; `edmate content validate content/locales` is **expected to fail** (one issue: unverified helpline) until the human supplies the fields listed below — this is by design, not a bug, and does not block merge (see Decisions). |
| Harness purity | `packages/harness/src/**` still imports only `@edmate/contracts`, `zod`, mathjs and its own modules; the new shared cases file lives under `packages/harness/src/testing/` (already a public `./testing` export), not `@edmate/content` imported *into* harness. `@edmate/content` importing `@edmate/harness` is the existing, already-approved direction (its `package.json` already lists `@edmate/harness` as a dependency). |

## Design

### What exists already (read only)
- `packages/contracts/src/locale.ts` — `LocalePackSchema`: `market, languages, timezone, currency, payments, helplines: {name,number,kind}[], compliance: {privacyLaw,minAge,dataRegion,grievance}, regulatedDisclaimers, piiPatterns` (each checked to bare-`compile`, ≤500 chars). No `tax` field (payments/tax stays out of scope — M10).
- `packages/contracts/fixtures/valid/locale.ts` — `demoLocalePack` (market IN, fictional helpline) and `localePackMinimal` (market global, no helplines) — today's stand-ins for "the default pack."
- `packages/harness/src/guardrails/piiPatterns.ts` / `piiScrub.ts` — `compileLocalePatterns` already compiles every locale source with exactly `'gu'` and throws `PiiPatternError` (fail closed) at **guard run time**; this task adds the *same* flag check earlier, at **content-validate time**, so a bad pack is caught before it ever reaches a guard.
- `packages/harness/src/testing/piiLocaleFixtures.ts` — `IN_PII_PATTERNS` (aadhaar, pan, upi, phoneIn) and `indiaLocalePackWithPii`; its own header comment: *"A stopgap until 3.10 ships the real `content/locales/IN.yaml` patterns and the loader; 3.10's pack must pass the same piiScrub tests."* This task's IN pack uses these exact four regex sources (already hand-verified safe and bounded — no unbounded nested quantifiers).
- `packages/harness/src/guardrails/piiScrub.test.ts` — the existing `CASES` table (phone/email/card/OTP/name + the India patterns) run against `indiaLocalePackWithPii`; 4.2's handoff follow-up: *"3.10: load the real `content/locales/IN.yaml` patterns; they must pass `piiPatterns.test.ts`/`piiScrub.test.ts` as the test pack does; add a safe-regex (ReDoS) check at pack load."*
- `packages/db/src/repositories/ports.ts` — `TurnConfigStoreOptions.locales(market): LocalePack | null`, comment: *"Until task 3.10 the composition root passes fixtures."* This task does not touch `ports.ts` or any composition root — no app wires a real `locales()` yet (3.9, the first CLI consumer, is still `todo` with no dep on 3.10). It ships the pieces a later composition root will call: a loader and a `pickLocalePack` default-fallback helper.
- `packages/content/src/{schema,loader,rules,validate}.ts` — the established pattern for a content kind: schemas (zod, strict), a loader that collects every file error instead of failing fast, cross-file rules returning plain-words issues, and `validateContentDir` dispatching on what the directory holds. `validate.ts`'s own comment: *"Task 3.10 adds a branch for locale packs here."*
- `apps/cli/src/commands/content.ts` — `edmate content validate [dir]`, already takes an arbitrary directory (default `content/demo-teacher`); no new subcommand needed, `content/locales` is validated by passing it as `[dir]`.
- `.claude/skills/locale-context/SKILL.md` — the pack shape and the per-market facts; its pseudo-YAML uses `snake_case` (`reviewed_by`, `source_url`) which the *real* schema does not (it's camelCase throughout: `privacyLaw`, `minAge`, ...). This plan keeps the real schema camelCase and updates the skill doc's example to match (small doc fix, not a contracts change).
- `packages/harness/src/pedagogy/compose.ts` — already renders `locale.helplines.length === 0 ? f['no-helplines'] : <list>`, so the "unknown market falls back to the default pack and still raises safety alerts" behaviour is already correct *once a default pack with `helplines: []` exists and is returned instead of `null`*.

### 1. Contracts change — `packages/contracts/src/locale.ts` (needs an ADR)
Two additions to `LocalePackSchema`, both required by this task's own constraints:
```ts
helplines: z.array(z.strictObject({
  name: z.string(), number: z.string(), kind: z.string(),
  verifiedBy: z.string().min(1).max(200),   // a name or handle; reuse the "no email" shape content/schema.ts's reviewer() uses, defined locally (contracts must not import @edmate/content)
  verifiedOn: z.iso.date(),                  // YYYY-MM-DD; new format helper in formats.ts
})),
compliance: z.strictObject({
  privacyLaw: z.string(), minAge: count(), dataRegion: z.string(), grievance: z.string(),
  parentalConsentRequired: z.boolean(), // per market, independent of the platform-wide 13-17 age band (1.7 owns the age band itself)
}),
```
`verifiedBy`/`verifiedOn` are **required strings**, not optional — the literal string `"pending"` and an arbitrary placeholder date are valid *schema* values; a content-package **rule** (not the schema) refuses the literal `pending` in a loaded pack. This is what lets the IN pack be committed today and still fail `edmate content validate` honestly until a human signs off (see Decisions and Human inputs below).
- `formats.ts`: add `date = () => z.iso.date()`.
- Fixtures (`packages/contracts/fixtures/valid/locale.ts`, `invalid/locale.ts`): update `demoLocalePack` (gets a fake `verifiedBy`/`verifiedOn` and `compliance.parentalConsentRequired: true`) and `localePackMinimal` (`parentalConsentRequired: false`); add one new invalid case per new field (helpline missing `verifiedBy`; `parentalConsentRequired` as a non-boolean).
- `packages/contracts/test/hardening.test.ts` / `types.test.ts`: extend for the two new fields.
- `packages/harness/src/testing/piiLocaleFixtures.ts`'s `indiaLocalePackWithPii` spreads `demoLocalePack`, so it gets the new fields for free; `piiScrub.test.ts` needs no change beyond the CASES-extraction below.
- **Draft ADR** (next free number — check `docs/adr/` again at build time; 0006 and 0008 are both free today, recommend **0008** to stay after the highest existing, 0007): "ADR-0008: LocalePack helpline verification and per-market parental consent." Context: 3.10 needs the loader to refuse an unverified helpline in a production pack, and 1.7/M6 (DPDP gate, 6.0b) need a per-market consent flag in the pack rather than hard-coded in code. Decision: the two fields above. Alternatives considered: (a) a top-level pack `reviewedBy` only, no per-helpline field — rejected, a helpline number changes on its own schedule and a single pack-level sign-off would hide a stale number; (b) store verification status in a side file instead of the schema — rejected, the loader must be able to fail closed from one source of truth. Consequences: every existing `LocalePack` fixture/producer must add the two helpline fields and the one compliance field; breaking, but `LocalePack` has no other producers yet (no DB table, no app). Reviewers: architect, security-reviewer, typescript-reviewer.

### 2. Loader + schema — `packages/content/src/localeSchema.ts`, `localeLoader.ts`
- `localeSchema.ts`: re-exports `LocalePackSchema`/`LocalePack` from `@edmate/contracts` (single source of truth; no draft/omit the way teacher content does, because a locale pack has no server-assigned ids to drop).
- `localeLoader.ts`, mirroring `loader.ts`'s shape:
  - `readLocalePack(path): LocalePack` — one file, YAML-parsed, zod-validated; throws naming the file on bad YAML or a schema mismatch (reuses the existing `ContentLoadError` type).
  - `readLocalePacksDir(dir): { packs: Map<string, LocalePack>; errors: ContentLoadError[] }` — every top-level `*.yaml` file in `dir`, filename must equal `<market>.yaml` (the pack's own `market` field doubles as a filename check: a mismatch is an error); duplicate markets (shouldn't happen if filenames are unique, but a file named `in.yaml` and `IN.yaml` on a case-sensitive filesystem would collide in the map) raise an error too.
- `validate.ts`: `validateContentDir` gains the branch its own comment calls for: if `course.yaml` is absent, check whether every top-level file matches the locale-pack filename shape; if so, run `readLocalePacksDir` + `LOCALE_RULES` instead of the teacher-content path; otherwise keep today's `"course.yaml: missing; not a recognised content directory"` message unchanged (no behaviour change for existing teacher-content callers).

### 3. Cross-file rules — `packages/content/src/localeRules.ts`
Four rules, same `(tree) => string[]` shape as `rules.ts`:
1. **`helplinesVerified`** — every helpline's `verifiedBy` is not the literal `pending` and not blank; `verifiedOn` parses as a real calendar date (zod already guarantees the format; this rule is about the *pending* sentinel, which is valid YAML/schema but not a real sign-off).
2. **`piiPatternsCompileWithGu`** — every `piiPatterns` source compiles with exactly `new RegExp(source, 'gu')` (not just bare `compile`, which the contracts schema already does without flags) — reuses `@edmate/harness`'s exported `compileLocalePatterns` so there is exactly one implementation of "the flags a locale pattern is compiled with."
3. **`piiPatternsSafeRegex`** — a small, dependency-free structural heuristic (no new npm package — see Open Q1) rejecting a source whose "star height" is >1 in a way that can backtrack exponentially: nested repeated groups (`(...[+*{]...)[+*]`) and a repeated group whose alternatives overlap on a prefix (`(a|a)+`, `(a|aa)+`). Paired with an empirical fallback: compile, then run each pattern against 3 small adversarial strings (`'a'.repeat(40) + '!'`, `'a'.repeat(40)`, a 40-char digit run with a trailing non-digit) behind a hard wall-clock budget (e.g. 100 ms) — a pattern that blows the budget is also an issue. Both run at `validate` time only, never per-turn (no behaviour change to `piiScrub`'s runtime).
4. **`defaultPackPresent`** — the directory must contain a `global.yaml` pack (the fallback); missing it is an issue (so a market-only content/locales dir without a default can never ship).
All four collected into `LOCALE_RULES`, run by `validate.ts`'s new branch, same "collect every issue, never fail-fast" style as `CONTENT_RULES`.

### 4. The safe default pack — `content/locales/global.yaml`
```yaml
market: global
languages: [en]
timezone: UTC
currency: { code: USD, format: "$#,##0.00" }
payments: { methods: [], provider: tbd }   # payments decided per market at M10 (10.1); no provider yet
helplines: []                               # honest empty state: compose.ts renders the no-helplines line
compliance:
  privacyLaw: "none verified for this market; consult local counsel before launch"
  minAge: 13
  dataRegion: "unspecified"
  grievance: "none verified for this market"
  parentalConsentRequired: true             # conservative default: require it unless a market's pack says otherwise
regulatedDisclaimers:
  investing: "Educational only; not investment advice."
piiPatterns: []
```
No human-verified content needed to ship this pack — it is a conservative, clearly-labelled placeholder used only when a market has no real pack, so every string above is deliberately generic, never a real legal citation.

### 5. The real IN pack — `content/locales/IN.yaml`
```yaml
market: IN
languages: [en, hi]
timezone: Asia/Kolkata
currency: { code: INR, format: "₹#,##,##0.00" }
payments: { methods: [], provider: tbd }    # Razorpay decided (18 Oct 2026) but wired at M10 (10.1); no methods yet
helplines:
  - name: Tele-MANAS
    number: pending
    kind: mental_health
    verifiedBy: pending
    verifiedOn: "2026-10-19"   # placeholder date; rule 1 above flags this as unverified by the "pending" literal, not the date
compliance:
  privacyLaw: "DPDP Act 2023 and Rules 2025 (citation only; a human/legal reviewer must confirm current wording before launch)"
  minAge: 13
  dataRegion: "US region (hosting decision, 18 Oct 2026); no India data-residency requirement found"
  grievance: pending
  parentalConsentRequired: true
regulatedDisclaimers:
  investing: "Educational only; not investment advice."
piiPatterns:
  - '(?<!\d)(?!(?:(?:19|20)\d\d[ -]?){3}(?!\d))\d{4}([ -]?)\d{4}\1\d{4}(?!\d)'   # aadhaar-like, from IN_PII_PATTERNS
  - '(?<![A-Za-z0-9])[A-Za-z]{5}\d{4}[A-Za-z](?![A-Za-z0-9])'                     # pan
  - '(?<![\w.\-@])[\w.\-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}(?![\w.\-@])'          # upi
  - '(?<![\d+])(?:\+?91[ \-]?|0)?[6-9]\d{9}(?!\d)'                                # phone_in
```
The four `piiPatterns` sources are copied **byte-for-byte** from `packages/harness/src/testing/piiLocaleFixtures.ts`'s `IN_PII_PATTERNS` (not re-derived), so "the real IN pack passes 4.2's PII pipeline test" is true by construction, not by luck. `number: pending` and `verifiedBy: pending`/`grievance: pending` are deliberate: this file is expected to fail `edmate content validate content/locales` until the human supplies the fields below. That failure is the intended, documented state of this task's deliverable — see Decisions.

### 6. Shared PII test cases — `packages/harness/src/testing/piiScrubCases.ts` (new) + `piiScrub.test.ts` (extended)
Extract the existing `CASES` array (and the small helpers that build/run it) out of `piiScrub.test.ts` into this new testing-only module, exported via `packages/harness/src/testing/index.ts` as e.g. `PII_SCRUB_CASES` and a `runPiiScrubCases(guard, ctx)` helper. `piiScrub.test.ts` imports it back (no behaviour change, same assertions, same file still owns the `describe`/`it` blocks and the India-specific/UPI cases). This is the one piece of this task that edits `packages/harness/src/guardrails/**` (risky path, safety-reviewer — see below); the change itself is a pure extraction, reviewed for not weakening any existing case.

### 7. `packages/content/src/localePiiPipeline.test.ts` (new)
Loads `content/locales/IN.yaml` through `readLocalePack`, builds `createPiiScrubGuard()` from `@edmate/harness`, and calls `runPiiScrubCases(guard, { locale: loadedInPack })` from `@edmate/harness/testing` — proving the *committed file*, not just the fixture, passes 4.2's suite (phone, email, card, OTP, name, aadhaar, PAN, UPI, phone_in).

### 8. CLI docs only — `apps/cli/src/commands/content.ts`
`CONTENT_USAGE` gains one line noting that `<dir>` may also be a locale-packs directory (e.g. `content/locales`); no code/behaviour change beyond what `validateContentDir` already does for an arbitrary `dir`. `apps/cli/src/commands/content.test.ts` gets one new case: running `content validate content/locales`-shaped fixture directory and getting the expected issues list (fixture, not the real committed directory — the real one is expected red, see above, and a CLI test must not assert a conclusion the human's future sign-off would silently change).

### 9. Skill doc fix (non-blocking) — `.claude/skills/locale-context/SKILL.md`
Update the pseudo-YAML pack shape to camelCase (`privacyLaw` not `privacy_law`, `dataRegion` not `data_region`, etc., matching the real schema) and add `verifiedBy`/`verifiedOn` per helpline and `parentalConsentRequired` under `compliance`. Not a risky path (`.claude/skills/**` is not in `risk-paths.txt`'s globs — only `.claude/**` under the "harness, hooks and CI" group, reviewers: security-reviewer, applies here too since the glob `.claude/**` does match; flagged below).

## Tests first (TDD order)

1. `packages/contracts/test/types.test.ts` + `hardening.test.ts` — new required helpline fields and `compliance.parentalConsentRequired`; a pack missing either rejects with the right path. *(red until §1 lands)*
2. `packages/content/src/localeLoader.test.ts` — `readLocalePack` on one good/bad fixture file; `readLocalePacksDir` collects every file's errors, never fail-fast (same style as `loader.test.ts`).
3. `packages/content/src/localeRules.test.ts` — one test per rule (`helplinesVerified`, `piiPatternsCompileWithGu`, `piiPatternsSafeRegex` with at least the three catastrophic patterns named above plus the four real IN patterns as known-safe, `defaultPackPresent`).
4. `packages/content/src/validate.test.ts` — the new dispatch branch: a fixture locale-packs directory (not `content/locales` itself) with one file missing a required field fails with that issue; a fully valid fixture directory passes; a directory that is neither a teacher tree nor a locale-packs tree keeps today's error message unchanged.
5. `apps/cli/src/commands/content.test.ts` — one new case driving the CLI over the same fixture directory.
6. `packages/harness/src/testing/piiScrubCases.ts` extraction + `piiScrub.test.ts` still green, byte-identical assertions (safety-reviewed, see risky paths).
7. `packages/content/src/localePiiPipeline.test.ts` — loads the *real* `content/locales/IN.yaml`, runs the shared cases, 100% pass (this is the literal "4.2's PII pipeline test" acceptance check).
8. Manual/CI check (not a unit test): `edmate content validate content/locales` on the real directory returns exit 1 with exactly the "Tele-MANAS: verifiedBy is 'pending'" and "grievance is 'pending'"-shaped issues — captured in the handoff as the expected, intentional failing state, not asserted in a unit test (a test must not break every time the human finishes verification).

## Files to create
- `packages/content/src/localeSchema.ts`, `localeLoader.ts`, `localeRules.ts` + their `.test.ts` files
- `packages/content/src/localePiiPipeline.test.ts`
- `packages/content/test/fixtures/locales/valid/*.yaml`, `.../broken/*.yaml` (small, fabricated, non-real markets for rule tests, e.g. `XX.yaml`/`global.yaml` test doubles — never reuse real IN/global file content for destructive edits; copy-and-break like `copyValid()`)
- `packages/harness/src/testing/piiScrubCases.ts`
- `content/locales/global.yaml`, `content/locales/IN.yaml`
- `docs/adr/0008-locale-pack-helpline-verification.md` (number to confirm at build time)

## Files to modify
- `packages/contracts/src/locale.ts`, `formats.ts`
- `packages/contracts/fixtures/valid/locale.ts`, `fixtures/invalid/locale.ts`
- `packages/contracts/test/types.test.ts`, `test/hardening.test.ts`
- `packages/content/src/validate.ts` (new branch), `src/index.ts` (export the new modules)
- `packages/harness/src/guardrails/piiScrub.test.ts` (extraction only)
- `packages/harness/src/testing/index.ts` (export `PII_SCRUB_CASES`/`runPiiScrubCases`)
- `apps/cli/src/commands/content.ts`, `content.test.ts` (docs line + one test)
- `.claude/skills/locale-context/SKILL.md` (camelCase fix + new fields)

## Files out of bounds
- `packages/db/src/repositories/ports.ts` / any composition root — `TurnConfigStoreOptions.locales` wiring is a later task's job (no app calls it in production yet); this task only ships what such a function would load.
- `apps/web/**`, `apps/worker/**` — nothing here yet needs a locale pack.
- Any `en-US`/`US.yaml` pack — out of scope per the pilot-market decision analysis above; left to the M10 payments-era task.
- `content/demo-teacher/**` — unrelated content kind, not touched.
- `packages/content/src/schema.ts`/`loader.ts`/`rules.ts` (the teacher-content modules) — new locale modules sit beside them, not inside them.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/contracts/**` → reviewers: architect, security-reviewer, typescript-reviewer (the helpline/consent schema change; ADR required, drafted above).
- `content/locales/**` → reviewers: safety-reviewer (helpline and crisis-reply content; this group is listed under "Student safety and teaching behaviour").
- `packages/harness/src/guardrails/**` (the `piiScrub.test.ts` extraction) → reviewers: safety-reviewer.
- `.claude/**` (the `locale-context` skill doc fix) → reviewers: security-reviewer.
- Not risky, ordinary review: `packages/content/**`, `apps/cli/**`.
- This task plans a `risk: high` decision-log entry for the handoff (the board already marks it `risk: risky`), covering the contracts/ADR change together with the helpline-verification mechanism.

## Exact human inputs needed (the builder must not invent or look up any of these)
For `content/locales/IN.yaml` to pass `edmate content validate`:
1. **Helpline(s):** for each one — real, routable **number**, confirmed **name**, **kind**, a **source URL**, **`verifiedBy`** (a human name or handle, no email — the repo is public), **`verifiedOn`** (the date it was checked). Tele-MANAS (14416) is cited in the PRD and the locale-context skill as a **candidate only**; it is not committed as fact here (`number: pending`) until the human confirms it is current and correct. The human may also add a general emergency number (e.g. India's 112) if they want more than one line.
2. **`compliance.grievance`:** the actual IT Rules 2021 grievance-officer contact Edmate will publish (name/role + channel) — this is a real, legally required contact, not a placeholder.
3. **`compliance.privacyLaw`:** confirm the citation ("DPDP Act 2023 and Rules 2025") is current and sufficient, or supply updated wording — ideally with the same reviewer/date discipline as the helpline, though the schema only requires this for helplines today (see Open Q2).
4. Optionally, confirmation that `compliance.dataRegion`'s current wording ("US region; no India data-residency requirement found" per the 18 Oct 2026 hosting decision) is acceptable to state in a public pack, or a correction.

Everything else in both packs (schema, loader, rules, default pack, the IN pack's market/currency/timezone/languages/PII patterns/`parentalConsentRequired`) can be built and merged now without any human input.

## Open questions (with recommendation)

**Q1 — Safe-regex (ReDoS) check: hand-rolled heuristic, or the `safe-regex` npm package?**
Recommendation: hand-rolled (structural nested-quantifier check + a small empirical timing test), as designed in §3 rule 3, kept inside `packages/content` (not `packages/harness`, which may not take new dependencies either way). Reasoning: avoids any question of this being a "tech stack change" needing its own ADR, matches the codebase's existing style of hand-written pattern/safety logic (`textFold.ts`, `piiPatterns.ts`), and the four real patterns this task ships are already simple and bounded, so the bar is "catch an obviously bad future pattern," not "perfectly classify every regex." If the architect prefers the well-known `safe-regex` package instead, that is a one-file swap behind the same `piiPatternsSafeRegex` rule — not blocking.

**Q2 — Does `compliance.grievance`/`privacyLaw` need its own `verifiedBy`/`verifiedOn`, like helplines, or is a single pack-level reviewer enough?**
Recommendation: add one pack-level `reviewedBy`/`reviewedOn` pair (top-level, optional, mirrors `LicenceManifestSchema`'s top-level `reviewed_by` default) covering the compliance block as a whole, distinct from the **mandatory, per-entry** helpline fields the task explicitly asked for. This is a second, smaller contracts addition folded into the same ADR-0008. Not blocking: the task's hard constraint only named helplines; this is an enhancement the architect can accept or defer to a follow-up.

**Q3 — ADR number.**
0006 and 0008 are both free as of this reading (0007 is taken by the locked-leak-check ADR). Plan recommends 0008 (after the highest existing number); confirm at build time in case another in-flight task has since claimed it.

None of these block starting the build: the build can (and should) start with the schema, loader, default pack and validation rules landing first (TDD items 1-5), the IN pack committed with `pending` helpline/grievance fields so it deliberately fails production validation, and the shared-cases/pipeline-test pieces (items 6-7) landing last once the loader exists to feed them. Human sign-off on the Tele-MANAS number and the grievance contact is a separate, later step that re-runs `edmate content validate content/locales` to go green — it does not block this task's merge.

## Decisions (carry into handoff.md `## Decisions`)
- Scope: this task ships the default (`global`) pack and the real `IN` pack only; the `en-US` pack is deferred to the M10 payments-era task (10.1), per the open-decisions table's own "Blocks" column. `risk: medium` (reversible — adding a second pack later is additive).
- Contracts change: `LocalePack.helplines[]` gains required `verifiedBy`/`verifiedOn`; `compliance` gains required `parentalConsentRequired: boolean`. ADR-0008 drafted above. `risk: high` (contracts + safety path; needs the human's merge sign-off per the non-negotiables).
- The committed `content/locales/IN.yaml` ships with `pending` helpline number/verifier and grievance contact, by design, so `edmate content validate content/locales` is expected to fail until a human supplies real values (listed above). `risk: medium`.

## Lead revisions (19 Oct 2026)
1. ADR number: this task takes ADR-0008 (it builds first). 3.11d moves to ADR-0009. ADR-0006 is taken by 4.4 (open PR #47).
2. Q1: hand-rolled check, no new dependency. Make it structural first: reject nested quantifiers (a quantified group containing a quantifier), backreferences, lookbehind and alternations of overlapping branches under a quantifier; the timing probe on adversarial inputs is a second line, not the only one. Pack authors are trusted operators, so a strict rule that rejects some safe patterns is fine.
3. Q2: a single pack-level `reviewedBy` / `reviewedOn` for compliance, in the same ADR.
4. The IN pack ships with `pending` helplines and grievance contact. The runtime loader must refuse a pack with any unverified helpline for production use (not only the CLI validate), so an unverified pack can never serve a crisis reply; the default (`global`) pack's country-neutral wording ("contact local emergency services or a trusted person") is what serves until then. Test it.
5. Do not commit any helpline number. List the candidate (Tele-MANAS 14416, from the PRD) in the handoff for the human to verify.
