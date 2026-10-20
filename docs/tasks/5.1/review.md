# 5.1 review — APPROVE


Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), security-reviewer (sonnet)

All three approve. No CRITICAL, HIGH or MEDIUM findings. code-reviewer re-ran the ingest gate (13 files,
208 tests, 100% lines) and the secret scan. security-reviewer checked the SSRF defences (https only,
allowlist, public address on every redirect, WHATWG URL canonicalises decimal/octal hosts before the
check, no URL in errors), the zip-bomb budget, the DOCTYPE refusal, pdf.js settings, mammoth's
externalFileAccess:false, and ran `pnpm audit` (nothing for the new dependencies). The DNS-rebinding gap
is deferred to 5.1a (lead decision in the handoff).

## Findings
- [LOW] [deferred 5.1b] packages/ingest/src/parse/html.ts:140 — `body as unknown as DomNode` double cast; DomNode.data is required but optional on real domhandler nodes. Fix: a type guard on cheerio's AnyNode, or make data optional (typescript-reviewer).
- [LOW] [deferred 5.1b] packages/ingest/src/parse/pptx.ts:60-99 — attributes cast to Record<string, string>; type them Record<string, string | undefined> (typescript-reviewer).
- [LOW] [wontfix] packages/ingest/package.json — cheerio/slim and pdfjs-dist/legacy subpath resolution unverified in the reviewer's sandbox; CI typecheck and the code-reviewer's local gate confirm it resolves (typescript-reviewer).
- [LOW] [deferred 5.1b] packages/ingest/src/parse/zip.ts:47-56 — on budget overflow the stream is paused, not destroyed; one in-flight chunk may still be processed. Fix: destroy the stream (security-reviewer).
- [LOW] [deferred 5.1b] packages/ingest/package.json — pdfjs-dist's optional @napi-rs/canvas installs native binaries never used for text extraction; keep it out of the build (pnpm onlyBuiltDependencies) (security-reviewer).
