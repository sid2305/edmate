# ADR-0008: Locale pack sign-off fields (helpline verification, compliance review, parental consent)

## Status

Accepted

## Date

2026-10-19

## Context

Task 3.10 ships the first real locale packs: a default pack (`global`) and the India pack (`IN`). Its acceptance line asks for "the first pack for the pilot market with human-verified helplines and compliance". The `LocalePack` contract (build plan § Core contracts; `packages/contracts/src/locale.ts`) had no place to record that a person checked a helpline or the compliance block, so nothing in code could tell a verified helpline from a guessed one.

That matters most for a crisis reply. A student in distress is shown the pack's helplines (task 4.3; `compose.ts` lists them in the locale section). A wrong or stale number there is worse than none: with no helplines, the frame prompt pack tells the student to contact local emergency services and someone they trust. The lead decided (task plan, Lead revisions 3 and 4, 19 Oct 2026) that an unverified helpline must never reach a crisis reply and that one pack-level sign-off covers the compliance block. On the build review (19 Oct 2026, risk: high) the lead chose to drop only the unverified helplines rather than the whole pack: refusing the India pack would also drop its Aadhaar, PAN, UPI and Indian-mobile PII patterns, a privacy regression.

Consent is per market too. The human decided on 18 Oct 2026 that learners are 13+, that the US needs no parental consent for 13 to 17 and India does (DPDP). The age gate (task 1.7) and the DPDP gate (6.0b) need that fact from the pack, not hard-coded per country in code (locale-context rule 1).

## Decision

Three additions to `LocalePackSchema` and the build plan's `LocalePack` (the type tests and the spec-drift test pin the shape):

```ts
interface LocalePack {
  // ...market, languages, timezone, currency, payments as before...
  helplines: { name: string; number: string; kind: string; verifiedBy: string; verifiedOn: string }[];
  compliance: { privacyLaw: string; minAge: number; dataRegion: string; grievance: string; parentalConsentRequired: boolean };
  reviewedBy?: string; reviewedOn?: string;
  // ...regulatedDisclaimers, piiPatterns as before...
}
```

