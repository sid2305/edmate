# Task 1.4f: magic-link sandbox check on a rebuilt stack

No branch: this task runs a script and records the result, it does not change code.

## What ran

1. Rebuilt the compose stack on current code: `AUTH_SECRET=$(openssl rand -base64 32) docker compose -f docker/compose.yaml up -d --build`. All containers came up healthy.
2. First run of `node apps/web/scripts/sandbox-magic-link.mjs` failed: `POST /api/auth/signin/email` redirected to `error=Configuration`, and the web logs showed `RepositoryError`/`AdapterError`. The rebuild had started against an empty Postgres data volume (`docker/data/postgres`), so no migration had ever run against it — the auth adapter had no tables.
3. Fixed by building the workspace and migrating: `corepack pnpm turbo run build --filter=@edmate/db...`, then with Postgres published on `127.0.0.1:55432` (`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`), `DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm --filter @edmate/db db:migrate` then `corepack pnpm seed`.
4. Re-ran the sandbox script. Full output:

```
ok   GET /api/health → 200
ok   GET /api/auth/csrf → token
POST /api/auth/signin/email (student1@example.test) → 302 http://localhost:8080/api/auth/verify-request?provider=email&type=email
ok   redirected to verify-request
Mailpit: "Your Edmate sign-in link" to student1@example.test
ok   the mail holds a link
ok   link origin is AUTH_URL's (http://localhost:8080)
link: http://localhost:8080/sign-in/confirm?token=<redacted>&...
ok   the link opens the confirm page
GET link (another browser) → 200
ok   another browser opening the link is asked to confirm, not signed in
GET link (same browser) → 307 /api/auth/callback/email
ok   the same browser goes straight to the callback
GET callback (another browser) → 303 /sign-in/confirm
ok   another browser at the callback is sent to confirm
GET callback → 302 http://localhost:8080/
ok   session cookie set
GET /api/auth/session → {"user":{"id":"e97bdddc-db8a-49c2-9be5-edf22c4f91a0","role":"student"},"expires":"2026-11-12T16:14:47.997Z"}
ok   signed in as a student
GET same callback again (same browser) → 302 http://localhost:8080/api/auth/error?error=Verification
ok   reusing the link is refused
```

Every check passed. The magic-link flow (request, deliver, confirm, sign in, refuse reuse) works end to end on current code.

## Aside (not part of this task)

`docker compose exec worker npm run storage:roundtrip` failed with `StorageConfigError: storage config refused: S3_REGION_placeholder`. The worker service runs with `NODE_ENV=production`, which makes `storageConfigFromEnv` refuse any setting that equals its dev placeholder; `docker/compose.yaml`'s `worker` block (unlike `web`) sets no region/HTTP override, so the default `S3_REGION=us-east-1` matches the hard-coded placeholder literally. This is a local-stack-only gap (a real deployment sets its own `S3_REGION`), unrelated to 1.4e/1.4f, and is not fixed here. Logged in blockers.md B-61 in case it is worth a small follow-up task.

## Decisions

None.
