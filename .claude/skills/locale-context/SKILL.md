---
name: locale-context
description: Edmate is country-neutral. Everything that depends on a country lives in a locale pack, never in code or prompts. That covers language and script, currency and number formats, distress helplines, regulated-subject disclaimers, privacy and age rules, payment methods, and grievance contacts. Use when writing prompt packs, guards (distress, PII, advice), pricing and payments code, eval cases in other languages, or adding a launch market.
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
```yaml
market: IN                      # ISO 3166 country code
languages: [en, hi]             # BCP 47 primary tags the UI and agent support here
scripts: { hi: [Deva, Latn] }   # Hindi in Devanagari or romanised
currency: { code: INR, format: "en-IN" }      # Intl.NumberFormat locale
payments: { methods: [upi_autopay, card], provider: <decided per market> }
helplines:                      # verified by a human, with source URL and date
  - { name: Tele-MANAS, number: "14416", kind: mental_health, source: <url>, verified: <date> }
compliance:
  privacy_law: DPDP Act 2023 + Rules 2025
  min_age: 18                   # MVP decision; minors need verifiable parental consent here
  data_region: <Indian cloud region>
  grievance: IT Rules 2021 grievance officer
  tax: GST on subscriptions; payout tax to confirm with a chartered accountant
regulated_subjects:
  investing: "Educational only; not investment advice."
pii_patterns: [phone_in, aadhaar_like, pan, upi_id]
```

## The first pack: India (if the pilot launches there)
- **Currency:** ₹ with Indian digit grouping (₹1,25,000), via `Intl.NumberFormat('en-IN')`.
- **Language:** English plus Hindi; students often mix them (Hinglish) or write Hindi in Latin script. Mirror the student.
- **Payments:** UPI AutoPay mandates and cards.
- **Helpline:** Tele-MANAS 14416 (already cited in the PRD). Verify the number and source before launch.
- **Law:** DPDP Act 2023 and Rules 2025; IT Rules 2021 grievance officer.
- **PII patterns:** Indian mobile numbers, Aadhaar-like 12-digit numbers, PAN, UPI IDs.

A pack's helplines, legal lines and tax lines must be checked by a human before that market launches. Agents may draft a pack, but `reviewed_by` stays `pending` until a person signs off.