1. **Per helpline, `verifiedBy` and `verifiedOn` are required.** `verifiedBy` is a person's name or handle: not blank, at most 200 characters (`LIMITS.signerMaxLength`), never an email address (the repo is public). `verifiedOn` is a calendar date, `YYYY-MM-DD`. The literal `pending` is a valid schema value, so a pack can be committed before a person checks it.
2. **`compliance.parentalConsentRequired` is a required boolean:** learners under 18 need verifiable parental consent in this market.
3. **`reviewedBy` / `reviewedOn` are an optional pair at the top level** (both or neither, same formats as above): the sign-off for the compliance block as a whole.
4. **`pending` is refused by rules, not by the schema.** `@edmate/content`'s locale rules (run by `edmate content validate <dir>`) report every `pending` helpline number or verifier, every `pending` compliance text, and a market pack without a non-`pending` `reviewedBy`, so the human sign-off stays visible.
5. **At runtime an unverified helpline is removed, not the pack.** `loadLocalePacks` serves each pack with every helpline whose number is blank or `pending`, or whose `verifiedBy` is `pending`, taken out, and reports each removed helpline once (market, helpline name and reason codes only; never the number). A pack left with no helplines gets the frame prompt pack's country-neutral no-helplines line (local emergency services, someone you trust); its PII patterns and other fields are used. `pickLocalePack` removes unverified helplines again as defence in depth.
6. **A pack that fails the schema or its PII-pattern checks is refused whole** (the patterns must compile with exactly `gu` and pass the safe-regex check); its market gets the default pack. Loading throws when the default pack is missing or refused.
   - **Fix round 1 (20 Oct 2026, security review of PR #57, risk: high).** The safe-regex structural check originally flagged an ambiguous alternation only when it sat directly under an explicit repeating quantifier (`(a|aa)+`); a pack author (or an attacker who can propose a pack) could spell the same ambiguity out longhand, `(a|aa)(a|aa)…`, 25 times adjacent, and it passed the check yet took seconds on a ~40-character input when the compiled pattern later ran. The structural check now also refuses two or more adjacent, unquantified copies of the same alternation group, or of groups whose branches overlap each other, matching the quantified case's ambiguity exactly without being weaker for being spelled out longhand. The timing probe's adversarial inputs are also built from every distinct literal character and class/escape sample the pattern itself actually uses (`\d`→`1`, `[a-z]`→`a`, `\s`→`' '`, and so on), not only a fixed generic alphabet, so an ambiguity on a character outside that alphabet is still caught. Finally, because a pattern class neither check anticipates could still hang the process, `edmate content validate` and start-up `loadLocalePacks` now run the whole check (structure, then timing) inside a `node:worker_threads` worker with a roughly 2-second hard wall-clock ceiling; a pattern that does not answer in time is terminated and reported unsafe, never run longer on the process that is validating or starting up. This ceiling applies only on that load/validate path -- the per-turn PII scrub runs the already-vetted compiled pattern directly, with no check and no ceiling. All four real IN patterns (and the global pack, which ships no `piiPatterns`) still pass every check.
7. **Pending compliance fields do not block runtime use.** `grievance` and `reviewedBy` feed the published privacy notice, which is not built yet; validation still reports them.

## Alternatives

- **One pack-level sign-off only, no per-helpline fields.** Not chosen: a helpline number changes on its own schedule, and a single pack date would hide a stale number behind a fresh legal review.
- **Keep verification in a side file next to the pack.** Not chosen: the loader must fail closed from one source of truth; two files can drift apart.
- **Make the schema itself reject `pending`.** Not chosen: the India pack could not be committed until every human input arrived, and the agent team would have to invent placeholder names or dates to get past the schema, which is worse than an honest `pending`.
- **Required `reviewedBy` / `reviewedOn` on every pack.** Not chosen: the default pack states nothing market-specific to review; the rule requires the sign-off on market packs only.
- **Hard-code which markets need parental consent.** Not chosen: locale-context rule 1 (no country facts in code).
- **Refuse the whole market pack while any helpline is unverified** (the first build of task 3.10). Not chosen: the market's students would lose its PII patterns until sign-off; removing only the unverified helplines gives the same crisis wording without that loss.

## Consequences

- Every `LocalePack` producer must add the two helpline fields and the consent flag. Today that is the contracts fixtures, `@edmate/harness`'s test packs and `content/locales/*.yaml`; no database table or app builds a pack yet. Open branches that add a `LocalePack` literal with helplines (for example 4.3/4.4's `distressLocaleFixtures.ts`) must add the fields when they merge.
- A market launches only after a person fills in each helpline's number and `verifiedBy` / `verifiedOn`, the grievance contact and the pack's `reviewedBy` / `reviewedOn`; until then `edmate content validate content/locales` fails. Before that, the runtime serves the market's pack without its unverified helplines, so a distress reply gives the country-neutral line and the market's PII patterns still apply.
- The published privacy notice (not built yet) must read `grievance` and the compliance sign-off, and must not publish a `pending` value.
- Nothing here records a source URL per helpline; the reviewer keeps that in the handoff or review record. Adding it to the schema later needs a new ADR.
- Changing these fields (dropping the sign-off, or making `pending` valid at runtime) needs a new ADR that supersedes this one.

## Reviewers

architect, security-reviewer, typescript-reviewer (task 3.10 PR), plus safety-reviewer for the helpline removal and the packs in `content/locales/`. Shape chosen by the team lead in the task plan's Lead revisions and the build review, 19 Oct 2026. The fix round 1 safe-regex addendum (20 Oct 2026) was raised by security-reviewer on PR #57 and reviewed by architect and typescript-reviewer; risk: high.
