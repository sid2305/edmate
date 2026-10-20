# Task 3.10 handoff: locale packs (schema, loader, validation, default pack, IN pack)

Status: DONE
Branch: `m3/3.10-locale-packs`
Worktree: `.claude/worktrees/agent-a16cf6e0f06500533` (relative to the repo root)

Built to `docs/tasks/3.10/plan.md` and its "Lead revisions (19 Oct 2026)": ADR-0008, a structural
safe-regex check before a timing probe, one pack-level `reviewedBy` / `reviewedOn`, the IN pack
committed with `pending` values, and a runtime loader that refuses a pack with an unverified
helpline. No helpline number, grievance contact or reviewer name is committed. The deviations are
listed below; the main one is that lookbehinds one character wide are still allowed (the real IN
patterns need them).

## Acceptance evidence

| Item | Evidence (command → trimmed output) |
|---|---|
| Schema (ADR-0008) | `packages/contracts/test/hardening.test.ts`, describe "LocalePack verification fields (ADR-0008)": a helpline missing `verifiedBy` / `verifiedOn` fails at its path; `verifiedBy` blank, over 200 characters or an email fails; `verifiedOn` must be a real `YYYY-MM-DD` date; `compliance.parentalConsentRequired` is a required boolean; `reviewedBy` / `reviewedOn` are optional but come as a pair. Four new invalid fixtures in `fixtures/invalid/locale.ts`. `types.test.ts` and `spec-drift.test.ts` pin the new shape against the build plan's Core contracts block (both updated). `@edmate/contracts:test` → `Tests 335 passed (335)`. |
| `edmate content validate` fails on missing fields | `packages/content/src/validate.test.ts` ("fails a locale pack with a missing field…") and `apps/cli/src/commands/content.test.ts` ("a locale pack missing a field or with a pending helpline exits 1 and names each issue"): exit 1, `XX.yaml: invalid locale pack: … compliance.grievance`, `global.yaml: … compliance.minAge`; a valid fixture directory exits 0. |
| Loader | `packages/content/src/localeLoader.test.ts`: `readLocalePack` (one file; bad YAML, schema mismatch, market ≠ file name, unreadable file each throw a `ContentLoadError` naming the file); `readLocalePacksDir` collects every bad file and unexpected entry, keeps the good packs; `isLocalePacksDir` dispatch. |
| Unknown market → default pack, still raises safety alerts | `packages/content/src/localePacks.test.ts` (`pickLocalePack('ZZ')` → global) and `packages/content/src/realLocales.test.ts`, describe "an unknown market falls back to the default pack and still raises safety alerts": with the **committed** `content/locales`, `ZZ` picks `global`; a distress system prompt composed with the **real** prompt packs carries the frame's no-helplines line ("contact local emergency services …") and no "pending"; a distress turn through the real `runTurn` emits `{type:'safety', level:'alert'}`, raises exactly one alert, and the caring reply is built for the `global` pack. |
| Unverified pack refused at runtime (lead revision 4) | `localePacks.test.ts`: `loadLocalePacks` leaves out a market pack with a `pending` helpline and reports it in `refused` with its reasons; `pickLocalePack` returns the default pack for it, even when handed the unfiltered map; loading fails closed with no default pack, with an unverified default pack, on a file that does not load, or on a non-`gu` or unsafe PII pattern. `realLocales.test.ts`: in the committed directory, a pack is served exactly when its helplines are verified, and no served pack shows a `pending` helpline (true before and after sign-off, so the test does not change when the human signs off). |
| PII patterns checked at load with `gu` and a safe-regex check | `packages/content/src/safeRegex.test.ts` (44 tests): structural rejection of `(a+)+$`, `(\d+)*`, `(?:a?)+`, `(a\|a)+`, `(a\|aa)+c`, `(?:ab\|ac)+`, `(a)\1`, `\k<n>`, `(?<=ab)x`, `(?<!\d+)x` and more; 16 safe shapes pass; the timing probe fails a pattern over budget (fake clock) and stops at the first slow input; structure runs first and skips timing when it fails. `localeRules.test.ts`: the gu rule (through the guard's own `compileLocalePatterns`) flags `\a`; the safe-regex rule flags the three catastrophic patterns from the plan; the real IN patterns pass both. |
| The real IN pack passes 4.2's PII pipeline test (UPI included) | `packages/content/src/localePiiPipeline.test.ts`: loads `content/locales/IN.yaml` through `readLocalePack`, runs 4.2's shared cases (`PII_SCRUB_CASES`: phone, Devanagari phone, email, card, OTP, name, Aadhaar-like, PAN, **UPI**) through the real `createPiiScrubGuard` → `piiScrubCaseFailures(...) = []`; the pack's patterns equal `IN_PII_PATTERNS` byte for byte, so every harness `piiPatterns.test.ts` / `piiScrub.test.ts` case also covers the committed pack. |
| The real directory fails validation on purpose | `node apps/cli/bin/edmate content validate content/locales` → exit 1, `4 issues`: `IN.yaml: helpline "Tele-MANAS": number is "pending"`, `… verifiedBy is "pending"`, `IN.yaml: compliance.grievance is "pending"`, `IN.yaml: reviewedBy is "pending"`. The default pack passes every rule on its own (`realLocales.test.ts`). This turns green when the human inputs below are filled in. |
| Full gate | Infra up (`docker compose … up -d postgres redis`), then `corepack pnpm turbo run typecheck lint test --filter=...@edmate/contracts --force` → `Tasks: 37 successful, 37 total`; nothing skipped. Tests: contracts 335, harness 3139, content 267, cli 48, db 491, evals 300, gateway 405, web 132, worker 106, queue 40, all passed. Coverage: `src/guardrails` 100/100/100/100; `@edmate/content` all files 99.4 statements / 96.07 branches / 100 functions / 100 lines (`localePacks.ts`, `localeRules.ts` 100%; `localeLoader.ts` 100 lines / 90 branches; `safeRegex.ts` 98.1 / 96.4). |
| Harness purity | `packages/harness/src/testing/piiScrubCases.ts` imports only harness modules; `@edmate/content` imports `@edmate/harness` (the existing direction). No new dependency anywhere. |
| ADR headings, secret scan | `python3 docs/adr/check-headings.py` → no output, exit 0. `python3 .githooks/secret-scan.py --all` → no output, exit 0. |

## Human inputs needed (exact list; agents must not fill any of these in)

For `content/locales/IN.yaml` to pass `edmate content validate content/locales`, and for India
students to get the India pack instead of the default one:

1. **Helpline(s)**, for each line: the real **number**, the confirmed **name** and **kind**, **`verifiedBy`** (your name or handle, never an email; the repo is public) and **`verifiedOn`** (the date you checked it). Candidate: **Tele-MANAS 14416**, cited in the PRD (line 270) and the locale-context skill. It is not committed as fact (`number: pending`) until you confirm it is current. Please keep the source URL you checked in the PR or review record (the schema has no URL field; see ADR-0008). Optional: a general emergency number (for example 112) as a second line.
2. **`compliance.grievance`**: the IT Rules 2021 grievance-officer contact Edmate will publish (name or role plus a channel). It is a legally required public contact.
3. **`reviewedBy` / `reviewedOn`** for the compliance block, after confirming:
   - `privacyLaw: "DPDP Act 2023 and DPDP Rules 2025"` is the right citation;
   - `dataRegion: "United States (hosting decision, 18 Oct 2026)"` is fine to state in a public pack;
   - `minAge: 13` and `parentalConsentRequired: true` (13 to 17 need verifiable parental consent; your 18 Oct 2026 decision).

Until then `edmate content validate content/locales` exits 1 with the four issues above, and the
runtime serves India students the default pack (see the PII note in Decisions).

## Changes

- **Contracts (ADR-0008):** `packages/contracts/src/locale.ts` (helpline `verifiedBy` / `verifiedOn`, `compliance.parentalConsentRequired`, top-level `reviewedBy` / `reviewedOn` pair via `superRefine`); `formats.ts` (`date()`, `signer()`); `limits.ts` (`signerMaxLength: 200`); fixtures valid/invalid; `test/hardening.test.ts`; `test/spec-types.ts` and `docs/edmate-harness-build-plan.md` (the same `LocalePack` text, so spec drift stays green).
- **ADR:** `docs/adr/0008-locale-pack-verification.md`.
- **Content package:** new `localeLoader.ts`, `localeRules.ts` (6 rules: default pack present, helplines verified, compliance reviewed, pilot languages, gu compile, safe-regex), `localePacks.ts` (`loadLocalePacks`, `pickLocalePack`, `LocalePackError`, `DEFAULT_LOCALE_MARKET`), `safeRegex.ts`; `validate.ts` dispatches a locale-packs directory; `index.ts` exports; tests listed above; fixtures `test/fixtures/locales/valid/{global,XX}.yaml` (made up); `noFixtureProse.test.ts` now scans `content/locales` too.
- **Packs:** `content/locales/global.yaml` (default, no human input needed), `content/locales/IN.yaml` (pending values).
- **Harness (tests and test helpers only):** `src/testing/piiScrubCases.ts` (4.2's CASES moved out of `piiScrub.test.ts` unchanged, plus `piiScrubCaseFailures`); `src/testing/index.ts` exports; `src/guardrails/piiScrub.test.ts` imports the shared cases (assertions unchanged) and tests the runner; `src/testing/piiLocaleFixtures.ts` Aadhaar pattern rewritten without a backreference or nested quantifier; `src/pedagogy/compose.test.ts` adds the two new helpline fields to one literal.
- **CLI:** `apps/cli/src/commands/content.ts` usage text; `content.test.ts` two new cases.
- **Docs:** `.claude/skills/locale-context/SKILL.md` pack shape now matches the real camelCase schema and the new fields.

## Deviations from the plan

1. **Lookbehinds one character wide are allowed** (lead revision 2 said reject lookbehind). All four real IN patterns need a one-character lookbehind (`(?<!\d)` and so on), and the scrub redacts the whole match, so a consuming `(?:^|\D)` would also redact the character before the number and break 4.2's cases. The check refuses any lookbehind that is not exactly one unquantified character or class (`(?<=ab)`, `(?<!\d+)`, `(?<!a|b)`, groups inside). Flagged as a decision below.
2. **"Repeated" means a quantifier that allows more than one** (`*`, `+`, `{n,m}` with m > 1). `?` alone does not count, so the IN mobile pattern's `(?:\+?91[ \-]?|0)?` passes. One optional pass cannot backtrack exponentially. `(?:a?)+` and `(?:a{2}){3}` are still refused.
3. **The Aadhaar pattern changed** (in both `IN_PII_PATTERNS` and `IN.yaml`): no `\1` backreference (the three separator forms are spelled out) and no `{3}` around a group with `?` (the three year groups are spelled out). It matched identically to the old pattern on 200,011 strings (fixed edge cases plus random digit/space/dash strings), and every existing harness PII test still passes.
4. **Both packs say `languages: [en]`**, not `[en, hi]`, and a sixth rule (`localeLanguages`) enforces the English-only pilot (18 Oct 2026; crisis replies too, B-14). `locale.languages` has no reader today.
5. **One more rule, `complianceReviewed`**: it flags `pending` compliance text and a market pack without a non-pending `reviewedBy` (lead revision 3's sign-off).
6. **The plan's duplicate-market check is not needed**: file names must match `^([A-Z]{2}|global)\.yaml$` exactly, so `in.yaml` is an "unexpected entry" and two files can't claim one market. (On macOS `in.yaml` and `IN.yaml` are the same file; the tests account for that.)
7. **The plan's compose-layer check lives in `@edmate/content`, not `harness/compose.test.ts`**: the harness can't read `content/locales` (no fs). `realLocales.test.ts` uses the real pack, the real prompt packs and the real runner.
8. **The timing probe runs inputs from 32 to 8,192 characters, doubling, with a 100 ms total budget.** With only two lengths (256 and 8,192), a cubic pattern hung the check. Doubling stops it on the first slow length. The four IN patterns take about 1 ms in total.

## Follow-ups (not blocking)

- **Merge conflict to expect:** open branches `m4/4.3-distress` and `m4/4.4-moderation-jailbreak` add `packages/harness/src/testing/distressLocaleFixtures.ts` with a helpline literal that has no `verifiedBy` / `verifiedOn`. Whichever merges second must add those two fields (for example `verifiedBy: 'test pack'`, `verifiedOn: '2026-01-01'`) or typecheck fails.
- `evals/suites/safety/distress/generic/*` say "Re-verify when 3.10 lands": the default pack's wording is the frame's no-helplines line, unchanged, so they should still hold. Worth re-checking in 4.3.
- No composition root calls `loadLocalePacks` / `pickLocalePack` yet (`TurnConfigStoreOptions.locales` still gets fixtures); the first app that wires real packs should call `loadLocalePacks` once at start-up.
- An `en-US` pack waits for the M10 payments task (10.1), as the plan says.

## Decisions

### 19 Oct 2026 · 3.10 LocalePack gains sign-off fields and a parental-consent flag (ADR-0008) · risk: high
Decided: each helpline gets required `verifiedBy` (a name or handle, never an email, at most 200 characters) and `verifiedOn` (a calendar date). `compliance` gets a required `parentalConsentRequired` boolean. The pack gets an optional `reviewedBy` / `reviewedOn` pair for the compliance block. The literal `pending` is valid in the schema and refused by the content rules and the runtime loader. The build plan's Core contracts text and the spec-type tests are updated to match.
Why: the task asks for "human-verified helplines and compliance". Code could not tell a verified helpline from a guessed one, and the consent rule differs per market (US no, India yes for 13 to 17).
Alternatives: one pack-level sign-off only; a side file for verification; making the schema reject `pending` (the pack could not be committed honestly); hard-coding consent per country.
Reviewers: architect, security-reviewer, typescript-reviewer (contracts, ADR); safety-reviewer (helpline refusal, `content/locales/`, the `piiScrub.test.ts` extraction under `packages/harness/src/guardrails/`); security-reviewer also for the `.claude/skills/locale-context` doc.
Reversible: yes, with a new ADR; no stored data uses these fields yet.

### 19 Oct 2026 · 3.10 An unverified market pack is refused at runtime and the default pack serves its students · risk: high
Decided: `loadLocalePacks` leaves out any market pack with a `pending` or blank helpline number or a `pending` verifier, and `pickLocalePack` returns the default pack for that market (and for any unknown market). Loading fails outright with no default pack, with an unverified default pack, on a file that does not load, or on a non-`gu` or unsafe PII pattern. No bypass flag exists for development.
Why: lead revision 4: an unverified helpline must never reach a crisis reply. The default pack's no-helplines wording (local emergency services and a trusted person) is safe in any country, and the safety alert is raised either way.
Trade-off for the human: while IN is refused, India students also lose the India PII patterns (Aadhaar, PAN, UPI, Indian mobile). The guard's built-in phone, email, card, OTP and name checks still run. Nothing serves real students yet, so this is a design point, not a live gap. An alternative is to serve the market pack with its helplines emptied, which keeps the patterns and gives the same crisis wording. Recommendation: keep the strict refusal until the helpline is signed off, which ends the trade-off; switch only if a launch would come before sign-off.
Alternatives: serve the pack with its helplines emptied; refuse only at `edmate content validate` (rejected by the lead).
Reversible: yes.

### 19 Oct 2026 · 3.10 Safe-regex check: strict structure first, timing second; one-character lookbehinds allowed · risk: medium
Decided: a hand-written parser (no dependency) refuses a quantifier inside a group that repeats (`*`, `+`, `{n,m}` with m > 1), an alternation under a repeat whose branches don't each start with a distinct literal character, any backreference, and any lookbehind wider than one character. Clean patterns then run over adversarial inputs from 32 to 8,192 characters (100 ms total budget). The check runs at validate and load time, never per turn. The Aadhaar pattern is rewritten without its backreference and nested quantifier; it matched identically on 200,011 strings.
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
