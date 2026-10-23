# Identity store: sign-in's own path to users and sessions (task 1.3; sign-in links 1.4)

Sign-in has to read `users` by email, look up linked provider accounts and delete sessions. The
repository rules 1 (scope first), 7 (no deletes) and 9 (never select from `users`) forbid all
three, so sign-in does not use a repository. It uses this small store, which has its own rules:

1. **Identity fields only.** Every user it returns is `{ id, role, email, emailVerifiedAt, name }`.
   It never reads or returns teacher or student data (sessions, messages, profiles, payments).
2. **Validated before any SQL.** Every input is parsed with Zod; a bad argument is
   `RepositoryError('invalid')`. Emails are trimmed and lower-cased.
3. **Driver errors are scrubbed.** Every method is wrapped in the same `guarded()` as the
   repositories (README rule 10 there): only the driver's code and constraint name survive.
4. **New users are students.** `createStudent` hard-codes `role: 'student'`, `market: 'global'`
   and `locale: 'en'`, and takes only `{ email, emailVerifiedAt, name }`. Market and locale are
   never guessed from IP or headers. The market is set only by the student's own answer at the
   age gate (`recordAgeAnswer`, 1.7, rule 12); the locale stays `en` (English-only pilot).
5. **Only `grantRole` changes a role.** `by` must be exactly `operator` (the CLI) or a user who is
   staff at that moment (share-locked), else `scope`. In the same transaction it writes a
   `role.grant` row to `platform_audit_log`: actor, actor role `operator` or `staff`,
   `subject_user_id`, before/after `{ role }`. It is called by the operator CLI (`db:grant-role`)
   and, later, by the staff console (12.1). No HTTP endpoint grants roles in 1.3.
6. **Platform audit is separate from 1.6's audit log.** `audit_log` keeps "every row belongs to
   one teacher" and its scoped reads are unchanged. Staff and operator actions about no teacher
   (role grants now) go to `platform_audit_log`, which this store only inserts into; 12.1 adds
   its read path.
7. **One account per provider per user** (unique `(user_id, provider)`), as well as one user per
   provider account: a second Google account can't be attached to an existing user.
8. **Session tokens and sign-in link tokens are stored hashed** (SHA-256 hex in
   `auth_sessions.session_token_hash` and `auth_verification_tokens.token_hash`). An expired
   session reads as `null` and can't be extended; an expired link reads as `null`. Auth.js already
   hands the store `sha256(token + AUTH_SECRET)` for a link, so the database holds a hash of a
   hash, but the rule does not rely on that.
9. **No provider tokens or photos.** `linkAccount` stores the provider, its account id and type
   only; OAuth access, refresh and id tokens are never stored (Edmate never calls Google APIs).
10. **No raw SQL strings** (`sql.raw(`), and the only deletes are `deleteSession`, the
    verification-token deletes (`useVerificationToken`; `createVerificationToken` replaces the
    address's earlier link in place) and the under-age erase (1.7): when `recordAgeAnswer` finds
    a student under the market's minimum it deletes, in one transaction, the student's
    `auth_sessions`, `auth_accounts`, the `auth_verification_tokens` row for their email, any
    `consents`, and the `users` row. If any other row still points at the user, the whole erase
    fails and nothing changes; it never deletes a teacher or staff user (`scope`).
11. **One live link per address; single use by atomic delete** (1.4). `auth_verification_tokens`
    has one row per lower-cased address (unique `identifier`): `createVerificationToken` upserts,
    so a new link replaces the old one in one statement, even under concurrent requests.
    `useVerificationToken` is one `DELETE … RETURNING` matching both the address and the hash, so
    of two concurrent clicks only one gets the row, and an expired row is deleted and read as
    `null`. There is no foreign key to `users`: the address may not be a user yet.

12. **Age data is a birth year and a market, nothing more** (1.7). `recordAgeAnswer` takes
    `{ userId, market, birthYear, noticeVersion }` once per student (a second answer is
    `invalid`; a later change goes through staff, 12.1). The market is `global` or two capital
    letters; the year is a whole number from 1900 to this year. Age is the youngest possible for
    the year (`currentYearUTC - birthYear - 1`, `age.ts`). The market's rule comes from the
    injected `agePolicy(market)` (default 13+, consent needed for 13-17), and fails closed: the
    minimum is never below 13 and only `consentRequired: false` waives consent. An answer at or
    above the minimum stores `birth_year`, `market` and `age_confirmed_at`, plus a
    `privacy_notice` consent at the shown notice version, `granted_by = 'self'`. `learnerStatus`
    reads the standing fresh: `age_needed`, `parent_needed` (13-17 in a consent market without a
    live parental consent: `kind = 'parental'`, `granted_by = 'parent'`, `withdrawn_at` null), or
    `clear`. A learner below a minimum raised after their answer reads `parent_needed`, never
    `clear`. The entitlement store's required `learnerClear` (ports.ts) is the agent-use block.
    A broken policy (a minimum that is not finite or above 18) throws: the call fails, nobody is
    erased, and the learner stays blocked. With the `noticeVersion(market)` option (the web wires
    it from the notices it loads), an answer naming any other version is `invalid`. An under-age
    erase blocked by a row the store does not own is `not_found` with nothing changed; the web
    closes that browser's session and staff erase the account (12.1). `learnerStatus` is for
    students only: a teacher or staff user is `scope`. `getMarket(id)` (9.4a) reads only the
    `market` column (`null` for an unknown id); the turn runtime wires it as the entitlement
    store's `studentMarket`, so a student's turns run in their own market, never a deploy setting.

`@edmate/db` exports `createIdentityStore`, and `openDatabase()` returns `{ repos, identity,
close }`. Only `apps/web/src/auth/**` should use `identity`.
