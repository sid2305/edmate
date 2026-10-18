# ADR-0005: Session help state and Transcriber ports

## Status

Accepted

## Date

2026-10-18

## Context

Task 3.4 (the help ladder in `policy`) needs the session's `sessions.help_state`, but no port returns it: `TurnConfigStore.load` (ADR-0004) already reads the session row and drops the column. Task 3.8 (`commit`) has to save the new help state after a turn and no port can write it.

ADR-0001 names a `Transcriber` port for live-class recordings, but it was never defined in `packages/contracts`. The vendor is OpenAI Whisper (human decision, 18 Oct 2026). Recordings are reached through signed URLs, and the adapter (task 2.7) splits long files into chunks.

## Decision

Add to `packages/contracts` and to the build plan's Core contracts block (task 3.15):

```ts
interface TurnConfigStore {
  load(e: Entitlement, sessionId: string): Promise<{ agent: AgentConfig; pkg: PackageConfig; styleCard: StyleCard; locale: LocalePack; helpState: unknown } | null>;
}
interface SessionStateStore { saveHelpState(sessionId: string, helpState: unknown): Promise<void> }
interface Transcriber { transcribe(i: TranscribeInput): Promise<Transcript> }
interface TranscribeInput { url: string; mimeType: string; languageHint?: Lang }
interface TranscriptSegment { startMs: number; endMs: number; text: string }
interface Transcript { text: string; language?: Lang; durationMs: number; segments: TranscriptSegment[] }
```

1. **`TurnConfigStore.load` returns the raw `helpState`** from the session row it already reads, after ADR-0004's ownership check (own student, teacher and agent, session open). No extra query.
2. **New `SessionStateStore.saveHelpState`**, used by `commit` (task 3.8). It is bound to one student x teacher when it is built. The db adapter runs one UPDATE scoped to that student's own open session (`ended_at IS NULL`); another student's, another teacher's or an ended session is `not_found`. The stored value is capped at `LIMITS.helpStateMaxJsonLength` (8,192 UTF-16 units of `JSON.stringify`, in `packages/contracts/src/limits.ts`); a larger or unserialisable value is refused before the write. Last write wins.
3. **Help state stays `unknown` in contracts.** The harness owns its shape: its `SessionHelpSchema` (`{ v: 1, rung, ...HelpState }`) parses the value, and anything that does not parse falls back to rung 0 and `INITIAL_HELP_STATE` (task 3.4).
4. **`Transcriber`** with the media schemas in `packages/contracts/src/media.ts`: `TranscribeInputSchema` takes an `https://host/path` URL (lower-case scheme, no userinfo, no surrounding whitespace, no scheme-only forms such as `https:host`) and an `audio/<subtype>` or `video/<subtype>` MIME type without parameters; `TranscriptSchema` has non-empty text, a duration and at least one segment, each segment with `endMs >= startMs`, segment starts never going backwards and every segment ending within `durationMs` (segments may overlap, so the largest end is checked, not only the last). The transcriber throws on failure and never returns an empty transcript. Adapters validate their own output against `TranscriptSchema`.
5. **The host allowlist is an adapter option, not a contract.** The Transcriber adapter (task 2.7) takes `allowedHosts: readonly string[]` as a constructor option, supplied by the composition root from config. It parses the URL and requires an exact match of the parsed host against the list (no suffix or wildcard match), follows no redirect to another host, and refuses every URL when the list is empty.

## Alternatives

- **Add help state to `TranscriptStore`.** Rejected: it changes an existing port and mixes the message log with ladder state.
- **A full read and write `SessionStore`.** Rejected: a second path for checking session ownership next to ADR-0004's, and one more call per turn.
- **A help-state schema in contracts.** Rejected: every pedagogy tweak to the ladder state would need an ADR. The harness validates it instead and fails safe to rung 0.
- **A raw storage key instead of a URL in `TranscribeInput`.** Rejected: it ties the gateway's transcriber to the storage layout and credentials.

## Consequences

- The session row holds `answerKey` (inside the help state), so the help state must never reach a client: no route returns it and it is not part of any `TurnEvent`.
- The transcriber fetches only from `allowedHosts` (SSRF; Decision 5), and signed URLs are bearer credentials: they never appear in logs, traces or error messages. Where a URL has to be mentioned it is redacted to `scheme://host/path`, dropping the query string and fragment. Task 2.7 must test that thrown errors, log lines and traces never contain the signed URL's query string, and that an empty `allowedHosts`, a host not on the list and a redirect to another host are all refused.
- Task 3.8 must test that `saveHelpState` refuses a value over `LIMITS.helpStateMaxJsonLength` and writes nothing.
- `durationMs` makes per-minute metering of transcription possible later.
- Extends ADR-0002's port list; ADR-0002 is unchanged because accepted ADRs aren't rewritten.
- Owners: 3.15 (ports, schemas, this ADR, the build plan's contracts block), 2.7 (the Whisper adapter), 3.4 (parsing on load), 3.8 (the write in `commit`). Existing `TurnConfigStore` implementers (the in-memory store in `harness/testing` and the db adapter) pass the stored value through unchanged in 3.15.
- Changing these ports later needs another ADR, like any contract.

## Reviewers

architect (opus), security-reviewer (sonnet), typescript-reviewer (opus), 18 Oct 2026 (PR #23). Approved by the team lead (contracts decisions delegated by the human).
