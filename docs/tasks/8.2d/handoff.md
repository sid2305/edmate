# 8.2d handoff: pinned, SSRF-safe web fetcher and ADR-0014 (8.2b Phase A)

Status: DONE

- Branch: `m8/8.2d-pinned-fetcher` (built on local `work-82d`)
- Worktree: `.claude/worktrees/agent-af8414537c46f2d00` (repo-relative)
- Plan: `docs/tasks/8.2b/plan.md` (Phase A, with the lead answers of 22 Oct 2026)

## Summary
The web fetcher no longer checks a name and then lets `fetch` look it up a second time. Each hop
resolves the host once, inside the 15 s deadline. It refuses the hop if any answer isn't public and
pins the first answer. A `PinnedTransport` port then connects to exactly that address. The worker's
production transport is `node:https.request` with a `lookup` that always returns the pinned address.
It also sets `autoSelectFamily: false` and `agent: false`, sends a fixed header list and leaves
certificate checks on. SNI is the URL's host name, with no SNI for an IP-literal host. gzip, deflate
and br are decompressed as a stream, and `content-encoding` and `content-length` are dropped after
decompressing.

Also new:
- the `'any-public'` (`*`) mode;
- port 443 only;
- the host-name denylist, with a trailing dot stripped;
- the IANA 2001::/23 special blocks;
- a 5 MB decompressed page cap;
- a deadline that also covers DNS, the transport call and every body read;
- `checkWebLinkUrl`, the pure shape check that Phase C's route will share;
- `createWorkerWebFetcher(env)` with `EDMATE_WEB_LINK_HOSTS` parsing.

Nothing calls the new fetcher in production yet.

ADR-0014 is copied from the architect's draft (0014 was still free on `origin/main`). Its Status is
still Proposed. Decision 9 now follows the lead answers: the default title is the host only, and a
link job is removed from Redis on final failure (built in 8.2f and 8.2e).

## Files
- `docs/adr/0014-web-link-egress.md` (new, risky path: architect, security-reviewer, typescript-reviewer)
- `packages/ingest/src/fetch/linkUrl.ts` (new): `checkWebLinkUrl`, `webLinkRefusal`, `isYouTubeHost`, `isDeniedHostName`, `bareHostName`
- `packages/ingest/src/fetch/webFetch.ts`: `transport: PinnedTransport` replaces `fetch`, plus `TransportRequest`/`TransportResponse`, `WEB_PAGE_MAX_BYTES`, `WEB_FETCH_HEADERS`, `allowedHosts: string[] | 'any-public'`, deadline racing
- `packages/ingest/src/fetch/address.ts`: refuses 2001:2::/48, 2001:10::/28 and 2001:20::/28
- `packages/ingest/src/index.ts`: the new exports
- `apps/worker/src/webLink/pinnedTransport.ts`, `apps/worker/src/webLink/index.ts` (new)
- Tests: `packages/ingest/test/fetch/{webFetch,linkUrl,address}.test.ts`, `packages/ingest/test/fetch/urlTable.ts`, `apps/worker/src/webLink/{pinnedTransport,index}.test.ts`, `apps/worker/test/webLinkServer.ts` (a local node:http server on 127.0.0.1)

## Tests
No test touches the real internet. ingest uses a fake resolver and a fake transport, and its
no-network rule still passes. The worker tests use a local `node:http` server; the URL host
`teacher-site.test` isn't in DNS, so a request that arrives proves the pin.

Bypasses covered:
- DNS rebinding (public, then 127.0.0.1): the resolver is called once and the transport only ever sees the public address;
- a mix of public and private answers (v4 and v6);
- IPv4-mapped IPv6, dotted and hex;
- decimal, hex and octal IPv4 (`2130706433`, `0x7f.1`, `0177.0.0.1`, `0x7f000001`);
- a redirect to every refused URL, and https to http;
- a 4th redirect;
- ports 8443 and 80;
- userinfo;
- `localhost.` and `printer.local.`;
- a gzip bomb past 5 MB, both in ingest (zlib stream) and end to end through the real transport;
- a slow DNS answer past the deadline (no fetch, even when the answer arrives late);
- an IP-literal host (no `servername`).

The real composition refuses `https://127.0.0.1/`, `https://localhost/`, `https://localhost./`
and `https://[::1]/`, and a name that resolves to loopback, in all three modes. The local server
counts **0** connections.

