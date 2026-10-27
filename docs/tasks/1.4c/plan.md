# 1.4c plan: Google sign-in after a link sign-up links accounts when both emails are verified

Board: `board.py show 1.4c` · milestone M13 · deps: 1.4 (done) · risk: **risky**
(`apps/web/src/auth/**`, `packages/db/src/identity/**`) · branch `m13/1.4c-link-verified-email`.

## Acceptance (verbatim, `docs/board/tasks.yaml`)
Title: "Google sign-in after a link sign-up (1.4 plan Q4): link the accounts when both sides have
a verified email instead of OAuthAccountNotLinked (changes a 1.3 risk-high decision)"
Accept: "a user who signed up by link can then sign in with Google on the same verified address;
an unverified Google email never links; auth tests pass"

### How it is shown (paste into handoff.md)
| Part | Evidence |
|---|---|
| Link sign-up, then Google, same verified address → linked, same user | `flow.test.ts`: a student signs up by email link (gets `emailVerifiedAt` set), then signs in with Google on the same address with `email_verified: true`; the callback redirects to the app, the session belongs to the **same** `usr_*` id, and `identity.linked` gets exactly one `{ userId, provider: 'google', providerAccountId, type: 'oidc' }` row. |
| Existing user's email not verified → refused, nothing linked | `flow.test.ts`: the same shape, but the existing user's `emailVerifiedAt` is `null` (e.g. created directly, or hypothetically by Google) → `AccessDenied`, `identity.accounts.size` stays 0. |
| Google email not verified → refused, nothing linked (unchanged) | `flow.test.ts`/`config.test.ts`: `email_verified: false` on Google's side still refuses before any lookup, matching 1.3. |
| A second Google account can't claim an already-linked address | `config.test.ts`: owner already has a linked `google` account (sub `g-a`); a sign-in with a **different** sub (`g-b`) and the same email is refused, and `linkAccount` is never called. |
| Returning Google user unaffected | `flow.test.ts`: signing in again with the *same* linked Google account still succeeds (existing 1.3 coverage re-run against the new flag value). |
| Shared-device and age-block rules unaffected | `config.test.ts`'s existing "signIn callback while already signed in" and "owner... blocked" describe blocks still pass unmodified (re-run, not rewritten). |
| Gates | `corepack pnpm turbo run build typecheck lint test --filter=@edmate/web... --filter=@edmate/db...` with Postgres up. Coverage for `src/auth/**` and `src/identity/**` holds at its current level. Secret scan clean. |

## Design

### The problem, precisely
Today (1.3) Google's provider has `allowDangerousEmailAccountLinking: false`. When a Google
sign-in's email matches an existing user with **no** linked Google account yet (the exact shape an
email-link sign-up leaves behind), `@auth/core` resolves the account *before* our `signIn`
callback runs: `getUserByAccount` misses, falls back to `getUserByEmail`, finds the existing user,
and — because the flag is false — throws `AccountNotLinked` right there. `flow.test.ts`'s existing
"does not link... (no dangerous linking)" test proves the throw fires even though, if the signIn
callback *were* reached, it would have returned `true` (`existing user not signed in -> true`).
That ordering (resolve-and-maybe-throw, then callback) is why a bare `signIn`-callback check cannot
gate this today: turning the flag on is the only way to stop `@auth/core` from throwing before our
own code ever gets a say.

### Decision: flip the flag, but only Edmate's own check approves the link
`allowDangerousEmailAccountLinking: true` on the Google provider, **plus** a new, narrow block in
the existing `signIn` callback (`apps/web/src/auth/config.ts`) that runs before Google sign-in is
ever approved:

```
if (!linkedOwner && owner) {
  if (!owner.emailVerifiedAt) return false;               // existing user's email not verified
  if (await identity.hasLinkedAccount(owner.id, 'google')) return false; // already bound elsewhere
}
```

placed right after `owner` is computed (where `isAgeBlocked` is already checked) and before the
shared-device `current` check, so every existing rule (age block, shared-device refusal) still
applies unchanged on top of it. This only fires the first time a Google account's email matches an
*unlinked* existing user — the normal "returning Google user" and "brand-new address" paths never
reach it, because `linkedOwner` is already set or `owner` is `undefined`.

