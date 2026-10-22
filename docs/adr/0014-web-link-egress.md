# ADR-0014: Web-link egress

## Status

Accepted (22 Oct 2026, by the lead after review by architect, security-reviewer and typescript-reviewer). Task 8.2b Phase A (board 8.2d). Amended in 8.2e (22 Oct 2026, after review by architect, security-reviewer and typescript-reviewer): 3fff::/20 refused; every trailing dot stripped before the name and IP-literal checks; names resolved with a cancellable `dns.promises.Resolver`. Amended in 8.2c (22 Oct 2026, after review by architect, security-reviewer and typescript-reviewer): B-47 answered: YouTube material comes from the owner's exported caption file; the pilot allow-list mode is `*`.

## Date

2026-10-22

## Context

- Task 8.2b lets a teacher add a web link in the upload centre. The worker downloads the page and indexes it. This is the first production code that connects to hosts the operator doesn't control, chosen by a user. That makes the worker a target for server-side request forgery (SSRF): a link could point at the worker's own network, Postgres, Redis or a cloud metadata service.
- ADR-0005 Decision 5 set the precedent of recording an egress (SSRF) policy as an ADR: the transcriber's exact-host allow-list, no redirect to another host, and an empty list refuses everything.
- `packages/ingest/src/fetch/webFetch.ts` (task 5.1) already checks https, userinfo, an exact-host allow-list and that every resolved address is public, and it re-checks each redirect hop. But then it calls `fetch(url)`, which looks the name up a second time. A host whose DNS answers with a public address first and 127.0.0.1 second (DNS rebinding) passes the check and then connects to loopback. Nothing calls this fetcher in production yet, so the gap is closed before anything does.
- No `packages/contracts` change and no new dependency. This ADR records a security policy.

## Decision

1. **Resolve once per hop and connect only to the checked address.**
   - Each hop looks the host up once and gets every A and AAAA address. If one family fails transiently while the other answers, the answers that came back are judged and one is pinned (the connection is still pinned, so this is safe). The hop is refused if any address is not public. Otherwise one checked address (the first) is pinned.
   - A transport port (`PinnedTransport`) gets the URL and the pinned address and connects to exactly that address, with no second lookup. In production it is `node:https.request` with a `lookup` that always returns the pinned address (both the single-address and the `all: true` forms), `autoSelectFamily: false` and `agent: false`.
   - TLS SNI and the certificate check use the URL's host name. Certificate checks are never turned off.
   - An IP-literal host is checked after every trailing dot is stripped (so `127.0.0.1..` is judged as `127.0.0.1`) and, if public, connected to directly with no lookup. It sends no SNI (RFC 6066 forbids an IP address there); the certificate is still checked.
2. **Refused addresses.** Only public unicast passes.
   - IPv4: 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, and 224/4 and everything above it.
   - Metadata services are covered by these ranges: 169.254.169.254 (AWS, GCP, Azure), 100.100.100.200 (Alibaba), 192.0.0.192 (Oracle), fd00:ec2::254 (AWS IPv6, inside fc00::/7), and `metadata.google.internal` (name denylist).
   - IPv6: only 2000::/3 passes, minus Teredo 2001::/32, benchmarking 2001:2::/48, ORCHID 2001:10::/28 and 2001:20::/28, documentation 2001:db8::/32 and 3fff::/20 (RFC 9637, added in 8.2e), and 6to4 2002::/16. So ::, ::1, fe80::/10, fc00::/7, ff00::/8, NAT64 64:ff9b::/96 and 64:ff9b:1::/48, 100::/64 and the ::/96 compatible form are all refused.
   - IPv4 inside IPv6 (`::ffff:a.b.c.d`, dotted or hex) is judged as its IPv4 address.
   - WHATWG URL parsing turns other IPv4 spellings into dotted form before the check (decimal `2130706433`, hex `0x7f.1`, octal, short forms).
   - A name that resolves to any non-public address is refused, even if its other answers are public.
   - Names refused before any DNS lookup (after stripping every trailing dot, so `localhost..` is refused too): `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa` and any single-label name.
3. **https on port 443 only.** `http:` is refused. An explicit port other than 443 is refused, so links can't be used to scan ports. A user name or password in the URL is refused. The URL is at most 2048 characters.
4. **Redirects.** They are followed by hand, at most 3. Every hop goes through rules 1 to 3 again: look up again, check again, pin again. A redirect from https to http, or one with no `Location`, fails.
5. **Size.** A page is capped at 5 MB, counted on decompressed bytes.
   - The request asks for `accept-encoding: identity`. If the server compresses anyway (gzip, deflate, br), the transport decompresses it as a stream with `node:zlib`, and the cap counts the output, so a compression bomb stops at 5 MB. `x-gzip` is treated as gzip. After decompressing, the transport drops `content-length` and `content-encoding`, so the fetcher's size and early-end checks see only the decompressed body.
   - Any other encoding is refused.
   - A declared `content-length` over the cap is refused before the body is read.
   - The 20 MB cap for uploaded files is unchanged.
6. **Time.** 15 s in total across all hops, DNS lookups included. The resolver allows 5 s per query and 2 tries, inside that 15 s. Each hop also has 5 s to connect and send its response headers.
7. **Content types.** Only `text/html` and `application/xhtml+xml`. Anything else, including a linked PDF, fails as `unsupported`.
8. **No cookies or credentials.**
   - Request headers are a fixed list: `user-agent: EdmateBot/0.1`, `accept` and `accept-encoding: identity`.
   - No `cookie`, no `authorization`, no proxy and no keep-alive agent.
   - `Set-Cookie` is never read or sent back.
   - robots.txt is not checked: this is one fetch, started by the teacher, of a page they chose, like a link preview.
