# 1.7 plan: age and consent per locale pack

Status: **READY for Phases A–C** (they run on the recommended answers to Q3 and Q4; each is a
small change if the human picks the other option). **Phase D is BLOCKED on Q1.** Q2 must be
answered before launch but blocks no build.
Planner: planner (opus) · 20 Oct 2026 · Board decision `min-age` (18 Oct 2026): learners 13+; US
needs no parental consent; India 13–17 need verifiable parental consent (DPDP); the age gate asks
for country and birth year.

## Acceptance (verbatim) and how each part is shown

> An under-13 cannot create an account; a 13-17 learner in a market that requires consent cannot
> use the agent until a parent consents; consent versions stored.

| Part | Shown by |
|---|---|
| Under-13 cannot create an account | A: `identity.int.test.ts`: `recordAgeAnswer` with an under-13 year deletes the user row, its `auth_accounts`, `auth_sessions` and `auth_verification_tokens` rows in one transaction and stores no birth year; a second answer for an already-confirmed user is `invalid`. C: `age-flow.test.ts` (Auth.js handlers, mocked Google, memory identity): sign in, every student route is 403 before the answer; under-13 answer, session cookie cleared, block cookie set, the next request is 401, and a retry from that browser within 24 h is refused. |
| 13–17 in a consent market can't use the agent until a parent consents | A: `entitlement-store.int.test.ts`: a `subscription` resolve returns `null` when `learnerClear` is false, so the harness's existing `entitle` step throws `no_access` (shown through the existing runner in `turn-config.int.test.ts` style, scripted gateway, no harness change); `teacher_preview` and `eval` ignore it. `age.test.ts` matrix: IN 13–17 → `parent_needed`; US (signed pack) → `clear`; US (unsigned pack) → `parent_needed`; `global` → `parent_needed`; 18+ → `clear`. C: guard test: `parent_needed` gets 403 on `POST /api/sessions/**` and `POST /api/subscriptions`, 200 on other student routes. D: after the parent consents, the same learner is `clear` and the same calls succeed; after withdrawal, blocked again. |
| Consent versions stored | A: `consents` row `kind=privacy_notice, version=<notice version>, granted_by=self` written with the age answer. D: `kind=parental, version=<notice version>, granted_by=parent`, `withdrawn_at` on withdrawal. Int tests read them back. |

## Design (the decisions this plan makes; logged in each phase's handoff)

1. **Data kept: birth year and country, nothing more.** New `users.birth_year smallint` (nullable,
   CHECK 1900–2100). The country answer sets the existing `users.market`. Choices: the markets with
   a pack (`IN`, `US`) plus "Somewhere else" → `global`. The full country list isn't needed. No
   full date of birth, no IP or header guessing (1.3 rule). `users.age_confirmed_at` (exists) is
   set when the gate is passed. The answer is given once; a later change goes through staff (12.1).
2. **Age from a birth year** (Q3): the youngest possible age, `currentYearUTC − birthYear − 1`.
   13+ and 18+ are both tested on it. A pure function `ageStatus()` in
   `packages/db/src/identity/age.ts` returns `age_needed | parent_needed | clear` (or `under_age`
   at the gate).
3. **Per-market rule comes from the pack, fails closed.** `agePolicyFor(pack)` (Phase B, in
   `packages/content`) gives `{ minAge: max(pack.compliance.minAge, 13), consentRequired }`.
   `consentRequired` is `true` unless the pack says `false` **and** its compliance block is signed
   (`reviewedBy` set and not `pending`). An unsigned pack can't relax consent. "Learners under 18"
   is the meaning ADR-0008 gives `parentalConsentRequired`, so the 18 is a named constant citing
   ADR-0008, not a law hard-coded. The identity store takes the rule as an injected
   `agePolicy(market)`, defaulting to `{ minAge: 13, consentRequired: true }`.
4. **US pack:** `content/locales/US.yaml` is drafted with `minAge: 13`,
   `parentalConsentRequired: false`, `reviewedBy: pending`, no helplines, and
   `dataRegion`/`grievance` `pending`. So until a named human signs it, US 13–17 also need consent
   (rule 3), and `content validate` fails on it, as it does for IN today.
5. **Account order** (Q4): sign-in still creates the user row (1.3/1.4 unchanged), and it is locked
   until the age answer. Every student route except the gate and sign-out is 403. An under-13
   answer erases the row and its sign-in rows at once. An httpOnly, non-identifying cookie blocks
   another attempt from that browser for 24 h. The age screen is neutral: the year isn't
   pre-filled, and nothing hints at the cut-off.
