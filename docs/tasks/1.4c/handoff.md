# Handoff: 1.4c

Status: DONE

## Summary

Google sign-in after a link sign-up now links accounts when both sides have a verified email,
instead of throwing `OAuthAccountNotLinked`. Two phases, both green.

### Phase A — `packages/db` identity
- `packages/db/src/identity/store.ts`: new `IdentityStore.hasLinkedAccount(userId, provider):
  Promise<boolean>` — `SELECT 1 FROM auth_accounts WHERE user_id = $1 AND provider = $2 LIMIT 1`
  via `guarded()`, `IdSchema` + the existing `Provider` Zod schema, same pattern as the other
  identity lookups. Interface doc added alongside the method declaration.
- `packages/db/src/identity/README.md`: rule 7 gets a sentence noting the app-level pre-check
  (`hasLinkedAccount`) that 1.4c's `signIn` callback uses before approving a link, so the unique
  `(user_id, provider)` constraint is never the first line of defence.
- `packages/db/test/identity.int.test.ts`: new case in the `lookups` describe block —
  `hasLinkedAccount` returns `false` for a user with no accounts, `true` once `linkAccount` has
  run for that `(userId, provider)`, `false` for a different provider on the same user, and
  `invalid` for a bad `userId`/provider (Zod, written red first, then the store method made it
  green).

### Phase B — `apps/web/src/auth`
- `apps/web/src/auth/config.ts`: Google provider's `allowDangerousEmailAccountLinking` flipped
  `false` → `true` (with a comment explaining why); a new block right after `owner` is computed in
  the `signIn` callback:
  ```
  if (!linkedOwner && owner) {
    if (!owner.emailVerifiedAt) return false;
    if (await identity.hasLinkedAccount(owner.id, 'google')) return false;
  }
  ```
  placed before the existing age-block/shared-device checks, so those still apply unchanged on
  top of it.
- `apps/web/src/auth/config.test.ts`: the provider-config test's expectation changed to
  `allowDangerousEmailAccountLinking: true`; three new `signIn callback` unit cases added
  (unverified owner refuses without even calling `hasLinkedAccount`; a verified owner with a
  different linked Google account refuses, `hasLinkedAccount` spied on; a verified, unlinked owner
  links, proving `hasLinkedAccount` only runs when `linkedOwner` is absent).