- **"Both sides verified."** Google's side is already required by the existing top-of-callback
  check (`p.email_verified !== true` → `false`, unchanged). The existing side is `owner.emailVerifiedAt`
  being non-null. Under 1.3/1.4 as built, that field is **only** ever set by the email-link path
  (`createUser`'s `emailVerified` from a successfully clicked link, or `markEmailVerified`); Google
  sign-up never sets it (`profile()` passes no `emailVerified`, by design — the comment in
  `config.ts` already says Google's own claim is rechecked every time, never cached). So this check
  can only ever fire for addresses that reached `emailVerifiedAt` through the magic-link flow,
  exactly the acceptance's "a user who signed up by link".
- **"An unverified Google email never links."** Unchanged: the existing `p?.email_verified !== true`
  branch at the top of the Google half of `signIn` already refuses before any lookup runs, flag or
  no flag.
- **A different Google account later claiming the same address (takeover).** README rule 7
  (`packages/db/src/identity/README.md`) already enforces "one account per provider per user" at
  the data layer (unique `(user_id, provider)`; the in-memory fake mirrors it). Letting `@auth/core`
  attempt `linkAccount` and rely on that constraint would surface as an unhandled driver error
  through Auth.js's generic error path — untested and unpredictable. The new
  `identity.hasLinkedAccount(userId, provider)` check (below) makes the same invariant an explicit,
  tested `false` instead.
- **An email change.** Not reachable from this code path: after the first link, every later Google
  sign-in for that user resolves through `getUserByAccount` (the stable `sub`), never through
  `getUserByEmail` again, so a later email change at Google (or, once it exists, in Edmate) doesn't
  re-trigger this block. No code change needed; noted as Open question Q4.
- **Case and Unicode differences.** `identity.getUserByEmail` already normalises through the same
  `Email` Zod schema (`trim().toLowerCase().pipe(z.email())`) both sides go through; it has no
  Unicode (NFC/NFD) normalisation, so a byte-different-but-visually-identical address would **fail
  to match** (no link happens), never match-when-it-shouldn't. A missed link is a usability gap,
  not a takeover; noted as Open question Q5, no code change in this task.
- **Why not keep the flag `false` and link ourselves inside `signIn`.** Rejected: given the ordering
  above, `@auth/core` has already thrown by the time our own `signIn` callback would run, so there
  is no point in the lifecycle left for Edmate code to intervene without the flag. (The first build
  step — a red integration test against the real handlers — must confirm this ordering holds in
  `next-auth@5.0.0-beta.32` before the rest of the work proceeds; see Open question Q2.)

### New store method: `packages/db/src/identity/store.ts`
`hasLinkedAccount(userId: string, provider: string): Promise<boolean>` on `IdentityStore`: `SELECT
1 FROM auth_accounts WHERE user_id = $1 AND provider = $2 LIMIT 1` (via `guarded()`, `IdSchema` +
the existing `Provider` Zod schema, same pattern as the other identity methods). No new type, no
schema or migration change (reads the existing `auth_accounts` table). Exported unchanged through
`packages/db/src/identity/index.ts` (already a blanket re-export of `IdentityStore`).

### README update
`packages/db/src/identity/README.md` rule 7 gets one sentence: the app-level pre-check
(`hasLinkedAccount`) that 1.4c's `signIn` callback uses before approving a link, so the unique
`(user_id, provider)` constraint is never the first line of defence.

### Test fakes
`apps/web/test/memory-identity.ts` gains `hasLinkedAccount`, scanning its existing `accounts` map
exactly like `linkAccount`'s own duplicate check already does (same loop, read-only).

## Files

**Modify only (no new files):**
- `packages/db/src/identity/store.ts` — `IdentityStore.hasLinkedAccount` + implementation
- `packages/db/src/identity/README.md` — rule 7 sentence
- `packages/db/test/identity.int.test.ts` — `hasLinkedAccount` coverage (true/false, bad input)
- `apps/web/src/auth/config.ts` — the new `signIn` block; `allowDangerousEmailAccountLinking: true`
  with an updated comment explaining why
- `apps/web/src/auth/config.test.ts` — rename/update the "no dangerous linking" provider-config
  test; add the `hasLinkedAccount`-gated cases to the `signIn callback` describe block
- `apps/web/src/auth/flow.test.ts` — replace "does not link a new Google account to an existing
  email" with the linked/refused end-to-end cases (table above)
- `apps/web/test/memory-identity.ts` — `hasLinkedAccount` fake
- `docs/tasks/1.4c/handoff.md` (builder)

**Out of bounds (per the brief and CLAUDE.md scoping):**
- `apps/web/app/staff/**`, `apps/web/app/api/staff/**` (9.3g, different task)
- `packages/db/src/repositories/learner.ts` (6.3b, different task)
- `packages/contracts/**`, `packages/harness/**` (no contract or harness change)
- `apps/web/src/auth/email*.ts`, `rate-limit*.ts`, `mail*.ts`, `adapter.ts`, `env.ts`, `age*.ts`,
  `guard.ts`, `confirm*.ts`, `errors.ts`, `describe-error.ts`, `redis-ready.ts`, `index.ts` — none
  of 1.4c's logic touches the email provider, the adapter's `Adapter` methods, env parsing or the
  route guard; `hasLinkedAccount` is called directly off `identity` from `config.ts`, the same way
  `isAgeBlocked`/`learnerStatus` already are, not through the `Adapter` interface
- `docker/**`, `.github/**`, `.claude/**`, `docs/adr/**` — no change
- No schema or migration: `auth_accounts` already exists; `hasLinkedAccount` is a read

## Tests first (red, then green)
1. **`packages/db/test/identity.int.test.ts`** (Phase A): `hasLinkedAccount` returns `false` for a
   user with no accounts, `true` once `linkAccount` has run for that `(userId, provider)`, `false`
   for a different provider on the same user, and `invalid` for a bad `userId`/`provider` (Zod).
2. **`apps/web/src/auth/flow.test.ts`** (Phase B, real `next-auth` handlers, no network — same
   harness as the existing file): write the four end-to-end rows in the evidence table as failing
   tests first (the existing "does not link" test's expectation is the thing being replaced, so
   edit it in place rather than leaving two contradictory tests).
3. **`apps/web/src/auth/config.test.ts`** (Phase B): the provider-config test's
   `allowDangerousEmailAccountLinking: true` expectation (now failing until the config changes),
   plus the two new `signIn callback` unit cases (owner unverified → `false`; owner already has a
   different linked Google account → `false`, with a `hasLinkedAccount` spy confirming it's only
   consulted when `linkedOwner` is absent).
4. Then make them pass: `hasLinkedAccount` (store + fake), the `config.ts` block, the flag flip.

## Phases
Two phases (one package each), so no builder works across both without a fresh read of the other
package's state.

### Phase A: `packages/db` only
- Tests first: `hasLinkedAccount` cases in `identity.int.test.ts` (item 1 above).
- Then: the `IdentityStore` method, its implementation, the README sentence.
- Gates: `turbo run build typecheck lint test --filter=@edmate/db...` with Postgres up.
- **State after A:** the store can answer "does this user already have a linked X account", and
  nothing calls it yet; `apps/web` is unchanged and still green.

### Phase B: `apps/web/src/auth` only
- Tests first: the `flow.test.ts` and `config.test.ts` cases (items 2–3 above), plus
  `memory-identity.ts`'s `hasLinkedAccount` fake (needed for the unit tests to even run) and a quick
  check — against the real handlers, same style as `flow.test.ts`'s existing tests — that
  `@auth/core` really does reach the `signIn` callback once the flag is `true` for this shape
  (Open question Q2's confirmation step; if it does **not**, stop and report back rather than
  guessing further).
- Then: `config.ts`'s new block and flag flip.
- Gates: `turbo run build typecheck lint test --filter=@edmate/web...` with Postgres up (`flow.test.ts`
  needs the real identity-store shape, so run against both the memory fake and, if the existing
  suite already does, the Postgres-backed one). Re-run the full `signIn callback` and `shared
  device` describe blocks unmodified to prove nothing else regressed. Write
  `docs/tasks/1.4c/handoff.md`.

## Gate commands
```
corepack pnpm turbo run build typecheck lint test --filter=@edmate/db...
corepack pnpm turbo run build typecheck lint test --filter=@edmate/web...
python3 .claude/skills/merge-gate/merge_gate.py 1.4c
python3 .githooks/secret-scan.py --all
```

## Risky paths touched
Checked against `.claude/skills/merge-gate/risk-paths.txt`:
- `packages/db/src/identity/**` (`store.ts`, `README.md`) → **security-reviewer**
- `apps/web/src/auth/**` (`config.ts`, `config.test.ts`, `flow.test.ts`) → **security-reviewer**
- No match: `packages/db/test/**`, `apps/web/test/**`, `docs/tasks/1.4c/**` (plan/handoff).
- Not touched: `apps/web/app/api/auth/**`, `apps/web/app/staff/**`, `apps/web/app/api/staff/**`,
  `.claude/**`, `.github/**`, `packages/contracts/**`, `docs/adr/**`.
- `review.md` should read `Reviewers: security-reviewer, database-reviewer, typescript-reviewer`.
  Only security-reviewer is required (sign-in account-linking logic, both files). database-reviewer
  is recommended for the new `auth_accounts` read and its Zod/`guarded()` shape; typescript-reviewer
  for the `IdentityStore` interface addition and the `signIn` callback's narrowed types.
- No ADR: no change to `packages/contracts`, the tech stack, or prompt-pack behaviour — only an
  existing provider's option and one new read-only store method.
- The handoff logs the `risk: high` decision below (it replaces part of the 1.3 entry).

## Decisions (draft, for the handoff — replaces the Google-provider bullet of the 18 Oct 2026 1.3
entry in `docs/decisions/log.md`)

### 1.4c Google sign-in links to an existing email-verified user; Google's own dangerous-linking
flag is on, gated entirely by Edmate's own check · decided by planner · risk: high
Decided:
- **Flag.** The Google provider's `allowDangerousEmailAccountLinking` changes from `false` (1.3) to
  `true`. This is necessary, not cosmetic: `@auth/core` resolves the account (and, with the flag
  false, throws `AccountNotLinked`) *before* the `signIn` callback runs, so no callback-only check
  can intervene while the flag stays `false`.
- **The real gate.** The `signIn` callback refuses the sign-in (returns `false`, same as every
  other refusal in this callback) unless: Google reports `email_verified: true` (already true since
  1.3) **and** the existing user this email belongs to already has `emailVerifiedAt` set (only ever
  true today for a user who verified by the email-link flow) **and** that user has no other `google`
  account already linked (`identity.hasLinkedAccount`, new). Any one of those failing refuses the
  sign-in and links nothing; `@auth/core` never gets to call `linkAccount` in that case.
- **Why this is "narrow", not "flip and hope".** The flag alone (Auth.js's documented "dangerous"
  default) links by email with no verification at all. Edmate never relies on that: every path that
  could reach `linkAccount` must first pass the three checks above, which is the officially
  recommended mitigation for this exact flag — the flag only changes *when `@auth/core` is willing
  to try*, Edmate's callback decides *whether it's allowed to*.
- **Unaffected.** The email magic-link provider's own branch of `signIn`; the shared-device check;
  the under-age block; a returning Google user (resolved by `getUserByAccount`, never reaching the
  new block).

Why: this is the only point in `next-auth@5.0.0-beta.32`'s OAuth callback lifecycle where Edmate's
own code can decide whether a by-email link is trustworthy; the three-part check (verified on both
sides, no existing different link) is exactly the acceptance criteria and mirrors README rule 7's
existing data-layer invariant, made explicit and tested instead of left to a driver-error.

Alternatives:
- Keep the flag `false` and try to link inside the callback: rejected, the throw happens earlier in
  the lifecycle than the callback runs, so there's nothing left for Edmate's code to prevent.
- Allow linking on Google's `email_verified` alone, ignoring the existing user's own verification
  state: rejected, it would let an attacker's freshly-created, Google-verified account silently
  annex any pre-existing, never-verified Edmate user at that address.
- A Better-Auth-style custom OAuth flow: an ADR-level change to the tech stack, out of proportion to
  this task.

Reversible: yes. The flag and the `signIn` block both sit in `createAuthConfig`; reverting to 1.3's
behaviour is a two-line change with no data migration (no schema change in this task at all).

## Open questions (none blocks the build; each has a default the build uses)
- **Q1. Flip the flag vs. a fully custom resolution that never flips it.** Flipping is simpler and
  is Auth.js's own documented mitigation path. **Recommendation and default: flip it**, gated as
  above; this is the plan's central `risk: high` call and the thing security-reviewer should focus
  on.
- **Q2. Does `signIn` really run after account resolution once the flag is `true`, in this exact
  next-auth pin?** The plan infers this from the existing (flag-`false`) test's behaviour, but
  Phase B's first task must confirm it directly against the real handlers before writing the rest
  of the block. **Recommendation and default:** confirm first; if the assumption is wrong, stop and
  report back rather than reshaping the design mid-build.
- **Q3. Should `hasLinkedAccount` be provider-general or Google-specific?** It already takes a
  `provider` argument, so it needs no change when phone OTP (out of MVP) adds a second
  provider that calls `linkAccount`. **Recommendation and default:** ship it general as designed;
  nothing Google-specific in its name or signature.
- **Q4. An email change after linking.** No self-service email change exists yet (13.4 is account
  delete only). Once one exists, re-verify this task's invariant still holds (it should, since
  later sign-ins resolve by `getUserByAccount`, not email). **Recommendation and default:** no
  action in 1.4c; a one-line check added to whichever task first adds email change.
