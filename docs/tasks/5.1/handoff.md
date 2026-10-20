# Task 5.1 handoff: document ingestion (Phases A, B and C)

Status: DONE
Branch: `m5/5.1-document-ingestion`
Worktrees: Phase A `.claude/worktrees/agent-ad6c76935da57cf25`; Phases B and C `.claude/worktrees/agent-ae8c0798623478d22` (local branch `build-5.1bc`, pushed to `m5/5.1-document-ingestion`)
Plan: `docs/tasks/5.1/plan.md`

## Acceptance evidence

| Item | Evidence |
|---|---|
| All 20 fixtures parse (4 each of PDF, DOCX, PPTX, Markdown, web page) | `test/parse/all-fixtures.test.ts`: lists the fixture folders on disk, checks there are exactly 20 (4 per format) and that each is pinned; parses each through the public `parseDocument` (web pages through `parseWebLink` with the stub fetcher) and asserts its full locator list in order, a non-empty text and locator for every unit, and `page N` / `slide N` shapes for PDF and PPTX. |
| Every unit keeps its page, slide or heading | PDF: `"page 1"`, `"page 2"`, … by real page number; a blank page gives no unit and later pages keep their number (`forces-blank-middle.pdf` → `page 1`, `page 3`). PPTX: `"slide N"` by show order: `presentation.xml`'s slide list wins over file names (`weather-reordered.pptx`), and with no `presentation.xml` the file numbers sort as numbers, not text or zip order (`counting-twelve-slides.pptx`, 12 slides written out of order). DOCX: Word headings become heading paths through `parseHtml` (`"The Solar System > Inner planets"`; a skipped level gives `"Electricity > Simple circuits"`). Markdown and HTML as in Phase A. Unit tests assert the exact `text` and `locator` of every unit. |
| Bad input is an IngestError, never an empty document | Random bytes, a header-only PDF, a truncated PDF, a PDF with no text (a scan), a password-protected PDF (mocked), a non-zip, a zip without `word/document.xml`, a heading-only DOCX, a deck with no slides / only blank slides / a missing or unknown slide relationship / malformed XML / a DOCTYPE all reject with `IngestError('validation')`. Library error text never reaches the message. |
| Zip bomb | `test/parse/zip.test.ts`: a 200 KB entry compressed to under 2 KB is stopped at a 50 KB budget with `input_too_large`; the budget is shared by every read from one file; `checkAll` (run before mammoth) inflates every entry against it. Default 100 MB. |
| No contracts change; harness untouched | `git diff origin/main...HEAD --name-only` lists only `packages/ingest/**`, `pnpm-lock.yaml` and `docs/tasks/5.1/**`. No risk path touched. |
| No network in tests | Unchanged from Phase A: global `fetch` rejects; no test imports `http/https/net/tls/dns/undici`. pdf.js runs with `useWorkerFetch: false` on in-memory bytes. |
| Repo stays clean | All 12 new binaries are written by the committed `test/fixtures/make-fixtures.ts` from self-written lesson text (photosynthesis, fractions, forces, measurement, solar system, parts of speech, rocks, electricity, habitats, counting in twos, weather, shapes). No names or personal details. Re-running the script reproduces identical bytes. `python3 .githooks/secret-scan.py --all` exits 0. |
| Coverage | `src/**` 100% lines/statements/functions, 98.43% branches; every new file (`pdf.ts`, `docx.ts`, `pptx.ts`, `zip.ts`, `sections.ts`) 100% on all four; `src/fetch/**` still held to 100% by `vitest.config.ts`. |

```
$ corepack pnpm install && corepack pnpm turbo run typecheck lint test --filter=...@edmate/ingest --force --concurrency=1
@edmate/ingest:test:  Test Files  13 passed (13)
@edmate/ingest:test:       Tests  208 passed (208)
@edmate/ingest:test: All files          |     100 |    98.43 |     100 |     100 |
@edmate/ingest:test:  src/fetch         |     100 |      100 |     100 |     100 |
@edmate/ingest:test:  src/parse         |     100 |    95.83 |     100 |     100 |
@edmate/ingest:test:   docx.ts / pdf.ts / pptx.ts / zip.ts / sections.ts: 100 on all four
 Tasks:    3 successful, 3 total

$ python3 .githooks/secret-scan.py --all
(exit 0)
```

## Changes

Phase A (unchanged; see its commits): Markdown and HTML parsers, `SectionBuilder`, the SSRF-safe web fetch, the stub fetcher, `parseDocument` / `parseWebLink`, 8 text fixtures.

