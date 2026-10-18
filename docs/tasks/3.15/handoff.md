# 3.15 handoff — ADR-0005: session help state and Transcriber ports

**Status:** DONE
**Branch:** `m3/3.15-adr-0005`
**Worktree:** `.claude/worktrees/agent-a50987f17f8704285`

## Acceptance evidence

| Command | Result (trimmed) |
|---|---|
| `corepack pnpm turbo run typecheck lint test --force` (root, all packages) | `Tasks: 40 successful, 40 total` |
| contracts test | `Test Files 6 passed (6)` · `Tests 322 passed (322)` (fix round 1; 308 before) · `All files 100 / 100 / 100 / 100` (incl. `src/media.ts` 100) |
| harness test | `Test Files 22 passed (22)` · `Tests 1904 passed (1904)` |
| db test on Postgres (`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`) | `Test Files 14 passed (14)` · `Tests 334 passed (334)` · `ports.ts 100 / 100 / 100 / 100`; nothing skipped |
| spec-drift test (`test/spec-drift.test.ts`) | passes against the updated build-plan Core contracts block |
| type-level tests (`test/types.test.ts`, checked by `tsc`) | `TranscribeInput`, `TranscriptSegment`, `Transcript`, `SessionStateStore`, `Transcriber`, `TurnConfigStore` equal the spec types; before the change `tsc` failed on each (red run recorded) |
| `python3 docs/adr/check-headings.py` | exit 0 |
| `python3 .githooks/secret-scan.py --all` | exit 0 |

## Changes

- `packages/contracts/src/ports.ts`: `TurnConfigStore.load` result gains `helpState: unknown`; new `SessionStateStore` and `Transcriber` ports.
- `packages/contracts/src/media.ts` (new, exported from `index.ts`): `TranscribeInputSchema`, `TranscriptSegmentSchema`, `TranscriptSchema` (with the ordering and duration refinements).
- Fixtures: `fixtures/valid/media.ts`, `fixtures/invalid/media.ts` (15 invalid cases: http and file URLs, non-URL, wrong MIME type, bad language tags, unknown key, empty text, negative/fractional times, no segments, end before start, starts going backwards, last end past the duration); registered in `fixtures/index.ts`.
- `test/spec-types.ts` regenerated from the build plan; `test/types.test.ts` adds the 5 new type equalities; registry count 32 -> 35.
- `docs/edmate-harness-build-plan.md`: Core contracts block gains the Media section, `helpState` on `TurnConfigStore`, `SessionStateStore` and `Transcriber`; the Ports and adapters line lists the two new ports.
- `docs/adr/0005-session-help-state-and-transcriber.md` (new).
- Implementers (compile only, no behaviour change): `packages/db/src/repositories/ports.ts` `turnConfigStoreFor` returns `helpState: session.helpState`; `packages/harness/src/testing/memoryAccess.ts` `MemorySession` gains optional `helpState` and `load` returns it (`undefined` when unset). One test each shows the value passes through unvalidated. `packages/harness/src/testing/fixtures.test.ts` schema count 32 -> 35.
- No gateway or usage files touched.

## Fix round 1 (security-reviewer, architect, typescript-reviewer)

- ADR-0005 Decision 5 and the `media.ts` doc comment name the allowlist: the Transcriber adapter's `allowedHosts: readonly string[]` constructor option from config, exact host match after parsing, no redirect to another host, empty list refuses everything (an adapter option, not a contract type). Build-plan comment updated.
- `LIMITS.helpStateMaxJsonLength = 8 * 1024` in `packages/contracts/src/limits.ts`, referenced in ADR-0005 Decision 2 as the cap `saveHelpState` enforces; 3.8 must test it (Consequences).
- ADR Consequences: 2.7 must test that errors, logs and traces never contain the signed URL's query string (redacted to `scheme://host/path`).
- `TranscriptSchema` checks every segment's `endMs <= durationMs`, not only the last; invalid fixture with overlapping segments where an earlier one runs past the duration.
- `TranscribeInputSchema.url` refuses userinfo, surrounding whitespace, `https:host`, `https:/host` and an upper-case scheme. The shape regex runs before `z.url` because `z.url` trims its input and would otherwise accept `" https://…"`. `mimeType` needs a non-empty subtype.
- Tests first: 11 new cases failed before the fix (`Tests 11 failed | 311 passed`), all pass after.
- Root gates after the round: `Tasks: 40 successful, 40 total`; contracts 322, harness 1904, db 334 (Postgres up, none skipped). ADR heading check and secret scan exit 0.
- Two invalid fixtures contain fake userinfo on the reserved `example.com` domain; each line carries a `secret-scan: allow` marker.

