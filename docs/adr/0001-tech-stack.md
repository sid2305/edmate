# ADR-0001: Tech stack

## Status

Accepted

## Date

2026-10-17

## Context

Edmate needs one stack that every app and package shares. The build plan fixes it in "Tech stack (fixed)": "One language (TypeScript) end to end, boring dependencies, everything in Docker Compose on one VM." Build plan rule 2 ("Agent operating rules") says the tech stack changes only with an ADR in `docs/adr/`. This ADR is the record that rule points to.

Sources: build plan § Tech stack (fixed); build plan § Agent operating rules, rule 2; decision log, 17 Oct 2026 · Tech stack · decided by Claude (lead), at your request.

## Decision

Use the stack in the build plan's "Tech stack (fixed)" table, as written:

- TypeScript (strict, `noUncheckedIndexedAccess`) on Node.js 22 LTS.
- pnpm workspaces and Turborepo, run as `corepack pnpm`, one lockfile.
- Next.js (App Router) for the student app, teacher studio and staff console; Tailwind CSS, shadcn/ui and next-intl.
- Zod at every external boundary; types are inferred from the schemas.
- PostgreSQL 16 with pgvector; Drizzle ORM and drizzle-kit.
- Redis and BullMQ for queues and cache.
- S3-compatible object storage (MinIO locally), signed URLs only.
- Vercel AI SDK provider packages behind our own `gateway` interface.
- Speech-to-text behind a `Transcriber` port.
- Auth.js (Google sign-in and email magic link).
- One `Payments` port, with a provider per market.
- Locale packs in `content/locales/<market>.yaml`.
- Secrets only from the environment or a secret manager.
- Server-Sent Events for streaming; mathjs, sandboxed, as the calculator.
- Vitest, Playwright and our own eval runner; model and payment calls mocked in unit tests.
- Turn traces in Postgres, Pino logs, optional OpenTelemetry.
- Docker Compose deploy: web, worker, postgres, redis, minio, caddy.
- Code under MIT; teachers own their content (licence decided 16 Oct 2026, per the table).

No Rust. TypeScript runs end to end. Rust is revisited only for a single hot spot at scale, as a Rust service behind an existing port, with its own ADR (decision log, 17 Oct 2026 · Tech stack).

## Alternatives

From the decision log entry (17 Oct 2026 · Tech stack):

- Rust backend with a TypeScript front end.
- Rust for the harness only.

Not chosen because turns are dominated by model, database and network waits, not our code; one language lets every app share the Zod contracts; the libraries needed (Next.js, Auth.js, AI SDK, Drizzle, BullMQ, payment SDKs) are TypeScript-first; and agents and contributors move faster in TypeScript.

## Consequences

- One language and one set of shared Zod contracts across web, worker, CLI and packages.
- Turn time is dominated by model, database and network waits, so using one language costs little speed (decision log, 17 Oct 2026 · Tech stack).
- A later hot spot can move to Rust behind its existing port. That needs its own ADR for that one component, not a change to the whole stack ("Reversible: Yes, per component behind ports").
- Any other change to this stack needs a new ADR that supersedes this one (build plan rule 2).

## Reviewers

Pending: architect, security-reviewer, typescript-reviewer (required for `docs/adr/**`).