6. **Agent-use block without touching the harness.** `EntitlementStoreOptions` (in
   `packages/db/src/repositories/ports.ts`, not contracts) gains a **required**
   `learnerClear(studentId): Promise<boolean>`, called fresh on every `subscription` resolve. If it
   is false, resolve returns `null`, and the existing `entitle` step answers `no_access`. Because
   the option is required, a composition root (M9) can't forget it. Apps/web's guard is the first
   line, and this is the second.
7. **Route clearance in the web guard.** `ROUTE_POLICY` rows for students get a `clearance`:
   `none` (the age gate), `age` (default), or `agent` (`/api/sessions`, `/api/sessions/**` and
   `POST /api/subscriptions`). Blocking subscribing too for `parent_needed` is a planner choice: a
   minor's purchase needs the parent as well. Error bodies keep `{code,message,retryable}` with the
   existing `forbidden` code, so `ErrorCode` doesn't change. The gate applies to role `student`
   only; teacher age checks come with teacher vetting.
8. **Privacy notice:** versioned files, one per market, at
   `content/legal/privacy-notice/<market>.md`. Front matter: `version`, `market`, `reviewedBy`,
   `reviewedOn`. The builder ships **placeholders only** (version `draft-0`; the body says it is a
   placeholder and not legal text). `content validate` fails while `reviewedBy` is `pending`. The
   accepted version is stored in `consents`. Its schema lives in `packages/content`, not contracts.
9. **No ADR needed.** No change to `packages/contracts` or the tech stack: `LocalePackSchema`
   already has `minAge` and `parentalConsentRequired`, and `ErrorCode` is reused. If the human
   later wants a per-market consent age (e.g. EU 16), that is a contracts change and needs an ADR.

## Phase A: database rules (packages/db). Builder: opus. About 90 tool calls.
Tests first:
- `test/age.test.ts` (unit): the `ageStatus` matrix (years at the 13 and 18 edges with a fixed
  clock; signed/unsigned policy; live vs withdrawn parental consent; missing birth year).
- `test/identity.int.test.ts`:
  - `recordAgeAnswer`: ok, under-age erase, confirmed-twice `invalid`, bad year/market `invalid`;
  - `learnerStatus`;
  - the `consents` row with its version.
- `test/entitlement-store.int.test.ts`: `learnerClear` false → `null` for `subscription` only.
  Update the other callers' `opts` in `seed.int`, `turn-config.int`, `access-property.int` and
  `session-package.int`.
- The migration test: additive only.

Files:
- `migrations/0014_age_consent.sql` + meta (renumber if main moves). Adds `users.birth_year`, plus
  `consents.granted_by text not null default 'self'` (check `self|parent`) and
  `consents.withdrawn_at tstz`. Additive only.
- `src/schema/users.ts`
- `src/identity/age.ts` (new): `ageStatus`, `CONSENT_AGE = 18` (ADR-0008), `PLATFORM_MIN_AGE = 13`.
- `src/identity/store.ts`: `recordAgeAnswer({ userId, market, birthYear, noticeVersion })` →
  `{ status }`, `learnerStatus(userId)`, and the `agePolicy` option.
- `src/identity/index.ts`
- `src/identity/README.md`: rule 4 updated; rule 10 adds the under-age erase; new rule 12 covers
  age data.
- `src/repositories/ports.ts`: `learnerClear`.
- `src/seed.ts`: demo users get a fictional adult `birthYear` (e.g. 1990). No real data.
- `apps/web/test/memory-identity.ts`: the fake gains the two methods (test-only, as in 1.4).

State after A: rules and storage exist and agent use is blocked through the entitlement store. No
UI yet. All existing tests are green.

## Phase B: packs and privacy notice (packages/content, content/). Builder: sonnet. About 60 tool calls.
Tests first:
- `agePolicy.test.ts`: signed/unsigned/false/true, and the minAge floor.
- `privacyNotices.test.ts`: front-matter schema, one notice per pack market, and `pending` fails
  validation.
- Update `realLocales.test.ts` for US.yaml.

Files:
- `packages/content/src/agePolicy.ts`
- `packages/content/src/privacyNotices.ts`
- `packages/content/src/validate.ts`
- `packages/content/src/index.ts`
- `content/locales/US.yaml` (draft)
- `content/legal/privacy-notice/{global,IN,US}.md` (placeholders)
- `.claude/skills/merge-gate/risk-paths.txt`: add `content/legal/**` to the code-reviewer group.

State after B: `agePolicyFor` and the notice loader are available. `content validate` fails on
the US pack and the notices until a human signs them (as intended).