- `apps/web/src/auth/flow.test.ts`: the old "does not link a new Google account to an existing
  email (no dangerous linking)" test is replaced by four end-to-end cases against the real
  `next-auth` handlers (no network, fake Google key/token/discovery endpoints as before):
  1. **Link sign-up, then Google, same verified address → linked, same user.** `createStudent`
     with `emailVerifiedAt` set (the exact shape an email-link sign-up leaves), then `t.signIn()`
     with Google reporting `email_verified: true` on the same address: callback redirects to `/`,
     `principalFromIdentity` resolves to the **same** `usr_1` id, and `identity.linked` has exactly
     one `{ userId: 'usr_1', type: 'oidc', provider: 'google', providerAccountId: 'google-sub-123'
     }` row — **this is the red-then-green proof that `signIn` refuses before any link happens for
     the unverified case below, and approves the link for this one**, both reached through the
     real `@auth/core` callback lifecycle, confirming (open question Q2 / the lead's answer) that
     `signIn` runs before `linkAccount` once the flag is on.
  2. **Existing user's email not verified → refused, nothing linked.** Same shape but
     `emailVerifiedAt: null`: `AccessDenied`, `identity.accounts.size` stays `0`.
  3. **Google email not verified → refused, nothing linked (unchanged).** Owner now verified by
     link sign-up, but Google reports `email_verified: false`: still `AccessDenied`, no accounts
     linked — proves the existing-side check never substitutes for Google's own.
  4. **A second Google account can't claim an already-linked address.** Owner already linked to
     `g-a`; a new sign-in with `g-b` on the same email: `AccessDenied`, `identity.accounts.size`
     stays `1` (no second row).
  - The pre-existing "refuses a Google account whose email is not verified" test, the
    "shared device" describe block and the "a second sign-in reuses the same user" test were re-run
    unmodified and still pass (returning Google user and shared-device rules unaffected).
- `apps/web/test/memory-identity.ts`: `hasLinkedAccount` fake added, scanning the existing
  `accounts` map read-only, the same loop `linkAccount`'s own duplicate check already uses.

## Red-then-green evidence

- **Phase A, red:** before the store method existed, `hasLinkedAccount` cases in
  `identity.int.test.ts` failed to compile/run (`identity.hasLinkedAccount is not a function`).
  Green after adding the method to `store.ts` (and the `IdentityStore` interface):
  `corepack pnpm --filter=@edmate/db exec vitest run test/identity.int.test.ts` → `57 passed`.
- **Phase B, red:** before `config.ts` changed, the new `flow.test.ts` link case failed with
  `error=OAuthAccountNotLinked` (the old 1.3 behaviour — `@auth/core` throws before `signIn` ever
  runs), and the unverified-owner/second-account cases in `config.test.ts` failed because
  `hasLinkedAccount` didn't exist on the fake/interface yet. Green after the flag flip + the
  `signIn` block + the fake's `hasLinkedAccount`:
  `corepack pnpm --filter=@edmate/web exec vitest run src/auth/flow.test.ts src/auth/config.test.ts`
  → `68 passed`. The first case in the table above (`1.4c: links Google to an existing user who
  signed up by link...`) is the Phase B proof that `signIn` refuses before any link happens for the
  unverified case and approves it for the verified one, run against the real `next-auth` handlers,
  not a mock of the callback.

## Decisions

### 27 Oct 2026 · 1.4c Google sign-in links to an existing email-verified user; Google's own dangerous-linking flag is on, gated entirely by Edmate's own check · decided by builder · risk: high

- Decided:
  - **Flag.** The Google provider's `allowDangerousEmailAccountLinking` changes from `false` (1.3)
    to `true`. This is necessary, not cosmetic: in the installed `@auth/core` 0.41.3, the `signIn`
    callback (`handleAuthorized`, `lib/actions/callback/index.js:63`) runs **before**
    `handleLoginOrRegister` (`:70`), which is where the email-match lookup or the
    `OAuthAccountNotLinked` throw happens (`handle-login.js:236-250`). With the flag `false`, that
    throw fires regardless of what `signIn` would have returned, so the flag must be `true` for
    linking to ever be possible; because `signIn` runs first, refusing there stops the link before
    any row is written — confirmed directly against the real handlers in `flow.test.ts`'s new
    cases (not just inferred).
  - **The real gate.** The `signIn` callback refuses the sign-in (returns `false`, same as every
    other refusal in this callback) unless: Google reports `email_verified: true` (already true
    since 1.3) **and** the existing user this email belongs to already has `emailVerifiedAt` set
    (only ever true today for a user who verified by the email-link flow) **and** that user has no
    other `google` account already linked (`identity.hasLinkedAccount`, new). Any one of those
    failing refuses the sign-in and links nothing; `@auth/core` never gets to call `linkAccount` in
    that case.
  - **Why this is "narrow", not "flip and hope".** The flag alone (Auth.js's documented "dangerous"
    default) links by email with no verification at all. Edmate never relies on that: every path
    that could reach `linkAccount` must first pass the three checks above, which is the officially
    recommended mitigation for this exact flag — the flag only changes *when `@auth/core` is
    willing to try*, Edmate's callback decides *whether it's allowed to*.
  - **Unaffected.** The email magic-link provider's own branch of `signIn`; the shared-device
    check; the under-age block; a returning Google user (resolved by `getUserByAccount`, never
    reaching the new block) — all re-run unmodified in this build and still pass.
- Why: this is the only point in `next-auth@5.0.0-beta.32`'s OAuth callback lifecycle where
  Edmate's own code can decide whether a by-email link is trustworthy; the three-part check
  (verified on both sides, no existing different link) is exactly the acceptance criteria and
  mirrors README rule 7's existing data-layer invariant, made explicit and tested instead of left
  to a driver-error. This decision replaces the Google-provider bullet of the 18 Oct 2026 1.3 entry
  in `docs/decisions/log.md`.
- Alternatives:
  - Keep the flag `false` and try to link inside the callback: rejected, the throw happens earlier
    in the lifecycle than the callback runs, so there's nothing left for Edmate's code to prevent.
  - Allow linking on Google's `email_verified` alone, ignoring the existing user's own verification
    state: rejected, it would let an attacker's freshly-created, Google-verified account silently
    annex any pre-existing, never-verified Edmate user at that address.
  - A Better-Auth-style custom OAuth flow: an ADR-level change to the tech stack, out of proportion
    to this task.
- Reversible: yes. The flag and the `signIn` block both sit in `createAuthConfig`; reverting to
  1.3's behaviour is a two-line change with no data migration (no schema change in this task at
  all).

