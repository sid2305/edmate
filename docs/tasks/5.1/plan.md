# Task 5.1: Document ingestion — PDF, DOCX, slides, Markdown, web links → text with locators

Board: `python3 .claude/skills/board/board.py show 5.1` · Milestone M5 · deps: `M3` · branch `m5/5.1-document-ingestion` · not risky (no `packages/contracts/**`, `packages/harness/**`, `packages/db/**`, `.claude/**` or safety-prefix path touched).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Document ingestion: PDF, DOCX, slides, Markdown, web links → text with locators"
Accept: "a 20-file fixture set parses; every chunk keeps its page, slide or heading."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| 20-file fixture set parses | `packages/ingest/test/parse/all-fixtures.test.ts`: iterates 20 self-authored fixtures (4 Markdown, 4 recorded HTML "web link", 4 PDF, 4 DOCX, 4 PPTX) through `parseDocument`/`parseWebLink`; every file parses with no throw and at least one non-empty unit. |
| Every chunk keeps its page, slide or heading | Each format's test asserts the exact expected `locator` string per unit (e.g. `"page 2"`, `"slide 3"`, `"Introduction > Variables"`), not just "non-empty". |
| No contracts change | `git diff` for the branch touches no file under `packages/contracts/**`; `ParsedUnit`/`ParsedDocument` are local to `packages/ingest`. |
| No network in tests | Web-link tests use a stub `WebFetcher` returning recorded HTML fixtures; a rule-4-style test asserts no test file other than a gated live-smoke (if any) imports `node:http` or calls the real `fetch`. |
| SSRF-safe fetch | `webFetch.test.ts`: only `https`, only an `allowedHosts` match (empty list refuses everything), no redirect off the allowlist, byte cap enforced — same shape as `packages/gateway/src/transcriber/source.ts`. |
| Harness stays pure | `packages/harness/**` untouched; rule-3 hook has nothing to flag. |
| Repo stays clean | `python3 .githooks/secret-scan.py --all` exits 0 (fixtures are synthetic, no real names/emails). |
| Coverage | `packages/ingest/src/**` at 80%+ (package default; confirm against `@edmate/config`'s vitest baseline). |

## Spec it must honour

- Build plan § Knowledge ingestion pipeline, step 2: "Parse: PDF, DOCX, slides, Markdown and web pages to text with locators (page, slide, heading)."
- `packages/contracts/src/turn.ts` `SourceRefSchema`: `{ title, locator, kind }` — `locator` is already a free-form string ("Page, slide, heading or timestamp"), so 5.1's output needs no new contracts type; 5.3 (chunking) will wrap each parsed unit into a `Chunk` by adding `teacherId`, `documentId`, `moduleId`, `kind`, copying `locator` through unchanged.
- `packages/db/src/schema/content.ts` `chunks.locator`: `text('locator').notNull()` — confirms every stored chunk must have one; 5.1 must never emit a unit with an empty locator.
- CLAUDE.md rule 3: `packages/harness` imports only contracts, zod, mathjs and its own modules — parsing libraries (pdf/docx/pptx/html parsers) are adapters, so they live in `packages/ingest` (already scaffolded, package.json: "Parsers, chunker, transcription adapter, outline drafter"), never in `packages/harness`.
- CLAUDE.md rule 5 / constraint from the lead: the repo is public — all 20 fixtures must be self-authored synthetic lesson content (e.g. a short "Introduction to Fractions" sample), never real teacher uploads, copyrighted publisher material or personal data.
- Constraint from the lead: web links — no network in tests; use recorded fixtures and an SSRF-safe fetch, following the existing pattern in `packages/gateway/src/transcriber/source.ts` (https-only, exact-host allowlist, no redirect off-host, byte cap, URL never logged).
- ADR-0005 precedent: ports/adapters that do real I/O (fetch, parse) stay out of `packages/harness`; `packages/ingest` is exactly the "adapters elsewhere" package ADR-0002 anticipated for ingestion (2.7's plan: "consumed later by ingestion (5.1/5.2, in `packages/ingest`/`apps/worker`)").

## Design

### 1. Local output type (no contracts change)
`packages/ingest/src/types.ts`:
```ts
export interface ParsedUnit { text: string; locator: string }
export interface ParsedDocument { sourceTitle: string; units: ParsedUnit[] }
```
This is new code, not a Core contracts change: it never enters `packages/contracts`, `packages/harness`, or any risky-path glob. 5.3 (a later task) maps each `ParsedUnit` to a `Chunk` by adding the teacher/document/module ids it already has at that point — out of bounds here.

### 2. One parser per format, one locator strategy each
`packages/ingest/src/parse/`:
- `markdown.ts` — `markdown-it` tokens; walk top-to-bottom, track the nearest preceding heading text (joined as `"H1 > H2"` when nested), assign it as `locator` to every unit until the next heading. A unit with no heading yet uses the fixture's declared `sourceTitle`.
- `html.ts` — same heading-tracked strategy, over a `cheerio` DOM (`$('h1,h2,h3,p,li,...')` walked in document order). Used for "web links" once the HTML is in hand (fetch is separate — see §4).
- `pdf.ts` — `pdfjs-dist`: load the document, extract text content per page, one `ParsedUnit` per page (split further by 5.3's chunker later, not here), `locator: "page " + pageNumber` (1-based).
- `docx.ts` — `mammoth`'s `convertToHtml` (keeps heading tags), then reuse the `html.ts` heading-tracked walk so DOCX and web/HTML share one locator strategy.
- `pptx.ts` — a thin custom extractor: `jszip` opens the `.pptx` zip, slides are read in `ppt/slides/slideN.xml` numeric order (not zip-entry order, which is unordered), `fast-xml-parser` parses each slide's XML and concatenates `<a:t>` text runs, `locator: "slide " + n`.
- `index.ts` — `parseDocument(input: { kind: 'pdf' | 'docx' | 'pptx' | 'markdown'; bytes: Uint8Array; sourceTitle: string }): Promise<ParsedDocument>` dispatches by `kind`; throws a local `IngestError` (fixed code + message, mirrors `TranscriberError`'s shape) on empty/corrupt input, never returns a document with zero units.

### 3. A local, bounded size check (not a contracts limit)
Each parser rejects input over a local `MAX_DOCUMENT_BYTES` constant (recommend 20 MB, matching `LIMITS.attachmentMaxBytes` in `packages/contracts/src/limits.ts` as a familiar bound) before doing any parsing work, same "cheap check first" discipline as the rest of the codebase. This stays local to `packages/ingest`; promoting it to `packages/contracts/src/limits.ts` is left to whichever later task (5.1 follow-up or 8.2's "Upload centre") first needs the web layer to enforce the same number.

### 4. Web links: fetch is separate from parse, and is SSRF-safe
`packages/ingest/src/fetch/webFetch.ts`, directly modelled on `packages/gateway/src/transcriber/source.ts`:
- `https` only; exact-match `allowedHosts` (constructor/function option from the composition root, never a contract — same as the Transcriber adapter); empty list refuses everything.
- Manual redirect handling: follows only to the same host, over https, up to a fixed hop cap.
- A byte cap (reuse the same `MAX_DOCUMENT_BYTES`).
- The fetched URL is never echoed in a thrown error (redact to `scheme://host/path`, same helper pattern as `redactUrl`).
- Returns raw HTML text; `html.ts` (§2) does the actual parsing. Kept as two functions (`fetchWebLink` then `parseHtml`) so tests can parse recorded HTML fixtures without exercising the network path at all.
- Test double: `packages/ingest/src/testing/stubWebFetcher.ts` — an in-memory map from URL to recorded HTML, used by every non-network test; mirrors the gateway's "scripted" adapter pattern.

### 5. Fixture set (20 files, self-authored, public-repo safe)
`packages/ingest/test/fixtures/`:
- `markdown/` — 4 `.md` files, synthetic short lesson text ("Introduction to Fractions" style), varying heading depth (flat, nested, no heading, long).
- `html/` — 4 `.html` files representing "recorded" web pages (self-authored, never actually fetched from a real site), same heading variety.
- `pdf/` — 4 small multi-page `.pdf` binaries.
- `docx/` — 4 small `.docx` binaries with headings.
- `pptx/` — 4 small multi-slide `.pptx` binaries.
All content is original/synthetic (no publisher text, no real teacher material, no personal names). PDF/DOCX/PPTX binaries are generated once with throwaway tooling (`pdf-lib` for PDF, `docx` for DOCX, the already-added `jszip` for PPTX, run via `npx` and **not** added to `packages/ingest/package.json` — they only ever touch the generation step, never the shipped parser) and the resulting small binary files are committed directly, so the test suite itself has zero extra fixture-generation dependencies and no network calls.

## Phases

Phase sizing: each phase is one package (`packages/ingest`), no contracts/harness/db touch, so none needs a fresh-builder split for review-group reasons — split instead purely for token budget (6 new runtime dependencies and 20 fixtures is more than one ~150-tool-call builder should take on at once).

### Phase A — Foundations: Markdown + web links (8 fixtures)
**New deps:** `markdown-it`, `cheerio` (both MIT).
**Create:** `src/types.ts`, `src/errors.ts` (`IngestError`), `src/parse/markdown.ts` (+ `.test.ts`), `src/parse/html.ts` (+ `.test.ts`), `src/fetch/webFetch.ts` (+ `.test.ts`), `src/testing/stubWebFetcher.ts` (+ `.test.ts`), `src/index.ts` (barrel, re-exports `parseDocument`-so-far), `test/fixtures/markdown/*.md` (4), `test/fixtures/html/*.html` (4).
**Modify:** `packages/ingest/package.json` (add deps).
**Out of bounds:** PDF/DOCX/PPTX, the dispatcher's full `kind` union (stub the other branches to throw "not yet implemented" until Phase C), the all-fixtures acceptance test (closes in Phase C).
**Tests first:** heading-tracked locator on nested/flat/no-heading Markdown and HTML fixtures; `webFetch` SSRF cases (wrong scheme, host not on allowlist, empty allowlist, cross-host redirect, oversized body) using a mocked `fetch`, no real network; `stubWebFetcher` round-trips a recorded fixture.
**State after this phase:** Markdown and web-link ingestion fully parse with correct locators; PDF/DOCX/PPTX still unimplemented; `all-fixtures.test.ts` does not exist yet.

### Phase B — PDF (4 fixtures)
**New dep:** `pdfjs-dist` (Apache-2.0).
**Create:** `src/parse/pdf.ts` (+ `.test.ts`), `test/fixtures/pdf/*.pdf` (4, generated once via `npx pdf-lib`, committed as binaries).
**Modify:** `src/index.ts` (wire the `'pdf'` branch into `parseDocument`), `packages/ingest/package.json`.
**Out of bounds:** DOCX/PPTX, the all-fixtures test.
**Tests first:** per-page locator (`"page 1"`, `"page 2"`, …) on a multi-page fixture; empty/corrupt-PDF input throws `IngestError`, never an empty `ParsedDocument`.
**State after this phase:** PDF ingestion parses correctly; DOCX/PPTX still unimplemented.

### Phase C — DOCX + PPTX, and the closing acceptance test (8 fixtures)
**New deps:** `mammoth` (confirm exact licence via `docs-lookup` before pinning — commonly listed as a permissive BSD-style licence; must be MIT/Apache/BSD-compatible or this phase picks the fallback in Open decisions), `jszip`, `fast-xml-parser` (all MIT).
**Create:** `src/parse/docx.ts` (+ `.test.ts`), `src/parse/pptx.ts` (+ `.test.ts`), `test/fixtures/docx/*.docx` (4, via `npx docx`), `test/fixtures/pptx/*.pptx` (4, via the already-added `jszip`), `test/parse/all-fixtures.test.ts` (the task's actual acceptance test, over all 20 fixtures across all three phases).
**Modify:** `src/index.ts` (wire `'docx'`/`'pptx'` branches), `packages/ingest/package.json`.
**Out of bounds:** persisting `ParsedDocument`s as `documents`/`chunks` rows (5.3), outline/style-card drafting (5.11), any web route or worker job (8.1/8.2).
**Tests first:** heading-tracked DOCX locators reusing `html.ts`'s walk (via `mammoth`'s HTML output); slide-numbered PPTX locators in numeric slide order (not zip-entry order — add a fixture with slides named/ordered so this would fail if sorted wrong); the full `all-fixtures.test.ts` over all 20 files.
**State after this phase:** all five formats parse with correct locators; the 20-file fixture set and the acceptance test both exist and pass; task done.

## Testing strategy
- Unit tests: one `.test.ts` per parser/adapter, in each phase, asserting exact locator strings (not just "truthy").
- Integration test: `all-fixtures.test.ts` (Phase C) — the acceptance criterion itself, run over the full 20-file fixture set.
- No live/network tests needed (the port's only I/O, `webFetch`, is exercised with a mocked `fetch`); no `--live` gate required unlike 2.7's Transcriber (there is no real external vendor to smoke-test here — every parser is a local library over bytes already in hand).

## Risky paths touched
Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
- None. `packages/ingest/**` is not a listed glob; no file under `packages/contracts/**`, `packages/harness/**`, `packages/db/src/repositories/**` or `identity/**`, `packages/payments/**`, `apps/web/app/api/{webhooks,auth}/**`, `apps/web/src/auth/**`, `packages/gateway/src/keys/**`, `.claude/**`, `.github/**`, `.githooks/**`, or any safety-prefix path (`packages/harness/src/guardrails/**`, `content/prompt-packs/**`, `content/skills/**`, `evals/suites/{safety,locked}/**`, `apps/worker/src/alerts/**`, `content/locales/**`, `packages/harness/src/pedagogy/**`, `packages/content/src/promptPacks.ts`, `packages/content/src/personaTemplates.ts`) is touched.
- No `risk: high` decision entry is planned, since no risky path is touched.

## Decisions (draft, to copy into the handoff `## Decisions`)

### 5.1 Parsed output stays local to `packages/ingest`, no contracts change · decided by planner · risk: low
Decided: `ParsedUnit`/`ParsedDocument` are plain interfaces in `packages/ingest/src/types.ts`, not added to `packages/contracts`.
Why: `SourceRef.locator` (already in `turn.ts`) is the only shape the rest of the system needs from ingestion's output; 5.3 constructs a real `Chunk` by adding ids it has and 5.1 doesn't.
Alternatives: add a `ParsedUnit` contract now, for 5.3 to reuse. Rejected: it would be a contracts/ADR change for a type no port currently needs, and CLAUDE.md rule 2 ties contracts changes to architect/security/typescript review for no benefit here.
Reversible: yes — 5.3 can promote it to contracts later with its own ADR if a port ends up needing it.

### 5.1 PPTX gets a thin custom parser (`jszip` + `fast-xml-parser`), not an all-in-one Office parser · decided by planner · risk: low
Decided: read `.pptx` as a zip, sort `ppt/slides/slideN.xml` numerically, extract `<a:t>` runs per slide.
Why: general "extract all text" Office parsers (e.g. `officeparser`) don't reliably expose slide-by-slide boundaries, which the acceptance criterion requires (every chunk keeps its slide). The zip format is documented and small to parse directly; `jszip`/`fast-xml-parser` are both MIT, pure JS, no native build, and already needed/adjacent for other parts of this task.
Alternatives: a dedicated `pptx`-parsing npm package. Search found none that is both well-maintained and exposes per-slide text as cleanly as hand-rolling it over `jszip`.
Reversible: yes.

## Open decisions (need a human/architect skim, not a full ADR — no contracts change)

- **Q1. Six new runtime dependencies for `packages/ingest`: `markdown-it`, `cheerio`, `pdfjs-dist`, `mammoth`, `jszip`, `fast-xml-parser`.** None are named in ADR-0001's tech-stack table or the build plan. Recommendation: approve all six — each is MIT or Apache-2.0 (confirm `mammoth`'s exact licence via `docs-lookup` before pinning; if it turns out incompatible, fall back to driving `pdfjs-dist`-style raw OOXML parsing for DOCX the same way Phase C already does for PPTX, reusing `jszip`/`fast-xml-parser` instead of adding `mammoth`), actively maintained, pure JS/WASM (no native build step, fitting Node 22 with no extra toolchain), and each is the smallest piece that gives true per-page/slide/heading locators rather than only concatenated text. This is not a contracts/tech-stack ADR (CLAUDE.md rule 2 scopes ADRs to `packages/contracts`, the tech stack and prompt-pack behaviour; a parsing library inside one adapter package is closer to 2.2/2.7's "new AI SDK/HTTP dependency, pinned via docs-lookup" precedent, which shipped without its own ADR).
- **Q2. Exact pinned versions.** Recommendation: the builder confirms current stable versions via `docs-lookup` before adding them (same discipline as 2.2/2.7), rather than this plan guessing version numbers.
- **Q3. Where do PDF/DOCX/PPTX fixture-generation tools (`pdf-lib`, `docx`) live?** Recommendation: nowhere permanent — run once via `npx` to produce the committed binary fixtures, never added to `packages/ingest/package.json`. If a later task needs to regenerate fixtures, it re-runs the same throwaway step.