- **Q5. Unicode normalisation of addresses (NFC/NFD).** `Email` only ASCII-folds (trim + lowercase);
  a byte-different, visually-identical address fails to match rather than falsely matching, so this
  is a usability gap, not a safety gap. **Recommendation and default:** no change in 1.4c; revisit
  only if the pilot sees a real collision.

## Budget
Budget: 55 tool calls (2 phases, packages/db + apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (test/typecheck/lint runs and the secret scan only)

## Exit conditions
Status: DONE when both phases are green on the gate commands above, `flow.test.ts`'s and
`config.test.ts`'s existing (unrelated) describe blocks still pass unmodified, and
`docs/tasks/1.4c/handoff.md` is written with the `risk: high` decision above pasted into
`## Decisions`. Status: PARTIAL if Open question Q2's confirmation step shows the assumed
`next-auth` ordering is wrong (stop and report, per CLAUDE.md rule 7 — this is an open decision,
not a guess to make alone), past about 55 tool calls total, or if a file outside this plan's list
needs changing to make the acceptance pass.

## READY
Nothing blocks the build. The only unknown is a version detail the Phase B builder confirms first
(`next-auth@5.0.0-beta.32`'s callback-vs-resolution order with the flag on), with Q2's fallback
above if it's wrong. No contracts change and no ADR is needed.

## Lead answers (27 Oct 2026)

- **Q1 (flip the flag on the Google provider, gated in `signIn`):** yes. Correction to the reasoning: in the installed `@auth/core` 0.41.3, the `signIn` callback (`handleAuthorized`, `lib/actions/callback/index.js:63`) runs **before** `handleLoginOrRegister` (`:70`), which is where the email link or the `OAuthAccountNotLinked` throw happens (`handle-login.js:236-250`). With the flag false, the throw still fires after `signIn` approves, so the flag must be true for linking to work; because `signIn` runs first, refusing there stops the link before any row is written. Set the flag only on the Google provider, never globally, and comment it.
- **Q2:** answered by the code above; still keep the first red test in Phase B (a flow test that links on a verified pair and refuses otherwise) as proof against the real handlers. If it shows the link happens before `signIn`, stop and report.
- In `signIn`, when `getUserByAccount` misses, `user` is the Google profile user (not a database user), so look the owner up by the profile email through `identity.getUserByEmail`, as the plan's sketch does.
- **Q3–Q5:** as recommended.
- One builder runs both phases (budget 55, stop at 75). Reviewers: security-reviewer, database-reviewer, code-reviewer, typescript-reviewer.
- Never rebase; if `main` moves, `git merge --no-edit origin/main`.
