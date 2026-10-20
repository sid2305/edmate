# Task 5.1 handoff: document ingestion (Phase A of 3)

Status: PARTIAL
Branch: `m5/5.1-document-ingestion`
Worktree: `.claude/worktrees/agent-ad6c76935da57cf25`
Plan: `docs/tasks/5.1/plan.md` (Phase A only was in scope for this build)

## Left to do
- **Phase B:** PDF (`pdfjs-dist`), 4 PDF fixtures, wire `'pdf'` into `parseDocument`.
- **Phase C:** DOCX (`mammoth` → `parseHtml`) and PPTX (`jszip` + `fast-xml-parser`), 8 fixtures,
  wire `'docx'`/`'pptx'`, and the closing `test/parse/all-fixtures.test.ts` over all 20 files.

## Acceptance evidence so far

| Item | Evidence |
|---|---|
| Markdown + web-link fixtures parse (8 of 20) | `test/parse/markdown.test.ts`, `test/parse/html.test.ts`: all 4 Markdown and 4 recorded-HTML fixtures parse; each test asserts the full `units` array (exact `text` and `locator`). |
| Every unit keeps its heading | Exact locators asserted, e.g. `"Introduction > Variables > Naming variables"`, `"How Plants Make Food > What plants need"`; text before any heading gets the source title; empty or heading-only input throws `IngestError('validation')`, never an empty document. |
| No contracts change | `git diff origin/main...HEAD --stat` touches only `packages/ingest/**`, `pnpm-lock.yaml` and this handoff. `ParsedUnit`/`ParsedDocument` live in `packages/ingest/src/types.ts`. |
| No network in tests | `test/setup/no-network.ts` replaces the global `fetch` with a rejecting stub; `test/no-network.test.ts` fails if any test file imports `http/https/http2/net/tls/dgram/dns/undici`. The fetch tests inject a fake `fetch` and `resolveHost`; the DNS wrapper test mocks `node:dns/promises`. |
| SSRF-safe fetch | `test/fetch/webFetch.test.ts` and `test/fetch/address.test.ts`: https only; no userinfo; exact host:port allowlist (empty refuses all, suffix is no match); IP literals checked as given (decimal `2130706433`, `[::ffff:127.0.0.1]`, metadata `169.254.169.254`, `fd00:ec2::254`); names resolved and **every** address must be public; the check is repeated on every redirect hop (off-allowlist, http, and allowlisted-but-now-internal redirects all refused; at most 3 hops); HTML only; byte cap on declared length and while streaming; truncated body caught; the URL (with a query token marker) never appears in an error message or `toJSON`. |
| Harness stays pure | `packages/harness/**` untouched. |
| Repo stays clean | `python3 .githooks/secret-scan.py --all` exits 0. Fixtures are self-written lesson text (fractions, algebra, water cycle, geometry, plants, decimals, magnets, times tables); hosts are `*.example.org`. |
| Coverage | `src/**` 100% lines/statements/functions, 98.18% branches; `src/fetch/**` held to 100% on all four by `vitest.config.ts`. |

```
$ corepack pnpm turbo run typecheck lint test --filter=...@edmate/ingest --force
@edmate/ingest:test:       Tests  140 passed (140)
@edmate/ingest:test: All files          |     100 |    98.18 |     100 |     100 |
@edmate/ingest:test:  src/fetch         |     100 |      100 |     100 |     100 |
 Tasks:    3 successful, 3 total

$ python3 .githooks/secret-scan.py --all
(exit 0)
```

## Changes
- `packages/ingest/package.json`: deps `markdown-it` 15.0.3, `cheerio` 1.2.0; dev deps `vitest`/`@vitest/coverage-v8` 5.0.5, `@types/node` 22.20.5 (same pins as the gateway); `test` script; `./testing` export.
- `packages/ingest/tsconfig.json` (now covers `test/` and configs), new `tsconfig.build.json`, `vitest.config.ts`, `test/setup/no-network.ts`.
- `src/types.ts` (`ParsedUnit`, `ParsedDocument`, `MAX_DOCUMENT_BYTES` = 20 MB), `src/errors.ts` (`IngestError`).
- `src/parse/sections.ts` (shared heading-path builder), `src/parse/markdown.ts`, `src/parse/html.ts` (`parseHtml`, `htmlTitle`).
- `src/fetch/address.ts` (`isPublicAddress`, `isIpLiteral`, `systemResolveHost`), `src/fetch/webFetch.ts` (`createWebFetcher`, `normaliseAllowedHosts`, `redactUrl`).
- `src/testing/stubWebFetcher.ts` (+ `index.ts`), `src/document.ts` (`parseDocument`, `parseWebLink`), `src/index.ts` barrel.
- Fixtures: `test/fixtures/markdown/*.md` (4), `test/fixtures/html/*.html` (4).