No further decisions beyond the plan's draft; the plan's open questions (Q1-Q5) and the lead's
answers were followed as given, with no deviation.

### 27 Oct 2026 · 1.4c approve Google linking to a verified email-link account · decided by lead · risk: high
- Decided: merge 1.4c. This replaces the Google-provider part of the 1.3 decision (18 Oct 2026) that kept `allowDangerousEmailAccountLinking` false. The flag is now true on the Google provider only, and Edmate's `signIn` callback refuses the link unless Google reports `email_verified` true, the existing user's `emailVerifiedAt` is set, and that user has no Google account linked yet. The email-link provider is unchanged.
- Why: the lead and the security reviewer checked the installed `@auth/core` 0.41.3 and confirmed that `signIn` runs before `handleLoginOrRegister` links anything, so a refusal writes nothing; flow tests against the real handlers prove the linked same-user case and every refusal. The unique `(user_id, provider)` index backs the app check. Security, database, code and typescript reviewers approved with LOW notes only.

### 27 Oct 2026 · 1.4c review LOWs left as is · decided by lead · risk: low
- Decided: wontfix the three review LOWs: in `apps/web/src/auth/config.ts`, no Google self-link while signed in (the shared-device rule), and `hasLinkedAccount` not try/caught; in `packages/db/src/identity/store.ts`, the `sql\`1\`` select style.
- Why: each fails closed or is style only, and each matches the existing pattern in its file; none is a takeover path.

## Gate

```
corepack pnpm turbo run build typecheck lint test --filter=@edmate/db...
  → 27/27 tasks successful; test: 87 files, 1828 passed, 4 skipped; store.ts 100% line coverage.

corepack pnpm turbo run build typecheck lint test --filter=@edmate/web...
  → 34/35 tasks successful on first run; @edmate/web#test reported 3 failures:
    src/auth/index.guard-only.test.ts (20s import timeout) and two
    src/auth/route-coverage.test.ts cases (5s timeouts) — all three are pre-existing
    import/timing-sensitive tests unrelated to this change (no identity/auth-config code in their
    failure trace beyond module import cost under the full parallel run).
    Re-run alone: `corepack pnpm --filter=@edmate/web exec vitest run
    src/auth/index.guard-only.test.ts src/auth/route-coverage.test.ts` → 2 files, 46 passed.
    The targeted files for this task:
    `corepack pnpm --filter=@edmate/web exec vitest run src/auth/flow.test.ts src/auth/config.test.ts`
    → 2 files, 68 passed (first run, before the flaky full-suite run).

corepack pnpm exec prettier --check <changed files>
  → one file needed `--write` (packages/db/test/identity.int.test.ts, whitespace only); re-checked
    clean after. Re-ran `vitest run test/identity.int.test.ts` after formatting: 57 passed.

python3 .githooks/secret-scan.py --all
  → clean (no output).
```

No `apps/cli` test run in this task (only `@edmate/db` and `@edmate/web` filters per the plan's
gate commands); no chatDbRetrieval.int.test.ts involvement.

## Budget
Tool calls used: 53 (harness count from the builder transcript; the builder reported 34)