Evidence:
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/ingest... --filter=@edmate/worker...` → `Tasks: 38 successful, 38 total`. ingest `src/fetch/**` is at 100% on lines, branches, functions and statements (enforced threshold).
- `python3 docs/adr/check-headings.py` → exit 0
- `python3 .githooks/secret-scan.py --all` → clean (no output)

## Deviations
- `checkWebLinkUrl`'s `displayTitle` is the **host only** (the plan said `host + path`), following the lead answer for Decision 9.
- `normaliseAllowedHosts` now refuses an entry with a port, because only 443 is allowed. It also refuses a `*` wildcard inside an entry, because exact match would silently never match. Only exactly `*` means any host.
- The fetcher, not just the transport, races every body read and the transport call against the deadline. A transport that ignores its signal still can't outlive the 15 s.
- `docker/env.example` isn't touched. Nothing reads the env var until 8.2e, which documents it with the compose change.

## Decisions
### 22 Oct 2026 · 8.2d ADR-0014 accepted; review MEDIUM and LOW findings go to 8.2e · decided by lead · risk: high
- Decided: ADR-0014 is Accepted, after architect, security-reviewer and typescript-reviewer (all opus) approved with no CRITICAL or HIGH findings. The lead made the ADR wording fixes (no SNI for IP literals, headers dropped after decompressing, x-gzip, 8.2g named, uncancellable DNS noted). The code MEDIUM and LOW findings are fixed in 8.2e before the fetcher runs on the production path: the timer crash in pinnedTransport, the orphaned promise in untilAborted, the exported redactUrl, repeated trailing dots, the cancellable resolver, explicit rejectUnauthorized, one DNS error message, 3fff::/20, retryable DNS errors and the cancel error mask.
- Why: nothing calls the fetcher in production until 8.2e, so no finding is reachable today, and 8.2e works in the same files.
- risk: high

### 22 Oct 2026 · 8.2d Web-link egress policy: pinned address per hop, ADR-0014 · decided by builder · risk: high
- Decided: The web fetcher resolves each hop once, inside the 15 s deadline. Every answer must be public, and the transport connects only to the first answer (`node:https` with a pinned `lookup`, `agent: false`, `autoSelectFamily: false`, SNI from the host name and none for an IP literal, certificate checks on). Further rules:
  - https on port 443 only, with no userinfo and at most 2048 characters;
  - a denylist of internal names (trailing dot stripped);
  - at most 3 redirects, each checked again;
  - HTML only, a 5 MB cap counted on decompressed bytes, and a fixed header list;
  - three allow-list modes: unset refuses everything, `*` allows any public host, or a list of exact hosts;
  - YouTube is refused as `unsupported`;
  - robots.txt isn't checked.

  ADR-0014 is written from the architect's draft with Decision 9 updated to the lead answers.
- Why: closes the DNS-rebinding gap between check and connect before anything in production calls the fetcher; ADR-0005 set the precedent of recording egress policy as an ADR.
- risk: high

### 22 Oct 2026 · 8.2d Allow-list entries are bare host names only · decided by builder · risk: low
- Decided: `EDMATE_WEB_LINK_HOSTS` entries with a port, a path, a `*` wildcard or an empty item fail at startup with the code `web_link_hosts_invalid`. The error never includes the value.
- Why: only port 443 is allowed, and an entry that could never match would silently refuse every link with no sign of why.
- risk: low

## Left to do (for 8.2e)
- Call `createWorkerWebFetcher(process.env)` in `apps/worker/src/index.ts`. Catch `WebLinkConfigError`, log its `code` and turn off web links only.
- Processor: run `checkWebLinkUrl` (YouTube → `failed/unsupported`, other refusals → `failed/forbidden`), then `parseWebLink` with the fetcher.
- Add the last-attempt rule.
- Remove link jobs on final failure, so the URL doesn't stay in Redis (ADR-0014 Decision 9).
- Document `EDMATE_WEB_LINK_HOSTS` in `docker/env.example` and `docker/compose.yaml` (`*` for dev).
- For 8.2f: use `checkWebLinkUrl(...).displayTitle` (host only) as the default title.

Tool calls used: 55 (harness count; the builder reported 38)