Phases B and C:
- `packages/ingest/package.json`: deps `pdfjs-dist` 6.4.299, `mammoth` 1.13.0, `jszip` 3.10.2, `fast-xml-parser` 5.11.2 (exact pins).
- `src/parse/pdf.ts` (`parsePdf`): pdf.js legacy build, text layer only; one unit per page.
- `src/parse/docx.ts` (`parseDocx`): zip budget check, then mammoth HTML (images replaced by an empty `<img>`, no external file access) → `parseHtml`.
- `src/parse/pptx.ts` (`parsePptx`): slide order from `presentation.xml` + its rels, else numeric file order; `<a:p>` per line, `<a:t>` runs joined, `<a:br>` splits; DOCTYPE refused, XML validated first.
- `src/parse/zip.ts` (`openZip`, `MAX_UNZIPPED_BYTES` = 100 MB): streams each entry against one shared unzipped-bytes budget.
- `src/parse/sections.ts`: `numberedUnits` (shared by PDF and PPTX).
- `src/document.ts`: `'pdf'`, `'docx'`, `'pptx'` wired; `src/index.ts` exports the three parsers and `MAX_UNZIPPED_BYTES`.
- `test/fixtures/make-fixtures.ts` (generator; also exports the builders the tests use for in-memory edge cases) and 12 binaries under `test/fixtures/{pdf,docx,pptx}/`.
- Tests: `test/parse/{pdf,pdf-errors,docx,pptx,zip,all-fixtures}.test.ts`; `document.test.ts` now dispatches all kinds.

## Deviations from the plan
- **Fixture generation:** the plan said `npx pdf-lib` / `npx docx` once. Instead a committed script writes the PDFs by hand (a few objects and an xref table) and zips DOCX/PPTX with `jszip` (already a dependency). No extra tool, deterministic output, and the tests reuse the builders for edge cases.
- **PPTX slide order:** the plan said "sort `slideN.xml` numerically". The parser follows `presentation.xml`'s slide list (the real show order, which differs from file names after a reorder in some editors) and falls back to the numeric sort only when that part is missing. Both paths have a fixture.
- **Added beyond the plan:** a 100 MB unzipped-bytes budget for DOCX/PPTX (zip bombs), DOCTYPE refusal in PPTX XML, and refusal of image-only PDFs (no OCR).
- **DOCX images add no text** (no alt text), matching how `parseHtml` treats `<img>` in web pages; image bytes are never read into the output.
- **PPTX speaker notes are not read**, only slide text.
- `pdfjs-dist` 6 has no `isEvalSupported` option (it has no eval path), so it is not set.
- Tests live in `test/**` as in Phase A.

## Decisions

### 5.1 New ingest dependencies: markdown-it 15.0.3 and cheerio 1.2.0 · decided by tdd-guide (lead pre-approved the library choice, no ADR) · risk: medium
Decided: add `markdown-it` 15.0.3 (MIT, ships its own types) and `cheerio` 1.2.0 (MIT) to `packages/ingest`. Versions are the current npm `latest`, checked with `corepack pnpm view <pkg> version license` on 20 Oct 2026. HTML parsing imports `cheerio/slim` (htmlparser2), so the main entry's `fromURL`/undici network code is never loaded. Dev dependencies use the repo's existing pins (vitest 5.0.5, @vitest/coverage-v8 5.0.5, @types/node 22.20.5).
Why: these are the plan's Phase A libraries. Both are MIT, pure JS, and give the block and heading structure the locators need.
Alternatives: `remark`/`unified` (more packages for the same result); cheerio's full entry with parse5 (pulls in undici for no gain here).
Reversible: yes. Both are used only inside `src/parse/`.

### 5.1 New ingest dependencies: pdfjs-dist 6.4.299, mammoth 1.13.0, jszip 3.10.2, fast-xml-parser 5.11.2 · decided by tdd-guide (lead pre-approved the library choice, no ADR) · risk: medium
Decided: pin these exact versions, the npm `latest` on 20 Oct 2026 (`corepack pnpm view <pkg> version license`). Licences: pdfjs-dist Apache-2.0, mammoth BSD-2-Clause, jszip "MIT OR GPL-3.0-or-later" (used under MIT), fast-xml-parser MIT. pdfjs-dist pulls in its optional dependency `@napi-rs/canvas` 1.0.11 (MIT, prebuilt native binary for rendering); text extraction does not use it. pdfjs-dist 6 needs Node ≥ 22.13 (the repo runs 22.22).
Why: the plan's Phase B/C libraries; each gives true page, heading or slide boundaries. mammoth's licence was the plan's open question: BSD-2-Clause is permissive, so the fallback (raw OOXML for DOCX) was not needed.
Alternatives: `officeparser` (no slide boundaries); raw OOXML for DOCX (more code for heading styles and tables that mammoth already maps).
Reversible: yes. Each library is used in one file under `src/parse/`.

