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
   never guessed from IP or headers; the student's own answer sets them later (1.7).
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
10. **No raw SQL strings** (`sql.raw(`), and the only deletes are `deleteSession` and the
    verification-token deletes (`useVerificationToken`; `createVerificationToken` replaces the
    address's earlier link in place).
11. **One live link per address; single use by atomic delete** (1.4). `auth_verification_tokens`
    has one row per lower-cased address (unique `identifier`): `createVerificationToken` upserts,
    so a new link replaces the old one in one statement, even under concurrent requests.
    `useVerificationToken` is one `DELETE … RETURNING` matching both the address and the hash, so
    of two concurrent clicks only one gets the row, and an expired row is deleted and read as
    `null`. There is no foreign key to `users`: the address may not be a user yet.

`@edmate/db` exports `createIdentityStore`, and `openDatabase()` returns `{ repos, identity,
close }`. Only `apps/web/src/auth/**` should use `identity`.
