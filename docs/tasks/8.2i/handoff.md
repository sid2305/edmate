# Handoff: 8.2i

Status: DONE (Phase C)

## Decisions
None.

## Phase C

Summary of what changed:
- `apps/worker/src/webLink/pinnedTransport.ts` (`pinnedRequestOptions`): the `Host` header is now
  set explicitly from the same `bareHostName(host)` value SNI's `servername` already uses, with
  the request's port appended when it is not the URL's default (`req.url.port`). Previously the
  `host` header was left to Node's own derivation from `req.url.hostname` untouched, which kept a
  trailing dot that SNI already strips, so the two could disagree on a host like
  `teacher-site.test.`.
- `apps/worker/src/webLink/pinnedTransport.test.ts`: added a new red-then-green case, `'the Host
  header drops every trailing dot too, matching SNI (8.2i)'`, asserting
  `options.headers.host === 'teacher-site.test'` and that it equals `options.servername` for a
  trailing-dot host. Two pre-existing tests (`'lands on the pinned address...'` and `'fetches a
  page end to end...'`) asserted the old Node-auto-derived `Host` header, which included whatever
  port the local test server happened to be using even when the real request URL carried no
  explicit port (default https 443); updated both to expect the real URL's authority instead
  (`teacher-site.test`, no port), since that is what `Host` should reflect — not an artifact of the
  test harness's local-port redirect.
- `packages/ingest/src/fetch/address.ts` (`systemResolveHost`): comment-only — added a sentence to
  the doc comment above the function describing the all-transient-failure path explicitly (every
  query settles rejected, `graceOver` never resolves, both queries still awaited through
  `Promise.allSettled`, thrown code is the first non-`NO_SUCH_NAME` rejection code or `ENOTFOUND`
  as the safe fallback). No behaviour change, no new test.
- `docs/adr/0014-web-link-egress.md`: three wording edits, prose only, matching the code as it
  stands:
  - Decision 1: SNI/certificate wording now says the URL's host name has every trailing dot
    stripped and an empty-label host is refused as invalid, plus a new sentence noting the `Host`
    header (`apps/worker/src/webLink/pinnedTransport.ts`'s `pinnedRequestOptions`) uses the same
    stripped name, so SNI and `Host` agree.
  - Decision 6 (Time): now says the resolver allows 2 s per query and 2 tries (at most 6 s per
    family), and that once one family answers with addresses the other gets 500 ms before being
    cancelled — matching `RESOLVER_OPTIONS` and `FAMILY_GRACE_MS` in
    `packages/ingest/src/fetch/address.ts`.
  - Decision 9 / consequences: added a line noting a link job gets 2 attempts (file jobs keep 5),
    so a slow site can hold the one ingest slot for at most two fetch deadlines.

Red-then-green evidence:
```
$ corepack pnpm --filter=@edmate/worker exec vitest run src/webLink/pinnedTransport.test.ts -t "Host header"
AssertionError: expected undefined to be 'teacher-site.test'
Tests  1 failed | 20 skipped (21)
```
After the `pinnedRequestOptions` fix and the two pre-existing-test updates:
```
$ corepack pnpm --filter=@edmate/worker exec vitest run src/webLink/pinnedTransport.test.ts
Test Files  1 passed (1)
     Tests  21 passed (21)
```

### Decisions

#### 27 Oct 2026 · 8.2i Host header carries the request's port when non-default · decided by builder · risk: low
- Decided: `pinnedRequestOptions` sets `headers.host` to `bareHostName(host)`, with
  `:${req.url.port}` appended only when `req.url.port` is non-empty (i.e. not the URL's default
  port), rather than the plan's literal `headers: { ...req.headers, host }` (bare host, no port
  logic at all).
- Why: the plan's suggested one-line fix drops the port entirely, which would have broken two
  passing 8.2h tests that depend on `req(port)` building an explicit non-default port into the URL
  (`http://teacher-site.test:${port}/...`) and asserting the `Host` header still carries it — real
  HTTP semantics require `Host` to carry a non-default port, and SNI's `servername` never carries
  a port either way (TLS has no notion of one), so this doesn't put SNI and `Host` out of sync.

#### 27 Oct 2026 · 8.2i two pre-existing Host-header test assertions updated · decided by builder · risk: low
- Decided: updated `'lands on the pinned address for a host that is not in DNS...'` and `'fetches
  a page end to end, pinned to the checked address'` to expect `Host: teacher-site.test` (no port)
  instead of the previous `teacher-site.test:<local test server port>`.
- Why: before this fix, Node derived `Host` from whatever target it actually connected to; in the
  `toLocalServer` test helper that target is a locally-redirected port even when the real teacher
  URL (default https, no explicit port) carries none. `Host` should reflect the real request URL's
  authority, not an artifact of the test harness's local-port redirect, so the old assertion was
  testing the previous bug's exact byproduct. The other 8.2h test (`req(port)`, explicit port in
  the URL itself) is unaffected and still expects the port, which the new port-aware fix preserves.

### Gate
```
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/worker --filter=@edmate/ingest
Tasks:    14 successful, 14 total
```
(Note: `--filter=@edmate/worker... --filter=@edmate/ingest...`, which also runs
`@edmate/harness`'s tests as a dependency, hit two timing-sensitive `packages/harness` test
flakes — `modelRequest.test.ts`'s linear-time check and `runner.test.ts`'s 2000ms timeout —
unrelated to any file this phase touched; `packages/harness` is out of bounds for this task and
both tests pass in isolation on a re-run.)

```
$ corepack pnpm exec prettier --check apps/worker/src/webLink/pinnedTransport.ts apps/worker/src/webLink/pinnedTransport.test.ts packages/ingest/src/fetch/address.ts docs/adr/0014-web-link-egress.md
All matched files use Prettier code style!
```

```
$ python3 .githooks/secret-scan.py --all
(clean; see below)
```

### Budget
Phase C tool calls used: 24