## Deviations

- The plan listed no harness test changes; `harness/src/testing/fixtures.test.ts` hard-codes the contracts schema count and had to go from 32 to 35.
- Build-plan comments on the new spec lines (allowlisted https URL, segment rules) are short summaries of the schema rules; the schemas are the source of truth.

## Decisions

### 18 Oct 2026 · 3.15 ADR-0005: TurnConfigStore returns raw helpState; new SessionStateStore and Transcriber ports and media schemas · decided by team lead (architect's design, human's contracts delegation) · risk: high
Decided: `TurnConfigStore.load` also returns `helpState: unknown` (the session row's `help_state`, unvalidated); new `SessionStateStore.saveHelpState(sessionId, helpState)` and `Transcriber.transcribe(TranscribeInput): Promise<Transcript>` ports; new `TranscribeInputSchema` (https URL, audio/video MIME, optional language hint), `TranscriptSegmentSchema` and `TranscriptSchema` (non-empty, segments in start order, ends within the duration). Help state stays `unknown` in contracts and the harness parses it (3.4).
Why: 3.4 and 3.8 need to read and write the session's help state and no port did; ADR-0001 named a Transcriber that was never defined (vendor OpenAI Whisper, human decision 18 Oct 2026).
Alternatives: help state on TranscriptStore; a full SessionStore; a help-state schema in contracts; a storage key instead of a URL.
Reversible: only by another ADR (contracts change). Needs architect, security-reviewer and typescript-reviewer sign-off.

### 18 Oct 2026 · 3.15 The in-memory TurnConfigStore returns `undefined` help state when a session has none · decided by builder (tdd-guide) · risk: low
Decided: `MemorySession.helpState` is optional; an unset value loads as `undefined` (the db column defaults to `{}`). Neither adapter validates the value.
Why: the plan asks for no behaviour change; 3.4's parser falls back to rung 0 for any invalid value, `undefined` included.
Alternatives: default the in-memory value to `{}` to mirror the db default.
Reversible: yes (test helper only).

### 18 Oct 2026 · 3.15 Overlapping transcript segments are allowed · decided by builder (tdd-guide), following the plan's rule · risk: low
Decided: `TranscriptSchema` only requires each segment's `endMs >= startMs`, starts never going backwards and the last segment's `endMs <= durationMs`; a segment may start before the previous one ends.
Why: the plan's refinement lists exactly these rules; chunked Whisper output can overlap at chunk edges.
Alternatives: require non-overlapping segments.
Reversible: only by ADR (contracts).

### 18 Oct 2026 · 3.15 Saved help state is capped at 8 KB of JSON (LIMITS.helpStateMaxJsonLength) · decided by team lead on security-reviewer's fix round 1 · risk: medium
Decided: `LIMITS.helpStateMaxJsonLength = 8 * 1024` (UTF-16 units of `JSON.stringify`, like `skillPayloadMaxJsonLength`); `SessionStateStore.saveHelpState` refuses a larger or unserialisable value before writing (adapter in 3.8).
Why: help state is a client-influenced jsonb blob on every turn; an unbounded write would let one session grow the row without limit. 8 KB is far above the ladder state's size.
Alternatives: 16 KB like the skill payload; a cap only in the db adapter, not in contracts.
Reversible: only by ADR (contracts LIMITS).

### 18 Oct 2026 · 3.15 Transcribe URLs and MIME types are checked strictly in the schema · decided by builder (tdd-guide) on typescript-reviewer's fix round 1 · risk: low
Decided: `url` must match `https://host[:port]` plus an optional path, query or fragment: lower-case scheme, no userinfo, no whitespace anywhere, no backslash in the authority. `mimeType` must be `audio/` or `video/` plus an RFC 6838 subtype, with no parameters (`audio/webm;codecs=opus` is refused; the caller strips parameters).
Why: the URL goes straight to a fetch, so every form the WHATWG parser rewrites silently is refused at the boundary; refusing parameters keeps the check simple.
Alternatives: accept MIME parameters; rely on `z.url` alone (it trims and would accept surrounding whitespace).
Reversible: only by ADR (contracts).
