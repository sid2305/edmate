# Task 4.2: `piiScrub` (generic + locale-pack patterns)

Board: `board.py show 4.2` · M4 · deps 3.1, 3.12, 4.0, 4.1 · branch `m4/4.2-pii-scrub` · planner: sonnet.

## Acceptance (verbatim, `docs/board/tasks.yaml`, updated by the lead 18 Oct 2026)

Title: "`piiScrub` (generic + locale-pack patterns)"
Accept: "100% on the seeded PII cases, and the model input the scripted gateway captures on every
tier contains none of the case's PII (multi-turn split numbers stay reply checks)."

### How it will be shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Guard behaviour | `piiScrub.test.ts`: for each PII category (phone incl. Devanagari digits, email, card, OTP-like, own name) and each locale pattern (Aadhaar-like, PAN, UPI id), a message containing it comes back `{ok:false, action:'rewrite', text, reason}` with the matched span replaced by a category placeholder; `reason` never contains the matched text (capped, generic, category names only); a message with none of these comes back `{ok:true}` unchanged. |
| No over-triggering | `piiPatterns.test.ts`: the three seeded near-miss cases (20-digit non-phone-shaped int, year+score pairs, test marks out of 45) and the two address cases come back byte-for-byte unchanged (nothing scrubbed) — proves the patterns are shaped, not "any number". |
| Card scope | `piiPatterns.test.ts`: a card number is redacted as its own span; a CVV/expiry that appears in the *same* message as a detected card number is also redacted; a bare 3-digit number or `MM/YY`-shaped date with **no** card number nearby is left alone (so `12/29` and `cvv` alone never over-trigger — ties to the near-miss cases above). |
| Wired into the pipeline | `scrub.test.ts`: `steps.scrub` calls the registered `piiScrub` guard through `runGuardChain` and returns a `Scrubbed` whose `text` is the rewritten text and whose `guards` is exactly `[{name:'piiScrub', ok, action?}]`; `runner.test.ts` (existing suite): `admit`→`entitle`→`scrub` still threads the scrubbed text into `preGuard`/`route`/`buildContext`/`generate` (no new `runner.ts` behaviour beyond the silent-failure item below). |
| **100% on the seeded PII cases** | New `packages/evals/src/piiScrubPipeline.test.ts`: loads all 35 cases from `evals/suites/safety/pii/` via 3.12's `loadCasesFromDir` (no second copy of the case text) and, for 34 of them (every case except `safety-pii-phone-split-spelled-hi-latin`, excluded per the accept line's parenthetical), drives every turn through the real `runTurn` pipeline (`@edmate/harness`'s `testSteps`/`testDeps`, real `scrub`, everything else the existing happy-path fakes) with a `ScriptedGateway` whose script entries capture every `ModelRequest` they see via their `match` predicate (an existing hook, not a new one). The test asserts, per case, that none of that case's known PII substrings (a short literal table in the test file, lifted from each case's own `must_not_contain` list) appears in **any** captured request's `system` or `messages` text, on **both** the small-tier call (a tiny test-only probe added to the fake `preGuard`/`route` step, calling `gateway.generateObject` with the scrubbed text) and the main-tier call (the existing fake `generate`, which already calls `gateway.stream`). 100% of the 34 pass; the 35th case keeps only its existing reply-level check (untouched). |
| Devanagari digits | Covered inside the same table: `safety-pii-deva-digits-phone-deva`, `-mobile-remember-deva`, `-aadhaar-store-deva` all assert the Devanagari-digit span (and its Latin-digit transliteration) is absent from the captured input, per the lead's 18 Oct 2026 decision. |
| Scrubbed before history | `scrub.test.ts` / `runner.test.ts`: the input the runner threads to every later step (and to `commit`'s `CommitRecord.input`) is the rewritten text, never the original — already true structurally (runner.ts's `safeInput`/`scrubbed` plumbing, 3.1), re-asserted for a PII case specifically. |
| Silent-failure reporting (4.1 review item) | `scrub.test.ts` + one new `runner.test.ts` case: when the chain fails closed for a reason that is *not* the guard's own verdict (piiScrub never returns `block`/`escalate`, so any `GuardChainResult.failure` here is a framework bug — a thrown error, a timeout, a schema-invalid result, or a cancellation), `steps.scrub` throws a plain `Error` whose `.cause` carries only `{ guardCause, errorName?, errorMessage? }` (never `reason`/text); `runner.ts` pushes that error onto `TurnRunResult.background` (`{task:'runner', error}`, the same seam `routeFallback` already uses) instead of dropping it; a property test feeds a guard that throws an `Error` containing a recognisable literal (a fake phone number) and asserts the background entry's serialised form never contains that literal. |
| Harness purity | `turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/evals...` green; no new dependency; `packages/harness/src/**` still imports only `@edmate/contracts`, `zod` and its own modules (the new pipeline-backed test lives in `packages/evals`, which already carries `@edmate/harness` as a devDependency — added in 3.12 for exactly this). |

## Design

### What exists already (read only)
- `packages/harness/src/guardrails/{guard,registry,chain,order}.ts` (4.1, in review PR #32): `Guard<Ctx>`, `GuardRegistry<Ctx>`, `runGuardChain`. `GUARD_ORDER.scrub = ['piiScrub']` — the only guard in the `scrub` phase, so a chain `outcome:'block'` in this phase is *always* `result.failure` (a framework fail-closed), never the guard's own decision (piiScrub's only failure action is `rewrite`, per the build plan's guard table — it never blocks or escalates).
- `packages/harness/src/pipeline/steps/preGuard.ts`: currently exports both `scrub` and `preGuard` stubs (`StepNotImplementedError`). 4.2 splits this: `scrub` moves to a new `steps/scrub.ts`; `preGuard.ts` keeps only its own stub (4.3/4.4's job), per `steps/index.ts`'s own comment ("each later task replaces its own file").
- `packages/harness/src/pipeline/runner.ts` (3.1, done): step 3a already threads `scrub`'s output into `this.safeInput`/the concurrent group (`scrubbed`) and into `CommitRecord.input`; a scrub failure already fails closed (`PRE_GUARD_FAILED`, retryable `guard_blocked`) — 4.2 does not change this behaviour, only adds the one background-reporting line for `sc.error` (see table above).
- `packages/contracts/src/locale.ts`: `LocalePack.piiPatterns: string[]`, each checked to `compile` as a `RegExp` at schema-parse time (no flags) and capped at `LIMITS.piiPatternMaxLength` (500 chars). **3.10 (the real loader/`content/locales/*.yaml`) is not built**, so in practice nothing populates this with real India patterns yet outside test fixtures (`packages/contracts/fixtures/valid/locale.ts`'s `demoLocalePack.piiPatterns` currently holds one generic 4-4-4 digit pattern, good enough for Aadhaar shape but not PAN/UPI).
- `packages/harness/src/testing/testSteps.ts` / `scriptedGateway.ts`: the happy-path step doubles and `ScriptedGateway` (whose `match?: (req) => boolean` predicate already receives the full `ModelRequest` — the exact hook this task reuses to capture requests, no change to `scriptedGateway.ts` needed).
- `packages/evals/src/{loader,schema,agent,runner}.ts` (3.12, done): `EvalCase`/`loadCasesFromDir` are the single source of truth for the 35 cases' text; `EvalAgent` is deliberately not wired to the real pipeline yet ("a later task adapts the real pipeline... to this interface") and `apps/cli`'s `unwiredAgent` always rejects. **4.2 does not wire `EvalAgent` or touch `apps/cli`** — see Open Q1.

### Scope call: what "100% on the seeded PII cases" means here (Open Q1)
The 35 cases' existing `must_not_contain`/`judge` checks are **reply**-level and currently cannot run at all (`unwiredAgent` rejects every call; `evals/fixtures/` is empty for every suite). Fully wiring a live `EvalAgent` and recording real agent+judge fixtures for 35 cases would need a real model/judge key (against rule 4) and depends on tasks not yet done (3.3 `route`, 3.7 orchestrator, 3.10 locale packs, 3.11 prompt packs — none done), so a pedagogically faithful live run isn't possible yet regardless of 4.2.
**Recommendation (what this plan builds):** read "100%" together with the accept line's second clause as one mechanism, not two: a dedicated, fully offline test (`packages/evals/src/piiScrubPipeline.test.ts`) that drives all 35 cases' *input* through the real `scrub` step and asserts PII absence from the captured model input, 34/35 cases at 100%, the 35th staying a reply check (untouched, already passing-or-not independent of 4.2). This proves the mechanism the guard table actually cares about (the model never sees the PII) without inventing a live-recording pipeline. The existing reply-level checks on these 35 cases stay exactly as `4.0` left them (unaffected, still blocked on `EvalAgent` wiring — a separate, later task). *If the lead instead wants 4.2 to also wire a live `EvalAgent` and record real reply/judge fixtures for these 35 cases, that is materially larger (new CLI wiring, `eval-author` content work, judge-model cost) and should be its own task/ADR-free follow-up, not folded into a guard task.*

### New module: `packages/harness/src/guardrails/piiPatterns.ts`
Pure functions, no `Guard`/contracts coupling (own test file, no fixtures needed):
- **Generic patterns** (locale-independent, per the build plan's guard table — phone, email, card, OTP-like, own name):
  - `phone`: optional `+<country code>`/leading `0`, then digit groups (ASCII `0-9` or Devanagari `०-९`, interchangeably within one match) totalling ~10 digits, optionally split by a single space/hyphen, word-bounded (so it does not match inside a longer digit run — covers the 20-digit near-miss case for free) and matches whether or not it's inside pasted code (`phone = "90000 44444"`) or spelled digits are **not** attempted (regex can't link words across turns — the one excluded case).
  - `email`: standard local-part `@` domain **with a dot in the domain** (distinguishes it from the UPI-id shape below, which has none).
  - `card`: a 13–19 digit run, optionally grouped in 4s with spaces/hyphens, as the anchor span. **Contextual only:** when a card number is found in a message, a `cvv \d{3,4}` and an `exp \d{1,2}/\d{2,4}` elsewhere in the *same* message are redacted too (as part of one "card data" rewrite); standalone 3-4 digit numbers or `MM/YY` dates with no card number nearby are left alone (keeps the near-miss/marks cases intact).
  - `otpLike`: a 4-8 digit number adjacent to an OTP keyword (`otp`, `one.time.code`, case-insensitive; English and Hinglish spellings), not a bare short number on its own (avoids catching marks/years).
  - `ownName`: introduction-phrase patterns in English ("i'm", "i am", "my name is", "this is"), Hinglish ("mera naam ... hai") and Devanagari ("मेरा नाम ... है"), each capturing 1-3 **Title-Case Latin-script** words immediately after the phrase (names in the seeded cases are always written in Latin script, even mid-Devanagari-sentence) — redacts only the captured name span, not the whole phrase. This is **self-disclosure detection in the text**, not a stored-profile lookup: `LearnerProfile`/`Entitled` carry no name field anywhere in `@edmate/contracts` today (checked — `memory.ts`, `access.ts`, `ports.ts`), and `scrub` runs before `buildContext` (which loads the profile) even if one existed. See Open Q2.
- **Locale-pack application**: `applyLocalePatterns(text, piiPatterns: string[])` compiles each source with `new RegExp(source, 'giu')` in a `try/catch` (a pattern that fails to recompile with those flags is skipped, not thrown — logged the same way as the chain-failure item, see below) and redacts every match with a generic `[redacted-id]` placeholder. `LocalePackSchema` already guarantees each source at least compiles without flags.
- A fixed match order (most specific/longest first: card-cluster → aadhaar-shaped locale patterns → phone → otpLike → PAN/UPI-shaped locale patterns → email → ownName) so overlapping shapes don't double-redact or mis-redact; one test table drives this ordering.
- Each category has its own placeholder (`[redacted-phone]`, `[redacted-email]`, `[redacted-card]`, `[redacted-otp]`, `[redacted-id]`, `[redacted-name]`) so the rest of the turn still reads sensibly (e.g. "save my number [redacted-phone] and text me a reminder" — lets a later guard/prompt still recognise "wants contact stored" without the real number).

### New guard: `packages/harness/src/guardrails/piiScrub.ts`
`createPiiScrubGuard(): Guard<{ locale: LocalePack }>` (own test file `piiScrub.test.ts`):
- Runs the generic patterns, then the locale-pack patterns, over the input text.
- No match → `{ result: { ok: true }, usage: [] }`.
- Any match → `{ result: { ok: false, action: 'rewrite', text: <rewritten>, reason: <fixed, generic, category-name-only string, e.g. "redacted: phone, email"> }, usage: [] }`. `reason` is built from a small closed set of category labels, never from the matched substring (tested: feed every category and assert `reason` never contains the input's literal matched text).
- Pure, no model call (regex-only, per the pipeline spec's "regex-only PII scrub, first").

### Wiring: `packages/harness/src/pipeline/steps/scrub.ts` (new; replaces the stub half of `preGuard.ts`)
```
const registry = new GuardRegistry<{ locale: LocalePack }>('scrub');
registry.register(createPiiScrubGuard());

export const scrub: Steps['scrub'] = async (env, s) => {
  const chain = await runGuardChain(registry.ordered(), env.input.text ?? '', { locale: s.locale }, {
    phase: 'scrub', clock: env.deps.clock, timeoutMs: <guard's own slice>, cancel: env.cancel,
  });
  if (chain.outcome === 'ok') {
    return { ...(env.input.text === undefined ? {} : { text: chain.text }), guards: chain.guards };
  }
  // outcome === 'block': piiScrub itself never blocks, so this is always chain.failure — a
  // framework bug, timeout, invalid result or cancellation, not a PII decision.
  const f = chain.failure;
  const inner = f?.error instanceof Error ? { name: f.error.name, message: f.error.message } : undefined;
  throw new Error(`piiScrub guard chain failed closed${f ? ` (${f.cause})` : ''}`, {
    cause: { guardCause: f?.cause, error: inner },
  });
};
```
- `steps/preGuard.ts` keeps only its own `preGuard` stub.
- `steps/index.ts`: `import { scrub } from './scrub.js'; import { preGuard } from './preGuard.js';`.

### Runner change: `packages/harness/src/pipeline/runner.ts` (2-line, non-breaking)
In the existing `if (!sc.ok || scrubbed === null)` branch, when `sc.error !== undefined`, additionally push `this.background.push({ task: 'runner', error: sc.error })` — the same pattern `routeFallback` already uses for its own-step failures. This is the "existing port (log seam)" the 4.1 silent-failure review asked for: `TurnRunResult.background` is already documented as "Failures that never reached the stream: background steps, trace, alert attempts, **bugs**." No new type, no contracts change, no behaviour change to the turn's outcome (still `guard_blocked`, retryable) — only makes a framework bug observable instead of silently dropped. New `runner.test.ts` case covers it (see table).

### Locale-pack patterns, for now (3.10 not built) — Open Q3
No production wiring exists yet to inject real `content/locales/*.yaml` patterns (3.10's job; `TurnConfigStore` is a port apps/web hasn't implemented, and nothing calls `runTurn` live yet). 4.2 ships:
- The India-market locale patterns (Aadhaar-like, PAN, UPI id) as regex source strings in a **test-only fixture**, `packages/harness/src/testing/piiLocaleFixtures.ts` (exported from `testing/index.ts`): `indiaLocalePackWithPii = { ...demoLocalePack, piiPatterns: [AADHAAR_SRC, PAN_SRC, UPI_SRC] }`. **No edit to `packages/contracts/**` at all** — `demoLocalePack` is spread, not mutated, so this stays entirely inside `packages/harness/src/testing/` and is reused by `packages/evals`'s new test (via the `@edmate/harness/testing` subpath).
- `piiScrub.test.ts` uses this fixture directly; the India-specific eval cases (Aadhaar/PAN/UPI) in `piiScrubPipeline.test.ts` use it as `Entitled.locale` for those turns.
- Logged as a decision: real `content/locales/IN.yaml` patterns and the loader stay 3.10's scope; 4.2's fixture is a stopgap, reversible, not a contracts change.

## Files

Create:
- `packages/harness/src/guardrails/piiPatterns.ts`, `piiPatterns.test.ts`
- `packages/harness/src/guardrails/piiScrub.ts`, `piiScrub.test.ts`
- `packages/harness/src/pipeline/steps/scrub.ts`, `scrub.test.ts`
- `packages/harness/src/testing/piiLocaleFixtures.ts`
- `packages/evals/src/piiScrubPipeline.test.ts`

Modify:
- `packages/harness/src/pipeline/steps/preGuard.ts` (drop the `scrub` stub, keep `preGuard`'s)
- `packages/harness/src/pipeline/steps/index.ts` (import split)
- `packages/harness/src/pipeline/runner.ts` (2-line background push, see above)
- `packages/harness/src/pipeline/runner.test.ts` (new case for the above)
- `packages/harness/src/guardrails/index.ts` (export `createPiiScrubGuard`, pattern helpers if useful to other guard tasks)
- `packages/harness/src/testing/index.ts` (export the new fixture)
- `packages/harness/README.md` (short note: scrub's `piiScrub` guard is wired; 4.3/4.4 do the same for `preGuard`)

Out of bounds:
- `packages/contracts/**` — no schema or fixture edit (see locale-pattern design above); no ADR.
- `content/locales/**`, the real `TurnConfigStore` implementation, `apps/web/**` — 3.10's and later apps work, not this task.
- `apps/cli/**`, `packages/evals/src/agent.ts`, `packages/evals/src/runner.ts`, `evals/fixtures/**` — no `EvalAgent`/CLI wiring, no recorded fixtures (see Open Q1).
- `evals/suites/safety/pii/**` (the 35 case files themselves) — read-only; 4.0a is in review on its own branch and this task must not touch it. The per-case literal PII-token table needed for the new test lives in the new test file in `packages/evals`, not in the YAML.
- `packages/harness/src/guardrails/{guard,registry,chain,order}.ts` — untouched; no change to `GuardOutcomeEvent`'s shape (the silent-failure fix uses the existing `background`/thrown-`Error.cause` path instead, see Design, so 4.1's frozen files stay frozen).
- Any `preGuard`/`route`/`decide`/`generate`/`postGuard` **production** behaviour — only test-only probes are added inside the new pipeline test, never in `packages/harness/src/pipeline/steps/*.ts` itself.

## Tests first (tdd-guide order)
1. `piiPatterns.test.ts`, red first: one table per category (match + redact), the near-miss/address no-op cases, the card/cvv/exp contextual rule, the Devanagari-digit phone cases, the ordering/overlap cases.
2. `piiScrub.test.ts`: guard-level `ok`/`rewrite` shape, `reason` never contains matched text, locale patterns applied via `ctx.locale.piiPatterns` using the new test fixture, a malformed locale pattern (fails to recompile with the guard's flags) is skipped not thrown.
3. `scrub.test.ts`: `Steps['scrub']` happy path (text rewritten, `guards` shape); the fail-closed/background-reporting path using a `fakeGuard` that throws/times out/returns an invalid result (reusing 4.1's `testing/guardFixtures.ts`).
4. `runner.test.ts` new case: scrub's chain failure reaches `finished.background` with cause + error name/message, never the raw text used in the test.
5. Build `piiPatterns.ts` → `piiScrub.ts` → `scrub.ts` → the `runner.ts` 2-liner to turn 1-4 green, in that order.
6. `packages/evals/src/piiScrubPipeline.test.ts`, last (needs `scrub.ts` done): load the 35 cases, drive 34 of them through `runTurn`, assert gateway-captured-input PII absence on both tiers; assert the 35th (`safety-pii-phone-split-spelled-hi-latin`) is excluded from this check.
7. Full gate: `turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/evals...`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `packages/harness/src/guardrails/**` (`piiPatterns.ts`, `piiScrub.ts`, `piiScrub.test.ts`, `piiPatterns.test.ts`, `index.ts`) → **reviewers: safety-reviewer** (student safety group).
- No other risk-paths.txt glob is touched:
  - `packages/contracts/**` — none (deliberately, see Design/Open Q3).
  - `packages/harness/src/pedagogy/**`, `packages/harness/src/access/**` — none.
  - `content/locales/**`, `content/prompt-packs/**`, `content/skills/**` — none.
  - `evals/suites/safety/**` — none (the 35 case files are read-only, not edited).
  - `.claude/**`, `.github/**`, `.githooks/**` — none.
  - `packages/harness/src/pipeline/steps/scrub.ts`, `runner.ts`, `testing/**`, `packages/evals/**` are **not** listed risky-path globs, but given the task's safety subject matter, recommend (not required) the safety-reviewer also look at `scrub.ts` and the new `piiScrubPipeline.test.ts` while they're reviewing `guardrails/**` anyway.
- `docs/decisions/log.md` gets a `risk: high` entry at merge (new guard logic in a risk-paths.txt safety group, after its required reviewer), per rule 6.
- Recommended reviewers for the PR: **safety-reviewer** (required), plus **typescript-reviewer** and **silent-failure-hunter** (the fail-closed/background-reporting item is exactly their concern) — not required by risk-paths.txt but matches 4.1's own precedent.

## Open questions (recommendations)

- **Q1 Scope of "100% on the seeded PII cases."** No `EvalAgent` is wired to the real pipeline yet (3.9/3.7/3.10/3.11 all pending), and `evals/fixtures/` is empty for every suite — the 35 cases' existing reply-level checks cannot run live or in replay today regardless of 4.2. *Recommend:* 4.2 proves the mechanism (scrub removes PII from the model input) via a dedicated offline pipeline test over all 35 cases' inputs (described above), and leaves live `EvalAgent` wiring + recorded reply/judge fixtures to a later task. If the lead wants 4.2 to also wire a live agent and record real fixtures for these 35 cases, that's materially bigger (CLI wiring + `eval-author` content + judge-model cost) and should be its own task.
- **Q2 "The student's own name" has no stored source anywhere in `@edmate/contracts`** (`LearnerProfile`, `Entitled`, `TurnInput` all checked — no name field), and `scrub` runs before `buildContext` loads the profile even where one existed. *Recommend:* detect self-disclosure in the text itself (introduction-phrase + Title-Case heuristic, English/Hinglish/Devanagari-sentence-with-Latin-name), which is also exactly what the seeded cases exercise (the eval adapter's "profile name" is scenario colour, not a system lookup). Residual risk: narrow phrase list may miss other introduction styles, or (rarely) a Title-Case word after one of these phrases that isn't a name (e.g. "I'm Ready") could be redacted unnecessarily — acceptable for a first cut; widen the phrase list from `eval-author` feedback later, not blocking.
- **Q3 Locale-pack PII patterns, before 3.10 lands.** *Recommend:* a test-only fixture (`testing/piiLocaleFixtures.ts`) spreading `demoLocalePack` with Aadhaar/PAN/UPI regex strings, zero `packages/contracts/**` edits. 3.10 later supplies the real `content/locales/IN.yaml` values and the loader; `piiScrub`'s guard code already reads whatever `ctx.locale.piiPatterns` it's given, so no guard-code change will be needed when 3.10 lands.
- **Q4 Card scope.** The card eval case's reply-level `must_not_contain` also lists `cvv 123` and `12/29`. *Recommend:* redact CVV/expiry only when they co-occur with a detected card number in the same message (contextual), never as standalone patterns — matches the near-miss cases' intent (don't treat ordinary small numbers/dates as PII) while still satisfying that one case.

## Decisions to log on merge
- `risk: high`: new `piiScrub` guard logic in `packages/harness/src/guardrails/**` (risk-paths.txt safety group), reviewed by safety-reviewer, merged by the lead.
- Q1-Q4 above, once the lead confirms (Q1 has the biggest scope consequence; Q2-Q4 are reversible implementation calls).
- The silent-failure fix (background-reporting for a scrub chain failure) and its "no contracts/`GuardOutcomeEvent` change" design choice.
- The decision that locale-pack PII patterns are a harness-testing-only fixture until 3.10 lands.

## Lead answers (18 Oct 2026)

- Q1: agreed. 4.2 proves the mechanism offline: all 35 case inputs (minus the split-across-turns case) go through the real `scrub` step, with the scripted gateway capturing the input on both tiers. Live EvalAgent wiring and recorded fixtures are a later task.
- Q2: agreed for now, detecting self-disclosure in the text. Once a student display name is stored (identity, 1.x), add it as an exact-match pattern; note that follow-up in the handoff. Keep the phrase list conservative, and add near-miss tests ("I'm Ready", "I'm Done").
- Q3: agreed: a test-only locale fixture, no contracts edits. 3.10 supplies the real patterns.
- Q4: agreed: CVV and expiry are redacted only next to a detected card number.
- Build on 4.1 after it merges (it is in its fix round: `failure.error` becomes `errorName`, a new `failed` outcome, and a second verification pass after a rewrite). Report the failure cause through `TurnRunResult.background`, ids and error name only.
- Reviewers: safety-reviewer (opus), typescript-reviewer (sonnet), silent-failure-hunter (sonnet). risk: high entry.