## Deviations from the plan
- Tests live in `packages/ingest/test/**` (the gateway's layout and vitest `include`), not beside the sources as `src/**/x.test.ts`.
- Redirects may go to **any allowlisted host** over https, not only the same host. This follows the plan's acceptance row ("no redirect off the allowlist"); the design section said "same host". Same-host-only would refuse the common `example.org` → `www.example.org` hop. Every hop still passes the full check (allowlist, https, public addresses).
- Added on the lead's instruction (beyond the plan's design): public-address checks on IP literals and on every resolved address, at each hop. The resolver is an injected `resolveHost` port (production: `systemResolveHost`).
- `parseDocument` refuses `pdf`/`docx`/`pptx` with `IngestError('unsupported')` until Phases B and C.

## Decisions

### 5.1 New ingest dependencies: markdown-it 15.0.3 and cheerio 1.2.0 · decided by tdd-guide (lead pre-approved the library choice, no ADR) · risk: medium
Decided: add `markdown-it` 15.0.3 (MIT, ships its own types) and `cheerio` 1.2.0 (MIT) to `packages/ingest`. Versions are the current npm `latest`, checked with `corepack pnpm view <pkg> version license` on 20 Oct 2026. HTML parsing imports `cheerio/slim` (htmlparser2), so the main entry's `fromURL`/undici network code is never loaded. Dev dependencies use the repo's existing pins (vitest 5.0.5, @vitest/coverage-v8 5.0.5, @types/node 22.20.5).
Why: these are the plan's Phase A libraries. Both are MIT, pure JS, and give the block and heading structure the locators need.
Alternatives: `remark`/`unified` (more packages for the same result); cheerio's full entry with parse5 (pulls in undici for no gain here).
Reversible: yes. Both are used only inside `src/parse/`.

### 5.1 Web fetch checks the addresses a host resolves to, before the fetch and on every hop · decided by tdd-guide · risk: medium
Decided: on top of the allowlist, an IP-literal host must be public. A host name is resolved through an injected `resolveHost`, and every address must be public, or the link is refused. Refused ranges: loopback, RFC 1918, CGNAT, link-local and metadata, unique-local, documentation, benchmarking, multicast, reserved, NAT64, 6to4, Teredo, and IPv4-mapped IPv6 whose IPv4 part is not public. Resolver failure or no answer gives `not_found`.
Why: the lead asked that private, loopback, link-local and metadata addresses be blocked, including after redirects and DNS resolution.
Residual risk: the check and the connection resolve the name separately, so a DNS-rebinding host could answer differently the second time. Closing that needs a transport that connects to the checked address (an undici `Agent` with a guarded `connect.lookup`, or `node:https` with a `lookup` hook) wired at the composition root. The allowlist limits the risk until then, because an attacker must control an allowlisted host's DNS. **Open question for the lead:** should that guarded transport be a Phase B/C item or its own board task?
Reversible: yes.

### 5.1 Locator and text shape for heading-tracked formats · decided by tdd-guide · risk: low
Decided: one `ParsedUnit` per section, meaning the text between two headings. Block elements become lines joined by `\n`, table rows become `cell | cell`, and image alt text is kept. An empty heading is ignored and leaves the path unchanged. Raw HTML in Markdown is dropped. In web pages, `nav`, `footer`, `aside`, `script`, `style`, `noscript`, `template`, `form`, `svg` and `iframe` are dropped. A later heading with the same path starts a new unit; it is never merged with the earlier one.
Why: the plan leaves unit size to 5.3's chunker. Per-section units keep each locator exact and the output small.
Reversible: yes.

### 5.1 IngestError codes are local to packages/ingest · decided by tdd-guide · risk: low
Decided: `IngestError` uses a local code union (`validation`, `unsupported`, `forbidden`, `not_found`, `input_too_large`, `rate_limited`, `provider_error`) shaped like `TranscriberError`, with no `cause` kept. It does not import `@edmate/contracts`'s `ErrorCode`.
Why: the package has no contracts dependency yet, and `unsupported` is not a contracts code. Whoever maps ingestion failures to API errors (8.x) can map them then.
Reversible: yes.
