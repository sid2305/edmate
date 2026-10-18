# 0.3 review — APPROVE
Reviewers: architect (opus), security-reviewer (opus), typescript-reviewer (opus)

typescript-reviewer re-ran the gates uncached (11/11; 244 tests then, 282 after the fix round) and proved the type tests are two-way equality by mutating the spec copy. architect confirmed all 32 data types and 12 ports match Core contracts, then re-verified every MEDIUM fix at 77e9c7c. MEDIUM findings were fixed in this PR because contracts freeze on merge (later changes need an ADR).

## Findings
- [MEDIUM] [fixed] packages/contracts/src/turn.ts:40 — Attachment storageKey accepted any string (`../s2/photo.jpg`) and any image type (SVG). Safe key charset, no `..`, max 200; png/jpeg/webp/heic only; 20 MB cap. Re-verified by architect.
- [MEDIUM] [fixed] packages/contracts/src/formats.ts:5 — ids had no length or charset limit. Max 128, `^[A-Za-z0-9_-]+$`. Re-verified by architect.
- [MEDIUM] [fixed] packages/contracts/src/turn.ts:69 — skillPayload was unbounded. 16 KB of JSON. Re-verified by architect.
- [MEDIUM] [fixed] packages/contracts/fixtures/valid/access.ts:14 — demo entitlements locked a package's own module and listed the wrong skills. Fixtures now match their packages. Re-verified by architect.
- [MEDIUM] [fixed] packages/contracts/src/turn.ts:111 — TurnContext had no cross-field check for "locked means locked". superRefine: retrieved chunks come from allowed modules of the same teacher; entitlement matches package, version and agent. Re-verified by architect.
- [MEDIUM] [fixed] packages/contracts/package.json:24 — zod as a plain dependency risked two copies. Now a peer dependency. Re-verified by architect.
- [LOW] [fixed] packages/contracts/src/turn.ts:61 — length cap now runs before the character count.
- [LOW] [fixed] packages/contracts/src/safety.ts:14 — length caps on model-output strings.
- [LOW] [fixed] packages/contracts/src/locale.ts:20 — PII patterns must compile, max 500 characters.
- [LOW] [fixed] packages/contracts/src/turn.ts:54 — comment: web merges the session studentId before parsing TurnInput.
- [LOW] [fixed] packages/contracts/fixtures/omit.ts:3 — comment on why the cast is safe.
- [LOW] [deferred 0.4] packages/contracts/src/ports.ts — ports live in contracts, unlike the Repo layout text; record it in ADR-0002 (task 0.4).
- [LOW] [wontfix] packages/harness/src/testing/fixtures.test.ts:23 — schema union cast in a test. See decision log 18 Oct 2026.