### 5.1 DNS rebinding in the web fetch is deferred to board task 5.1a · decided by lead · risk: medium
Decided: the gap Phase A raised (the public-address check resolves the name separately from the connection, so a rebinding host could answer differently the second time) is not fixed in 5.1. Board task 5.1a pins the connection to the checked address (an undici `Agent` with a guarded `connect.lookup`, or `node:https` with a `lookup` hook) where the app is assembled.
Why: the fix belongs to the transport wired at the composition root, not to this package's parsers. Until then the exact-host allowlist limits the risk: an attacker must control an allowlisted host's DNS.
Reversible: yes.

### 5.1 Web fetch checks the addresses a host resolves to, before the fetch and on every hop · decided by tdd-guide · risk: medium
Decided: on top of the allowlist, an IP-literal host must be public. A host name is resolved through an injected `resolveHost`, and every address must be public, or the link is refused. Refused ranges: loopback, RFC 1918, CGNAT, link-local and metadata, unique-local, documentation, benchmarking, multicast, reserved, NAT64, 6to4, Teredo, and IPv4-mapped IPv6 whose IPv4 part is not public. Resolver failure or no answer gives `not_found`.
Why: the lead asked that private, loopback, link-local and metadata addresses be blocked, including after redirects and DNS resolution. The remaining rebinding gap is the 5.1a decision above.
Reversible: yes.

### 5.1 DOCX and PPTX unpack against a 100 MB budget · decided by tdd-guide · risk: medium
Decided: every zip entry read is streamed and counted against one budget per file, five times the 20 MB upload cap (100 MB); going over gives `IngestError('input_too_large')`. A DOCX is fully inflated against the budget once before mammoth reads it, since mammoth inflates without a cap. PPTX XML with a DOCTYPE is refused.
Why: the upload cap bounds only the compressed size; a zip bomb can inflate kilobytes into gigabytes in the worker. Office files never carry a DOCTYPE, and entity expansion is the XML bomb.
Alternatives: trust declared sizes in the zip directory (attacker-controlled); no cap (worker memory exhaustion).
Reversible: yes; the limit is one constant.

### 5.1 PPTX slides follow the show order · decided by tdd-guide · risk: low
Decided: slide N is the Nth entry of `presentation.xml`'s slide list, resolved through its relationships; a missing or unknown slide reference is a validation error. Only when `presentation.xml` is absent do slide files sort by their number. Speaker notes are not read.
Why: "slide 3" must mean the slide a student sees third. File names can lag behind a reorder.
Reversible: yes.

### 5.1 PDF pages: text layer only, blank pages keep their number · decided by tdd-guide · risk: low
Decided: one unit per page with text, located by its real page number. A PDF with no text at all (a scan) is `IngestError('validation')`; there is no OCR. A password-protected PDF says so; any other pdf.js failure is "could not be read as a PDF", with no library text kept.
Why: locators must match the page a teacher would cite; OCR is out of 5.1's scope.
Reversible: yes.

### 5.1 Binary fixtures come from a committed generator · decided by tdd-guide · risk: low
Decided: `test/fixtures/make-fixtures.ts` (run with `node test/fixtures/make-fixtures.ts` from `packages/ingest`) writes all 12 PDF/DOCX/PPTX fixtures deterministically from self-written lesson text; tests import its builders for in-memory edge cases.
Why: reviewers can read exactly what each binary contains, the bytes can be regenerated, and no throwaway `npx` tools are needed.
Reversible: yes.

### 5.1 Locator and text shape for heading-tracked formats · decided by tdd-guide · risk: low
Decided: one `ParsedUnit` per section, meaning the text between two headings. Block elements become lines joined by `\n`, table rows become `cell | cell`, and image alt text is kept in Markdown. An empty heading is ignored and leaves the path unchanged. Raw HTML in Markdown is dropped. In web pages, `nav`, `footer`, `aside`, `script`, `style`, `noscript`, `template`, `form`, `svg` and `iframe` are dropped. A later heading with the same path starts a new unit; it is never merged with the earlier one. DOCX follows the same rule through mammoth's HTML.
Why: the plan leaves unit size to 5.3's chunker. Per-section units keep each locator exact and the output small.
Reversible: yes.

### 5.1 IngestError codes are local to packages/ingest · decided by tdd-guide · risk: low
Decided: `IngestError` uses a local code union (`validation`, `unsupported`, `forbidden`, `not_found`, `input_too_large`, `rate_limited`, `provider_error`) shaped like `TranscriberError`, with no `cause` kept. It does not import `@edmate/contracts`'s `ErrorCode`.
Why: the package has no contracts dependency yet, and `unsupported` is not a contracts code. Whoever maps ingestion failures to API errors (8.x) can map them then.
Reversible: yes.

### 20 Oct 2026 · 5.1 subpath imports left as they are (typescript-reviewer LOW, wontfix)
- Decided: no change to packages/ingest/package.json for the reviewer's unverified cheerio/slim and pdfjs-dist/legacy subpath resolution; the ingest typecheck (code-reviewer's local gate and CI) resolves both.
- Why: the reviewer's sandbox had no node_modules; the gate is the real check.
