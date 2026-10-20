---
name: locale-context
description: Edmate is country-neutral. Everything that depends on a country lives in a locale pack, never in code or prompts. That covers language and script, currency and number formats, distress helplines, regulated-subject disclaimers, privacy and age rules, payment methods, and grievance contacts. Use when writing prompt packs, guards (distress, PII, advice), pricing and payments code, eval cases (English only during the pilot), or adding a launch market.
---

# Locale context

Edmate is not built for one country. A **locale pack** carries every country-specific fact, and the platform reads it at runtime. A pilot launches in one market, and adding a market means adding a pack, not changing code.

## Rules for code and prompts
1. **Never hard-code** a currency symbol, number grouping, helpline, law, tax or payment method. Read it from the active locale pack.
2. **Money is `{ amountMinor, currency }`** (ISO 4217), formatted by the pack. Model costs are tracked in USD micro-units, because providers bill in USD.
3. **Language mirrors the student.** The agent replies in the student's language and script, e.g. romanised Hindi when the student writes it, within the teacher's allowed languages.
4. **Helplines come from the pack** of the student's country. If none is verified for that country, tell the student to contact local emergency services and a trusted person, and still raise the safety alert.
5. **Compliance is per market:** privacy law, minimum age and consent, data region, grievance contact, and tax all come from the pack's `compliance` block, and launch checklists are per pack.
6. **Examples come from the teacher's material,** which is already in their context. Don't add country examples the teacher didn't use.

## Pack shape (`content/locales/<market>.yaml`)
The schema is `LocalePackSchema` in `packages/contracts/src/locale.ts` (camelCase; ADR-0008 added the sign-off fields). `edmate content validate content/locales` checks every pack; `global.yaml` is the required default pack.
```yaml
market: IN                      # ISO 3166-1 alpha-2 code, or `global` for the default pack
languages: [en]                 # BCP 47 primary tags; English only during the pilot
timezone: Asia/Kolkata
currency: { code: INR, format: "₹#,##,##0.00" }
payments: { methods: [], provider: tbd }      # decided per market with payments (task 10.1)
helplines:                      # each checked by a person; `pending` until then
  - name: <helpline name>
    number: <verified number>   # never filled in by an agent
    kind: mental_health
    verifiedBy: <name or handle, never an email>
    verifiedOn: "YYYY-MM-DD"
compliance:
  privacyLaw: <law and rules>
  minAge: 13
  dataRegion: <where data is hosted>
  grievance: <grievance officer contact>      # `pending` until a person supplies it
  parentalConsentRequired: true               # learners under 18 need verifiable parental consent here
reviewedBy: <name or handle>    # sign-off for the compliance block; `pending` until a person checks it
reviewedOn: "YYYY-MM-DD"
regulatedDisclaimers:
  investing: "Educational only; not investment advice."
piiPatterns: ['<regex>']        # compiled with exactly the flags gu; no backreferences, no
                                # quantifier inside a repeated group, lookbehinds one character wide
```
At runtime (`loadLocalePacks` / `pickLocalePack`) an unverified helpline is never served: the pack is used without it, so a pack left with none gets the reply that points to local emergency services and a trusted person, while its PII patterns and other fields still apply. A pack that fails the schema or the PII-pattern checks is refused whole and its market gets the default pack. The safety alert is raised either way. `edmate content validate` still fails on every `pending` value.

## The first pack: India (if the pilot launches there)
- **Currency:** ₹ with Indian digit grouping (₹1,25,000), via `Intl.NumberFormat('en-IN')`.
- **Language:** English plus Hindi; students often mix them (Hinglish) or write Hindi in Latin script. Mirror the student.
- **Payments:** UPI AutoPay mandates and cards.
- **Helpline:** Tele-MANAS 14416 (already cited in the PRD). Verify the number and source before launch.
- **Law:** DPDP Act 2023 and Rules 2025; IT Rules 2021 grievance officer.
- **PII patterns:** Indian mobile numbers, Aadhaar-like 12-digit numbers, PAN, UPI IDs.

During the pilot (18 Oct 2026), only English teaching and prompt-pack content are new. Safety eval cases may use Hindi/Hinglish input.

A pack's helplines, legal lines and tax lines must be checked by a human before that market launches. Agents may draft a pack, but each helpline's `verifiedBy` and the pack's `reviewedBy` stay `pending` until a person signs off.
