# Task 5.1a: DNS rebinding in web-link fetch — pin the connection to the checked address

Board: `python3 .claude/skills/board/board.py show 5.1a` · Milestone M13 · deps: `GATE`, `5.1` · status: planning.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Web-link fetch follow-up (5.1 Phase A open question): the public-address check resolves the
host separately from the connection, so a host whose DNS answer changes between the two (DNS
rebinding) could reach a private address; pin the connection to the checked address (custom
lookup/agent) where the app is assembled. The allowlist limits it until then"
Accept: "a test where the second DNS answer is private fails closed; the connection uses the
address that passed the check"

## Important finding before any build step: this acceptance is already met on `main`

5.1's Phase A plan opened this gap (`docs/tasks/5.1/plan.md`, §4; `docs/tasks/5.1/handoff.md`
decision "5.1 DNS rebinding in the web fetch is deferred to board task 5.1a"), written when
`packages/ingest`'s web fetch called the platform `fetch` directly. Task **8.2d** ("pinned,
SSRF-safe web fetcher and ADR-0014", merged 22 Oct 2026, `docs/tasks/8.2d/handoff.md`, ADR-0014
accepted at `risk: high`) rebuilt that fetch exactly to close this gap, before 5.1a was ever
picked up:

- `packages/ingest/src/fetch/webFetch.ts` `checkTarget(u, signal)`: resolves the host **once**
  per hop (`opts.resolveHost`), requires every returned address to be public
  (`isPublicAddress`, `packages/ingest/src/fetch/address.ts`), and pins the **first** answer as
  `{ address, family }`. That `Target` is handed to `opts.transport` — the fetcher itself never
  calls DNS again for that hop.
- `apps/worker/src/webLink/pinnedTransport.ts` `pinnedRequestOptions`/`pinnedLookup`: the
  production `PinnedTransport` calls `node:https.request` with a `lookup: LookupFunction` that
  **always answers with the pinned address** (both the single-address and `options.all` forms),
  plus `autoSelectFamily: false` and `agent: false`, so Node has no path back to the system
  resolver for this request. TLS SNI/certificate checks still use the URL's host name (correct:
  the cert must match the name the teacher typed), with no SNI sent for an IP-literal host.
  `rejectUnauthorized: true` is explicit, overriding any `NODE_TLS_REJECT_UNAUTHORIZED=0` in the
  worker's env.
