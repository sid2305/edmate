# ADR-0008: Locale pack sign-off fields (helpline verification, compliance review, parental consent)

## Status

Accepted

## Date

2026-10-19

## Context

Task 3.10 ships the first real locale packs: a default pack (`global`) and the India pack (`IN`). Its acceptance line asks for "the first pack for the pilot market with human-verified helplines and compliance". The `LocalePack` contract (build plan § Core contracts; `packages/contracts/src/locale.ts`) had no place to record that a person checked a helpline or the compliance block, so nothing in code could tell a verified helpline from a guessed one.

That matters most for a crisis reply. A student in distress is shown the pack's helplines (task 4.3; `compose.ts` lists them in the locale section). A wrong or stale number there is worse than none: with no helplines, the frame prompt pack tells the student to contact local emergency services and someone they trust. The lead decided (task plan, Lead revisions 3 and 4, 19 Oct 2026) that the runtime must refuse a pack with any unverified helpline, and that one pack-level sign-off covers the compliance block.

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
4. **`pending` is refused by rules, not by the schema.** `@edmate/content`'s locale rules (run by `edmate content validate <dir>`) report every `pending` helpline number or verifier, every `pending` compliance text, and a market pack without a non-`pending` `reviewedBy`. At runtime, `loadLocalePacks` refuses (never serves) a market pack with any unverified helpline, and `pickLocalePack` falls back to the default pack for it, so a `pending` helpline can never reach a student. The default pack must exist and must itself have no unverified helpline, or loading fails.

## Alternatives

- **One pack-level sign-off only, no per-helpline fields.** Not chosen: a helpline number changes on its own schedule, and a single pack date would hide a stale number behind a fresh legal review.
- **Keep verification in a side file next to the pack.** Not chosen: the loader must fail closed from one source of truth; two files can drift apart.
- **Make the schema itself reject `pending`.** Not chosen: the India pack could not be committed until every human input arrived, and the agent team would have to invent placeholder names or dates to get past the schema, which is worse than an honest `pending`.
- **Required `reviewedBy` / `reviewedOn` on every pack.** Not chosen: the default pack states nothing market-specific to review; the rule requires the sign-off on market packs only.
- **Hard-code which markets need parental consent.** Not chosen: locale-context rule 1 (no country facts in code).

## Consequences

- Every `LocalePack` producer must add the two helpline fields and the consent flag. Today that is the contracts fixtures, `@edmate/harness`'s test packs and `content/locales/*.yaml`; no database table or app builds a pack yet. Open branches that add a `LocalePack` literal with helplines (for example 4.3/4.4's `distressLocaleFixtures.ts`) must add the fields when they merge.
- A market launches only after a person fills in each helpline's number and `verifiedBy` / `verifiedOn`, the grievance contact and the pack's `reviewedBy` / `reviewedOn`; until then `edmate content validate content/locales` fails and the runtime serves that market the default pack.
- While a market pack is refused, its students also get the default pack's other fields (currency, disclaimers, and no market PII patterns; the guard's built-in phone, email, card, OTP and name checks still run).
- Nothing here records a source URL per helpline; the reviewer keeps that in the handoff or review record. Adding it to the schema later needs a new ADR.
- Changing these fields (dropping the sign-off, or making `pending` valid at runtime) needs a new ADR that supersedes this one.

## Reviewers

architect, security-reviewer, typescript-reviewer (task 3.10 PR), plus safety-reviewer for the helpline refusal and the packs in `content/locales/`. Shape chosen by the team lead in the task plan's Lead revisions, 19 Oct 2026.
