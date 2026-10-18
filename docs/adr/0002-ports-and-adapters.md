# ADR-0002: Ports and adapters

## Status

Accepted

## Date

2026-10-18

## Context

The harness must stay framework-free: it "never imports Next.js, the database, payment or provider SDKs, only the ports it is given" (build plan § Repo layout). Build plan rule 3 says the same. The decision log (17 Oct 2026 · 0.1 Harness purity rule · decided by you) limits harness imports to contracts, zod, mathjs and its own files.

The build plan says two different things about where the ports live:

- § Repo layout, "Ports and adapters": "`harness` defines ports (`EntitlementStore`, `ProfileStore`, `TranscriptStore`, `RetrievalIndex`, `CorrectionStore`, `UsageMeter`, `TraceSink`, `AlertSink`, `ModelGateway`); `db`, `gateway`, `ingest` and `worker` provide adapters."
- § Core contracts: "These types live in `packages/contracts`", and the Core contracts listing includes the port interfaces.

Task 0.3 had to pick one. The decision log records the choice: 18 Oct 2026 · 0.3 Ports live in contracts · decided by team lead.

## Decision

The port interfaces live in `packages/contracts/src/ports.ts`. They are type-only: no Zod schemas and no fixtures, because functions can't be Zod data. The ports are `Guard`, `RetrievalIndex`, `EntitlementStore`, `ProfileStore`, `TranscriptStore`, `CorrectionStore`, `TeacherQuestionStore`, `UsageMeter`, `ModelGateway`, `Tool<I, O>`, `TraceSink` and `AlertSink`.

`db`, `gateway`, `ingest` and `worker` implement the ports by importing contracts. The harness imports the ports from contracts and uses them; it does not define them. Tests use in-memory adapters from `harness/testing`, with the scripted gateway that replays fixtures (build plan § Repo layout; § Turn pipeline spec, "Determinism").

**This differs from the Repo layout sentence "`harness` defines ports".** The two build-plan sections conflicted. Contracts was chosen because adapters can then implement a port without depending on the harness (decision log, 18 Oct 2026 · 0.3 Ports live in contracts). The adapter and harness split in the Repo layout still holds; only the home of the interfaces is different.

## Alternatives

Define the ports in `packages/harness`, as the Repo layout says (decision log, 18 Oct 2026 · 0.3 Ports live in contracts). Not chosen because the `db`, `gateway` and `ingest` adapters would then have to depend on the harness package to implement them.

## Consequences

- Adapters depend on one package, contracts, not on the harness.
- The harness import rule (contracts, zod, mathjs, own files) still covers everything the harness needs.
- A reader comparing the Repo layout text with the code should read this ADR: the code follows Core contracts.
- Because the ports are in `packages/contracts`, changing one needs an ADR (build plan § Core contracts; rule 2). Moving them is "Reversible: Only by ADR" (decision log, 18 Oct 2026 · 0.3 Ports live in contracts).

## Reviewers

Pending: architect, security-reviewer, typescript-reviewer (required for `docs/adr/**`).