## Phase C: web age gate (apps/web). Builder: opus. About 100 tool calls. Needs A and B.
Tests first:
- `guard.test.ts`: the clearance × status matrix.
- `route-coverage.test.ts`: still passes.
- `age-flow.test.ts`: the end-to-end gate with mocked Google, memory identity and a fixed clock.
- The block cookie, and zod refusing extra fields.

Files:
- `src/auth/policy.ts`: `clearance`.
- `src/auth/guard.ts`: `resolvePrincipal` returns the status; `withRole`/`requireRole` enforce
  it; `requireRole` redirects to `/welcome/age`.
- `src/auth/config.ts` / `index.ts`: wire the identity store's `agePolicy` from
  `loadLocalePacks` + `agePolicyFor`.
- `src/auth/age.ts` (new): `submitAgeAnswer` (parse, call the store, cookies).
- `app/welcome/age/page.tsx` + `actions.ts`: country, birth year, the notice text and its version.

State after C: the gate works for real sign-ins. IN 13–17 learners are blocked from agent use
with no way to unblock (by design, until D).

## Phase D: parental consent. BLOCKED on Q1. Builder: opus. About 100 tool calls.
On Q1's recommended answer:
- `parent_consent_requests` table: learner id, `sha256(token)`, expiry 7 days, single use by
  atomic delete (1.4 pattern). No parent email is stored past sending.
- A mail to the parent through 1.4's `MailSender`.
- A public page where the parent reads the notice, declares they are the parent and an adult, and
  consents. This writes `consents(kind=parental, granted_by=parent, version)`.
- A withdraw link in the confirmation mail sets `withdrawn_at`.
- The logic lives in `apps/web/src/auth/parent-consent.ts` and the identity store (risky paths);
  route files stay thin.
- Rate limit through 1.4's limiter.

## Out of bounds
- `packages/harness/**` (busy: 3.3, 5.6)
- `packages/contracts/**`, `docs/adr/**`
- `content/prompt-packs/**`
- `content/locales/IN.yaml`, `content/locales/global.yaml`
- payments
- parent accounts and under-13 learners (build plan non-goals)
- Hindi copy (English-only pilot)

## Risky paths touched (checked against risk-paths.txt)
| Path | Group | Reviewers | Phase |
|---|---|---|---|
| `packages/db/src/identity/**` | security | security-reviewer | A, D |
| `packages/db/src/repositories/ports.ts` | security | security-reviewer | A |
| `content/locales/US.yaml` | safety | code-reviewer | B |
| `.claude/skills/merge-gate/risk-paths.txt` | harness | security-reviewer | B |
| `content/legal/**` (new; added to the code-reviewer group in B) | safety | code-reviewer | B |
| `apps/web/src/auth/**` | security | security-reviewer | C, D |

Also recommended:
- database-reviewer on A (additive migration, erase transaction)
- typescript-reviewer on A (the required option breaks callers by design)

Each phase's handoff logs a `risk: high` decision. Not touched: contracts, ADRs, the harness.

## Open questions for the human
- **Q1 (blocks D): how is parental consent "verifiable"?**
  - (a) The learner gives a parent's email. The parent gets a single-use link, reads the notice,
    declares they are the parent and an adult, and consents.
  - (b) As (a), but the parent also signs in (Google or email) and gives their own birth year.
  - (c) A government age token (e.g. DigiLocker), which is strong but is an integration project.
  - (d) A card or payment check (needs M10).
  - **Recommend (a) for the pilot**, with a lawyer confirming it meets DPDP Rule 10 for a small
    pilot, and (b) or (c) before scale.
- **Q2 (before launch): the privacy notice text and signer.** Is it one notice per market (IN, US,
  global; recommended), or one global notice with addenda? Who writes it, and which named human
  signs `reviewedBy`? A lawyer for IN (DPDP) is recommended. Until then the builder ships marked
  placeholders, and `content validate` fails.
- **Q3: the birth-year edge.**
  - (a) Count the ambiguous year as the younger age. A child turning 13 this year waits until
    1 January, and an IN 18-year-old may need consent until 1 January. No extra data.
  - (b) Also ask, without storing it, "had your birthday this year?"
  - **Recommend (a).**
- **Q4: account order.**
  - (a) Sign-in creates a locked row. An under-13 answer erases it at once, and a 24-hour browser
    block follows. Works with email links opened in another app.
  - (b) Ask before sign-in, so no email ever reaches the database first. Breaks email links opened
    in another browser.
  - **Recommend (a)**, unless counsel says COPPA/DPDP need (b).