9. **The URL is never logged or stored in Postgres.**
   - The full URL travels only in the ingest job payload in Redis, and only while the job is queued and retried. A link job is removed from Redis when it fails for the last time, so the URL doesn't sit in BullMQ's failed set for `FAILED_JOB_TTL_SECONDS` (7 days); the document row keeps only the fixed failure reason (built in Phase B, 8.2e).
   - It never appears in a log line, trace, error message, dead-letter entry or database column. Errors carry fixed words and codes only.
   - When the teacher gives no title, the document's title is the host only, never the path, query string or fragment: a path can carry a share token (built in Phase C, 8.2f).
10. **Allow-list modes** (`EDMATE_WEB_LINK_HOSTS`, worker env):
    - unset or empty: every link is refused (fail closed);
    - a comma list: exact host match only;
    - exactly `*`: any host that passes rules 1 to 3.

    A malformed entry fails at startup with a code (never the value) and turns off web links only. The example env and the dev compose file use `*`. The pilot value is `*` (B-47, answered 22 Oct 2026). In every mode rules 1 to 9 still apply: the list can only narrow what is allowed, never widen it.
11. **YouTube is not fetched.** `youtube.com`, `www.`, `m.` and `music.youtube.com`, `youtu.be`, `youtube-nocookie.com` and `www.youtube-nocookie.com` are refused when a link is added (400 with fixed words pointing to the caption file (.vtt or .srt) the owner exports from YouTube Studio, or the video file). The worker refuses them too, as `unsupported`. B-47 (22 Oct 2026): YouTube material comes only from the owner's exported caption file or the video file; Edmate never calls YouTube. Any YouTube fetch needs its own ADR.

## Alternatives

- **Today's check-then-`fetch`.** Not chosen: DNS rebinding gets past it (see Context).
- **A third-party fetch proxy** (a hosted link-preview or scraping service). Not chosen. It moves SSRF off our network, but it sends every teacher link, which may hold a token, to a vendor, and it adds a key, a cost and a new outbound integration. A self-run egress proxy is more infrastructure than a pilot needs. Revisit at scale.
- **A new dependency** (an SSRF-filter library, or undici's `Agent({ connect: { lookup } })`). Not chosen. It would mean less code, but it puts a supply-chain dependency on the most security-critical path, and we would not own or test its range table. Node built-ins (`node:https`, `node:dns`, `node:zlib`) are enough, and `address.ts` is already tested range by range.
- **No egress at all** (the teacher saves the page and uploads it as a file). Not chosen. There is no SSRF risk, but it drops a PRD feature and adds steps for teachers. File upload stays available as the fallback.
- **The exact-host list as the only mode.** Not chosen as the default: teachers paste links to any article. It stays available as a mode.

## Consequences

- In `*` mode the worker can reach any public https site on port 443. What remains:
  - the operator's own public endpoints are reachable like any other public site;
  - a self-hoster whose internal network uses public IP space is not protected by the range check.

  The deploy guide should add a network egress rule as a second layer: the worker reaches only public port 443, plus its own database, Redis and object storage. Tracked as board task 8.2g, before the pilot.
- Some sites will fail with a fixed reason: pages that need cookies or JavaScript, sites that block bots, http-only sites, other ports, and non-HTML pages.
- Only the first checked address is tried, with no fallback to another address. A host whose first address is down fails, and it may fail again on retry.
- Names are resolved with a `dns.promises.Resolver` (A and AAAA queries, its own timeout), not `dns.lookup`, and the resolver is cancelled when the deadline wins, so a slow-DNS link never holds a libuv thread past the deadline (8.2e). It skips `/etc/hosts` and search-domain expansion. A name with no answer and a name that answers with a non-public address get the same refusal and words, so a teacher can't probe which internal names exist; a transient DNS failure (SERVFAIL, timeout) is retryable.
- A failed link can't be retried in place. The teacher deletes it and adds it again (lead answer Q3).
- Tests never touch the real internet (rule 4): a fake resolver and fake transport in `packages/ingest`, a local `node:http` server on 127.0.0.1 for the worker transport, and real-TLS tests against 127.0.0.1 with a throwaway self-signed certificate made by `openssl` at test time (they fail, not skip, when `openssl` is missing).
- Changing a range, a mode, a limit or the YouTube rule takes an ADR that amends or supersedes this one.
- **Rollback:**
  - Phase A adds code that nothing calls, so reverting it is free.
  - After Phases B and C, setting `EDMATE_WEB_LINK_HOSTS` to empty stops all web egress with no code change: new links end as `failed/forbidden`.
  - Reverting the code needs no migration. Link documents are ordinary `documents` rows with a `.link` storage key and no stored object, so they can be deleted or left in place.

## Reviewers

architect, security-reviewer, typescript-reviewer (opus). The lead approves and logs it `risk: high`. Phases B and C (8.2e, 8.2f) also get security-reviewer. The 8.2e amendment was reviewed by architect (opus), security-reviewer (opus) and typescript-reviewer (opus). The 8.2c amendment (8.2l) was reviewed by architect (opus), security-reviewer (sonnet) and typescript-reviewer (opus).
