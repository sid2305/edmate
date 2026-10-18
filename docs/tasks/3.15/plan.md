# 3.15 plan — ADR-0005: session help state and Transcriber ports
Written by the team lead from architect's design (18 Oct 2026); approved by the lead under the human's contracts delegation (risk: high). Board: `board.py show 3.15`.

## Contracts change (only this)
`packages/contracts/src/ports.ts`:
```ts
// TurnConfigStore.load result gains:
  /** sessions.help_state as stored, unvalidated; the harness owns its shape. */
  helpState: unknown;

/** Bound to student x teacher at construction. Own open session only, else not_found. */
export interface SessionStateStore {
  saveHelpState(sessionId: string, helpState: unknown): Promise<void>;
}
/** Throws on failure; never returns an empty transcript. */
export interface Transcriber {
  transcribe(i: TranscribeInput): Promise<Transcript>;
}
```
New `packages/contracts/src/media.ts` (exported from index):
```ts
TranscribeInputSchema = strictObject({ url: z.url({ protocol: /^https$/ }), mimeType: z.string().regex(/^(audio|video)\//), languageHint: LangSchema.exactOptional() })
TranscriptSegmentSchema = strictObject({ startMs: count(), endMs: count(), text: z.string().min(1) })
TranscriptSchema = strictObject({ text: z.string().min(1), language: LangSchema.exactOptional(), durationMs: count(), segments: z.array(TranscriptSegmentSchema).min(1) })
  .superRefine(/* endMs >= startMs; segment starts never go backwards; last endMs <= durationMs */)
```
Adjust names/imports to the actual modules (`count`, `LangSchema` from formats/shared). Valid and invalid fixtures for each schema; type-level tests for the ports. No other contract change.

## ADR-0005 (`docs/adr/0005-session-help-state-and-transcriber.md`, template headings)
- Context: 3.4 needs `sessions.help_state` and no port returns it; 3.8 can't save it. ADR-0001 names a Transcriber port that was never defined. Vendor is OpenAI Whisper (human decision 18 Oct 2026); recordings are signed URLs; the adapter chunks long files.
- Decision: (1) `TurnConfigStore.load` returns the raw `helpState` from the session row it already reads, after ADR-0004's ownership check. (2) New `SessionStateStore.saveHelpState`, used by commit (3.8); the db adapter runs one UPDATE scoped to the student's own open session (`ended_at IS NULL`), caps the size, last write wins. (3) Help state stays `unknown` in contracts; the harness's `SessionHelpSchema` (`{v:1, rung, ...HelpState}`) parses it and anything invalid falls back to rung 0 / INITIAL_HELP_STATE. (4) `Transcriber` with the schemas above; adapters validate their own output against `TranscriptSchema`.
- Alternatives: add help state to TranscriptStore (changes an existing port, mixes concerns); a full read+write SessionStore (second ownership path, extra call); a help-state schema in contracts (every pedagogy tweak would need an ADR); a raw storage key instead of a URL (ties the gateway to storage).
- Consequences: `answerKey` lives in the session row and must never reach a client. The transcriber fetches only from allowlisted storage hosts (SSRF) and signed URLs never appear in logs or errors. `durationMs` enables per-minute metering later. Extends ADR-0002's port list (ADR-0002 unchanged). Owners: 3.15 (ports, ADR, build-plan contracts block), 2.7 (adapter), 3.4 (load), 3.8 (write).
- Reviewers: filled by the lead after review.

## Also
- `docs/edmate-harness-build-plan.md` Core contracts block: add the ports and media schemas; the spec-types drift test must pass.
- Out of bounds: adapters (2.7), harness parsing (3.4), commit (3.8), db adapters.
- Reviewers: architect, security-reviewer, typescript-reviewer. Handoff needs a risk: high entry.