- Every redirect hop re-runs `checkTarget` on the new URL and gets its **own** fresh pin
  (`webFetch.ts`'s hop loop) — a rebinding host can't exploit a redirect either.
- IPv4 and IPv6: `address.ts` parses and public-range-checks both; `familyOf` picks the request's
  `family` from whichever address was pinned; `pinnedLookup(address, family)` returns that exact
  family to Node so the socket family matches the pin.
- `apps/worker/src/webLink/index.ts` `createWorkerWebFetcher` wires `systemResolveHost` (an A
  **and** AAAA query per host, `packages/ingest/src/fetch/address.ts`) to `createPinnedTransport`
  — this is the composition root the board task asks for ("where the app is assembled").

The acceptance's exact two clauses already have passing tests:
- **"a test where the second DNS answer is private fails closed"**:
  `packages/ingest/test/fetch/webFetch.test.ts` → `describe('createWebFetcher: the pinned
  address')` → `it('a DNS-rebinding resolver (public, then loopback) never yields loopback to the
  transport', ...)` (line 123): a fake `resolveHost` returns `[PUBLIC_V4]` first and `['127.0.0.1']`
  on any later call; the fetch succeeds, `resolveHost` is asserted to have been called **exactly
  once**, and every transport call's `address` is asserted to be `PUBLIC_V4` only — the private
  second answer is never consulted, let alone connected to.
- **"the connection uses the address that passed the check"**:
  `apps/worker/src/webLink/pinnedTransport.test.ts` → `it('lands on the pinned address for a host
  that is not in DNS, with only the fixed headers', ...)`: the request URL's host
  (`teacher-site.test`) has no DNS record at all, so a real `node:http` request landing on the
  local test server proves the TCP connection used the pinned `127.0.0.1`, not a lookup of the
  host name. `apps/worker/src/webLink/index.test.ts` → `it('a listed public host is fetched
  through the pinned transport', ...)` asserts `local.pinned` (the address the fake transport
  actually connected to) equals the resolved/checked address, at the full composition-root level
  (`createWorkerWebFetcher`).
- The denylist test in the same file, `it('refuses loopback and internal names with zero
  connections, in every mode', ...)`, additionally proves a private/loopback target is refused
  with **zero** TCP connections in every allow-list mode, at the real transport level.

So this board task's literal acceptance is already satisfied by merged, reviewed (ADR-0014:
architect, security-reviewer, typescript-reviewer, all opus, `docs/tasks/8.2d/handoff.md`), and
currently-running code. There is no `fetch`/undici call left anywhere in `packages/ingest` or
`apps/worker/src/webLink` that could resolve a host a second time; `webFetch.ts`'s own header
comment states the invariant explicitly ("A name is resolved ONCE per hop... The transport
connects to exactly that address, with no second lookup").

## What this plan actually asks the builder to do

Not a rewrite — a **verification and closing pass**, since re-deriving a design the codebase
already has correctly would be wasted work and risk regressing it. No source file is expected to
change. If the builder's reading of the current code or a fresh test run turns up an actual gap
(e.g. a code path that still calls a resolver twice, or a family/IPv4-vs-IPv6 case the existing
tests don't cover), fix it in the same PR and say so in the handoff; otherwise close the task with
evidence only.

### Files to create
- `apps/worker/src/webLink/pinnedTransport.rebinding.test.ts` — one additional end-to-end test,
  run against the *real* `createPinnedTransport` and a local `node:http` server (as
  `pinnedTransport.test.ts` already does), that answers the board text as literally as possible
  at the transport layer rather than only at the fetcher layer: a fake `resolveHost` used by
  `createWorkerWebFetcher` returns a public address for the check, and a **second**, independent
  DNS lookup aimed at the same host name (performed directly in the test, standing in for "what a
  rebinding attacker's nameserver would answer on a second query") returns a private/loopback
  address; assert (a) the fetch still succeeds (or the hop is refused, for a redirect-to-private
  case) using only the first, checked address, (b) the local server that stands in for the
  private/loopback target sees **zero** connections, and (c) `pinnedRequestOptions(req).lookup`
  called with any hostname and any options always yields the pinned address, never the host's
  real possibly-changed address — closing the same property `pinnedLookup`'s unit test already
  shows, but end to end through a real socket. This is additive assurance over the existing
  `webFetch.test.ts` test (which proves the fetcher-level invariant with a mocked transport); it
  is not required to pass acceptance (that evidence already exists) but makes the specific board
  wording ("a test where...") point at a file purpose-built for exactly this task, and protects
  against a future change to `pinnedLookup`/`pinnedRequestOptions` silently reopening the gap.
- `docs/tasks/5.1a/handoff.md` (written by the builder at the end, not this plan).

### Files to modify
- None expected. If the new test (or a careful re-read of `webFetch.ts` / `pinnedTransport.ts`)
  finds a real gap, the fix is scoped to whichever of these existing files it's in:
  - `packages/ingest/src/fetch/webFetch.ts` (`checkTarget`, the per-hop pin)
  - `packages/ingest/src/fetch/address.ts` (public-range checks)
  - `apps/worker/src/webLink/pinnedTransport.ts` (`pinnedLookup`, `pinnedRequestOptions`)
  Any such fix must keep every existing test in `packages/ingest/test/fetch/**` and
  `apps/worker/src/webLink/**.test.ts` green; do not weaken an existing assertion to make a new
  one pass.

### Out of bounds
- Any change to `packages/contracts/**` (none needed; this task carries no new types).
- Any change to `docs/adr/0014-web-link-egress.md` (ADR-0014 already describes this exact design;
  if the builder's reading finds the ADR text itself wrong or incomplete, flag it as an open
  question rather than editing the ADR in this PR — an ADR edit needs architect + security +
  typescript review per CLAUDE.md rule 2, which this task's scope doesn't plan for).
- Robots.txt, allow-list policy, redirect-hop count, byte caps, YouTube handling — all unrelated
  to the rebinding gap and already covered by 8.2d/8.2e/8.2g-l's own tests.
- `apps/worker/src/ingest/**` (the processor that calls `createWorkerWebFetcher`) and
  `apps/web/app/api/**` (the route that saves a web-link job) — unrelated to this gap.

## Design (already in place; restated for the builder's reading, not to be re-derived)

1. **Where the address is pinned for every request.** `packages/ingest/src/fetch/webFetch.ts`'s
   `createWebFetcher(opts).fetchPage` loop: for each hop, call `checkTarget(current, signal)`,
   which resolves the host exactly once through the injected `opts.resolveHost` (production:
   `systemResolveHost`, `packages/ingest/src/fetch/address.ts`, a direct c-ares `Resolver` query
   for A and AAAA, not `getaddrinfo`/`/etc/hosts`), requires every returned address to be public,
   and returns `{ address: addresses[0], family }`. That `Target` — never the host name again —
   is passed straight to `opts.transport` (the `PinnedTransport` port) as `TransportRequest.address`
   / `.family`.
2. **How it stays pinned through to the actual socket.** The production `PinnedTransport`
   (`apps/worker/src/webLink/pinnedTransport.ts createPinnedTransport`) calls
   `https.request(req.url, pinnedRequestOptions(req), cb)`, where `pinnedRequestOptions` sets
   `lookup: pinnedLookup(req.address, req.family)`. Node's own `lookup` option, when supplied,
   fully replaces its internal DNS step for that request — Node never asks the OS resolver again
   for this connection. `autoSelectFamily: false` additionally stops Node's Happy-Eyeballs logic
   from trying any address this `lookup` didn't offer. TLS still verifies the certificate against
   the URL's own host name (via `servername`/implicit SNI), so a pinned connection can't be used
   to bypass certificate checking — only to stop the *address* chosen for the TCP connection from
   being re-resolved.
3. **Redirects.** Each hop of `fetchPage`'s loop calls `checkTarget` again on the redirect's new
   URL, so hop 2 gets an independent check-then-pin, never the hop-1 pin carried forward to a
   different host.
4. **IPv4 and IPv6, A and AAAA.** `address.ts` parses both address families and checks both
   against the public-range tables (RFC 1918, CGNAT, link-local/metadata, unique-local, doc/bench,
   multicast, reserved, NAT64, 6to4, Teredo, IPv4-mapped IPv6). `systemResolveHost` queries A and
   AAAA in parallel and returns every public answer from both; `checkTarget` requires **all** of
   them to be public (any private answer in either family refuses the whole hop) and pins
   `addresses[0]` (A first by construction) with its matching `family`. `pinnedLookup` echoes that
   exact `family` back to Node so the socket opened matches the family actually checked.
5. **Fail-closed shape.** A resolver failure (anything except `ENOTFOUND`/`ENODATA`/`ENONAME`,
   which mean "no such name" and refuse the hop) is a retryable `provider_error`, never treated as
   "no addresses so allow it". An unresolvable, over-deadline, or any-answer-private host never
   reaches the transport at all (`checkTarget` throws before `opts.transport` is called).

## Tests (all already fake resolvers / local test servers; no real network)

Existing, already proving the acceptance (run them, don't rewrite them):
- `packages/ingest/test/fetch/webFetch.test.ts` — `'a DNS-rebinding resolver (public, then
  loopback) never yields loopback to the transport'` (fake `resolveHost`, fake `transport`); the
  whole `describe('createWebFetcher: the pinned address')` block (pins first of several answers,
  v6 family, per-hop re-pin on redirect, IP-literal direct connect with no lookup).
- `packages/ingest/test/fetch/address.ts` / `address.test.ts` — every public/private range table,
  both families.
- `apps/worker/src/webLink/pinnedTransport.test.ts` — real `node:http` local server, host not in
  DNS, `lookup` pins the address; gzip/deflate/br decompression counted against the cap;
  certificate/SNI options asserted via `pinnedRequestOptions`.
- `apps/worker/src/webLink/pinnedTransport.tls.test.ts` — certificate checking stays on.
- `apps/worker/src/webLink/index.test.ts` — `'refuses loopback and internal names with zero
  connections, in every mode'`, `'a listed public host is fetched through the pinned transport'`
  (asserts `local.pinned` is the checked address), via the real composition `createWorkerWebFetcher`.
- `apps/worker/test/ingest.int.test.ts` — the worker's ingest pipeline exercising the same fetcher.

New in this task (additive, not required to pass acceptance but closes the loop end to end):
- `apps/worker/src/webLink/pinnedTransport.rebinding.test.ts`:
  1. Start a local `node:http` server standing in for the real, public target, and a second local
     server standing in for a would-be private/loopback target the rebinding attacker wants hit.
  2. Build a `createWorkerWebFetcher` whose `resolveHost` returns the first server's loopback
     test address once (treated as "the public answer" by relaxing nothing — the test documents
     that in production this would be a real public address; the point under test is the
     mechanism, so a literal public range is not required here, matching how
     `pinnedTransport.test.ts` already tests against `teacher-site.test` with no real DNS entry).
  3. Assert `pinnedLookup` (unit-level, already covered) **and** the end-to-end fetch both land
     only on the pinned server; the stand-in "private" server gets zero connections even when a
     helper simulates what a second lookup of the same host name would now return.
  4. Assert a redirect hop whose `resolveHost` answers with a private address is refused
     (`forbidden`), with zero connections to that hop's target, proving the per-hop re-check
     fails closed rather than reusing hop 1's pin.
- No test imports `undici`, performs a real DNS query, or reaches the public internet; both
  servers bind `127.0.0.1` on an ephemeral port, same pattern as `apps/worker/test/webLinkServer.ts`.

## Risky paths touched

Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
- `apps/worker/src/webLink/pinnedTransport.rebinding.test.ts`, and any in-scope fix to
  `packages/ingest/src/fetch/{webFetch,address}.ts` or `apps/worker/src/webLink/pinnedTransport.ts`
  — **none of these paths appear in risk-paths.txt's globs** (`packages/ingest/**` and
  `apps/worker/src/webLink/**` are not listed; only `apps/worker/src/alerts/**` is a worker risk
  path, and that's the safety-alert group, unrelated). `packages/contracts/**` and `docs/adr/**`
  are not touched (no ADR edit planned). So the merge gate's risky-path check does **not**
  require named reviewers for this PR.
- Even so, this is an SSRF/DNS-rebinding fix on network egress — the kind of change the lead
  already asked `security-reviewer` to review once at 8.2d (ADR-0014, `risk: high`). Recommend the
  PR still requests `security-reviewer` and `code-reviewer` by choice (not gate-required), given
  the task's own framing ("DNS rebinding... pin the connection"), and that the handoff logs a
  `risk: medium` decision either way (`risk: high` only if an actual code fix to the pin lands,
  matching 8.2d's own `risk: high` entries for the same mechanism; `risk: low` if the PR is
  evidence-only with the one new test, since nothing with user-facing behaviour changes).

## Open questions for the human

- **This task's acceptance already appears to be met by merged code (8.2d/8.2e, 22 Oct 2026),
  before 5.1a was ever picked up from the board.** Recommend: close 5.1a as done with the evidence
  above plus the one new end-to-end test, rather than treating it as a build task that produces
  new source. Not a blocker — the builder can proceed and simply document this if the human
  doesn't say otherwise first; flagging it in `.claude/blockers.md` per CLAUDE.local.md so the
  human can confirm or redirect without stalling the build.
- If the human instead wants the gap re-verified by a from-scratch design review (e.g. because
  8.2d predates this exact board wording and the lead wants independent confirmation before
  closing it), that changes this plan's Phase A from "verify + one additive test" to a fuller
  audit; no code is expected to change either way unless the audit finds a real gap.

## Phases

One phase; this is a verification pass plus one new test file, not a new feature.

### Phase A — Verify the existing pin closes the gap; add one end-to-end rebinding test
**Create:** `apps/worker/src/webLink/pinnedTransport.rebinding.test.ts`.
**Modify:** none expected (see "Files to modify" above for the narrow fix path if the builder's
reading or the new test finds a real gap).
**Tests first:** since no new production code is expected, "tests first" here means: read
`webFetch.ts`/`address.ts`/`pinnedTransport.ts` and their existing tests fully before writing the
new test, confirm every existing assertion still holds (run the full `@edmate/ingest` and
`@edmate/worker` suites once, unchanged, before adding anything), then add the new rebinding test
and confirm it is red for the right reason if the pin is temporarily disabled (e.g. temporarily
hardcode `pinnedLookup` to call the real resolver, confirm the new test fails, then revert) before
treating it as a true regression guard.
**State after this phase:** acceptance evidence assembled in `docs/tasks/5.1a/handoff.md`, citing
the existing tests by name plus the new one; `python3 .claude/skills/board/board.py show 5.1a`
still shows `status: planning` until the lead marks it done at merge (per CLAUDE.md rule 6/8, the
lead merges and logs the decision; the builder does not edit the board).

## Decisions (draft, to copy into the handoff `## Decisions`)

### 5.1a The DNS-rebinding gap was already closed by 8.2d; this task is verification, not a rewrite · decided by planner · risk: low
Decided: no new pinning mechanism is designed; `packages/ingest/src/fetch/webFetch.ts`'s
`checkTarget` (resolve once, pin the first public answer, per hop) and
`apps/worker/src/webLink/pinnedTransport.ts`'s `pinnedLookup`/`pinnedRequestOptions` (a `lookup`
that always answers with the pinned address, `autoSelectFamily: false`, `agent: false`) already
implement exactly what the board task asks for, reviewed under ADR-0014 (architect,
security-reviewer, typescript-reviewer, 22 Oct 2026).
Why: re-deriving the design would duplicate reviewed, running code and risks introducing a
regression in a security-sensitive path for no benefit; the task's own evidence bar ("a test
where the second DNS answer is private fails closed... the connection uses the address that
passed the check") is already met by `webFetch.test.ts`'s and `pinnedTransport.test.ts`'s/
`index.test.ts`'s existing tests.
Alternatives: write a fresh custom-lookup/agent mechanism as if none existed (the board text's own
phrasing, taken from before 8.2d landed). Rejected: would be redundant with, and risks conflicting
with, the already-reviewed 8.2d design.
Reversible: yes — if the human disagrees after reading the evidence, the task reopens as a design
task instead.

## Budget
Budget: 35 tool calls (1 phase, packages/ingest + apps/worker)

## Allowed tools
Read, Grep, Glob, Write (new test file only), Bash (tests only: `corepack pnpm turbo run
typecheck lint test --filter=@edmate/ingest... --filter=@edmate/worker...`, and
`python3 .githooks/secret-scan.py --all`)

## Exit conditions
Status: DONE when the full `@edmate/ingest` and `@edmate/worker` suites pass unchanged, the new
`pinnedTransport.rebinding.test.ts` passes and was confirmed red-for-the-right-reason, and
`docs/tasks/5.1a/handoff.md` cites the acceptance evidence above by exact file and test name.
Status: PARTIAL if the builder's reading finds a real gap needing a source fix past the narrow
files listed under "Files to modify" (stop and hand back rather than widening scope), or if tool
calls pass about 35 with the evidence still not assembled.
