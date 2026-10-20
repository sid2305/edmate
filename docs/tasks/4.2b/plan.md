# Task 4.2b: PII in images and attachments

Board: `board.py show 4.2b` · M4 · deps 4.2 · branch `m4/4.2b-attachment-refuse` · planner: sonnet.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "PII in images and attachments: text in a photo (e.g. an ID card) is scrubbed or the image
is refused before any model sees it"
Accept: "an attachment with seeded PII never reaches a model unscrubbed; tests with fixture
images."

### Scope call this plan makes (read first)

No OCR/vision pipeline exists anywhere in the repo today, and photo upload is explicitly **P1
(MVP out)** per the PRD (line 324: "photo upload of written work" is a deliberate cut) and the
build plan (`Attachment` is commented "P1 (photo of written work)", build plan lines 41/168/174).
`TurnInput.attachments` is already in `@edmate/contracts` (image kind, mime, a storage key, a byte
cap), and `admit` already caps the count (≤ 2) and rejects malformed shapes — but **nothing
downstream ever reads an attachment**: no code fetches the bytes, no port exists to OCR or send an
image to a model, and `ModelRequest.messages[].content` is a plain string (no image content block
at all). So today an attachment-bearing turn is quietly admitted and then the attachment is simply
never looked at again — not scrubbed, not refused, just dropped without telling the student why.

Building a real extract-then-scrub pipeline now would need: a new port to fetch attachment bytes
from storage (none exists; 5.x's ingestion storage isn't built either), a new OCR/vision port or a
`ModelRequest` content-block change (either way, `packages/contracts/**`, so an ADR reviewed by
architect, security-reviewer and typescript-reviewer), and real/fixture OCR output wired through
`packages/evals`. That is materially bigger than a guard task and builds infrastructure for a
feature the PRD has already deferred to P1.

**This plan builds the safe stopgap now: every turn that carries an attachment is refused before
anything — not even its bytes or storage key — is read, with the same fail-closed mechanics 4.2
already built for a broken scrub.** It designs (but does not build) the real extract-and-scrub
path as a documented follow-up for whichever task actually ships photo upload. This satisfies the
accept line exactly as written: an attachment can't leak unscrubbed PII to a model if it never
reaches a model at all, scrubbed or not. Recommendation only — the lead may instead ask for the
full OCR/vision build; see Open Q1.

### How it will be shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| An attachment is refused, not silently dropped | `scrub.test.ts`: a `TurnInput` with 1 or 2 attachments (at the schema cap) makes `createScrub`'s step throw `ScrubFailedError({ guardCause: 'attachment' })` before the piiScrub guard chain or the skill-payload walk ever runs (asserted via a spy guard whose `run` is never called) — proven with plain fixture metadata only (`@edmate/contracts/fixtures`' `demoAttachment`, a synthetic `{kind:'image', mime, storageKey, bytes}` record with no real file). |
| Fixture-image adversarial cases | `scrub.test.ts`, one table: attachments labelled (in the test only, via `storageKey`) as an ID-card photo, rotated/split-text, no-text and "slow OCR" — all four are refused identically and before any extraction is even attempted, because none is ever attempted. The table's comment explains why these labels can't otherwise matter yet (no OCR exists) and names the follow-up task that must re-test them for real once one does. |
| No bypass | `scrub.test.ts`: an attachment alongside clean text, PII-bearing text, or a PII-bearing `skillPayload` is refused in every case; the thrown error's message, stack, `cause` and `JSON.stringify` form never contain the turn's text, `skillPayload` or any attachment field (storageKey, mime) — reusing the existing `shown()` helper. An empty `attachments: []` is **not** a refusal (behaves exactly as `undefined`). |
| Wired into the pipeline, fail closed | `runner.test.ts`: an attachment-bearing turn ends `{type:'error', code:'guard_blocked', retryable:true}` through the existing scrub-failure path (`PRE_GUARD_FAILED`); no model call, no trace, nothing committed; `finished.background` carries exactly one `ScrubFailedError` with `detail: {guardCause:'attachment'}` (no `errorName`, since this is a deliberate refusal, not a caught bug). |
| **The distress check still runs on the text, attachment or not** | `runner.test.ts`, the critical regression test: a turn whose `text` contains a distress marker *and* carries an attachment still escalates (the caring reply, an alert, `commit.outcome:'escalated'`) — it does **not** get swallowed as a bare `guard_blocked`. This reuses the runner's existing raw-text `distressCheck` (4.2 fix round 1), which already runs before `scrub` and already triggers escalation on any scrub failure; 4.2b adds no runner.ts change, only a test proving the interaction holds for this new failure cause. |
| Harness purity | `turbo run typecheck lint test --filter=@edmate/harness...` green; no new dependency; no `packages/contracts/**` edit; no new port. |

## Design

### Where the refusal lives, and why not in `admit`

`admit` (step 1) runs before `entitle` and before the runner's raw-text `distressCheck` (runner.ts
calls `distressHit(input, 'raw')` only after `entitle` succeeds, at the top of step 3). If the
refusal lived in `admit`, a turn with an attachment would be rejected before the raw distress check
ever saw its accompanying text — exactly the class of bug 4.2's own fix round 1 found and fixed for
over-redaction ("a distress phrase could be redacted as a name before any distress check saw it").
`admit` already caps the attachment *count* (`checkInputLimits`, unchanged, a defence for callers
that skip the schema) — that stays exactly as is.

Instead, the refusal lives in `steps/scrub.ts` (4.2's own header comment already flags the seam:
*"text inside images is task 4.2b"*), at the very top of the step function, before the guard chain
or the skill-payload walk:

```ts
return async (env: StepEnv, e): Promise<Scrubbed> => {
  // 4.2b: any attachment is refused before anything about it — not even its bytes or storage
  // key — is read. No OCR/vision pipeline exists yet; this is the safe stopgap until one does
  // (board task 4.2b design note), reusing 4.2's own fail-closed mechanics.
  if (env.input.attachments !== undefined && env.input.attachments.length > 0) {
    throw new ScrubFailedError({ guardCause: 'attachment' });
  }
  ...
```

This runs after `entitle` and after the runner's raw-text `distressCheck`, so:
- a distress hit on the accompanying text still escalates (the runner's existing
  `if (rawDistress) return this.sendEscalation(...)` branch on any scrub failure, unchanged);
- otherwise the turn ends `guard_blocked` (`PRE_GUARD_FAILED`, retryable) through the exact same
  path 4.2 built for any other scrub-chain failure — no `runner.ts` change at all;
- the failure is reported to `finished.background` as a `ScrubFailedError` (ids and cause only,
  per 4.2's rule), via the existing `scrubFailure()` helper, which already passes a thrown
  `ScrubFailedError` through unchanged (`runner.ts:979`).

This is the same pattern `scrub.ts` already uses for a malformed skill payload (`payload_shape`,
thrown directly, not through the guard chain) — a new `Guard` in the `scrub` registry is the wrong
shape here, since attachments aren't text and `runGuardChain` only takes a string.

### `pipeline/errors.ts`: one new cause, no new type

Add `'attachment'` to the existing `ScrubFailureCause` union (no change to `ScrubFailureDetail`'s
shape: still `{ guardCause, errorName? }`). Update `ScrubFailedError`'s doc comment: most causes
are a framework bug; `'attachment'` is the one deliberate, by-design refusal — the turn still fails
closed the same way, but it is not reported as a bug.

### A friendly reply, honestly scoped

The constraint asks for "a friendly English message," but the wire `TurnEvent`'s `error` variant
has no text field (`{type:'error', code, retryable}` only, by contract) — this is a pre-existing
gap that also applies to `entitle`'s `limit_reached` text today (`DEFAULT_LIMIT_REACHED_REPLY` is
documented as "carried on the `TurnRejection`'s `message`... the frozen wire event has no message
field," and no caller currently reads it). 4.2b does not invent a new wire-delivery mechanism (that
would need a `packages/contracts` change and an ADR, and it is bigger than this task — every future
`guard_blocked` case, e.g. 4.4's moderation/jailbreak blocks, has the identical gap). Instead, 4.2b
exports one fixed, friendly, English constant for whichever later task wires guard-blocked replies
to the stream (web composition root, or a `TurnEventSchema` change):

```ts
export const ATTACHMENT_REFUSED_REPLY =
  "I can't look at photos or files yet, only text. Please type out the question (or what the " +
  "image shows) and I'll help from there.";
```

Exported from `steps/scrub.ts`, re-exported from `pipeline/index.ts` (same place as
`DEFAULT_LIMIT_REACHED_REPLY`). Not attached to `ScrubFailedError` itself (that class must keep
carrying no message/reason/text, per 4.2's own rule — only a cause and an optional error name). Not
plumbed through an injectable `FallbackReplies.attachmentRefused` hook for now — see Open Q2.

### What this does *not* build (explicitly out of bounds)

- Any fetch of attachment bytes from storage, any OCR or vision call, any new port.
- Any `packages/contracts` edit (no ADR needed — `TurnInput.attachments` already exists; nothing
  about its shape changes).
- Any change to `admit.ts` (its existing count cap stays, untested by this plan beyond what 4.2
  already covers) or to `guardrails/{guard,registry,chain,order}.ts` (4.1's frozen files).
- New eval-suite YAML cases under `evals/suites/safety/pii/**` (a risk-paths.txt glob needing
  safety-reviewer and `eval-author`'s human-reviewed process, same reasoning 4.2's own plan used to
  keep that directory read-only). The harness-level tests above are the "tests with fixture images"
  this task's accept line asks for; a dedicated eval-content task can add human-reviewed cases once
  a real pipeline exists to exercise.

## Files

Create: none.

Modify:
- `packages/harness/src/pipeline/errors.ts` — add `'attachment'` to `ScrubFailureCause`; update
  `ScrubFailedError`'s doc comment.
- `packages/harness/src/pipeline/steps/scrub.ts` — the attachment check (above); export
  `ATTACHMENT_REFUSED_REPLY`; update the header comment (the "text inside images is task 4.2b" note
  becomes a description of what 4.2b actually does, plus a pointer to this plan's design note for
  the real pipeline).
- `packages/harness/src/pipeline/steps/scrub.test.ts` — new cases (see Tests below).
- `packages/harness/src/pipeline/runner.test.ts` — new cases (see Tests below).
- `packages/harness/src/pipeline/index.ts` — `export { ATTACHMENT_REFUSED_REPLY } from
  './steps/scrub.js';`.
- `packages/harness/README.md` — a short note under the PII-scrub section: an attachment is
  refused, not scrubbed, until a real image pipeline exists; points at this task.

Out of bounds (see Design): `packages/contracts/**`, `content/locales/**`, any new port,
`packages/harness/src/pipeline/steps/admit.ts`/`admit.test.ts`, `guardrails/{guard,registry,chain,
order}.ts`, `evals/suites/safety/pii/**`, `apps/**`.

## Tests first (tdd-guide order)

1. `scrub.test.ts`, red first:
   - a single attachment (`demoAttachment` fixture, unchanged, synthetic metadata only) → the step
     throws `ScrubFailedError`; `.detail` is exactly `{ guardCause: 'attachment' }` (no
     `errorName`).
   - two attachments (at `LIMITS.turnAttachmentsMax`) → same refusal.
   - `attachments: []` → **no** refusal; text is scrubbed exactly as before (regression guard
     against an over-eager `.length` check).
   - the piiScrub guard chain is never invoked when attachments are present (a spy/fake `Guard`
     passed to `createScrub(guards)` whose `run` must not be called) — proves nothing about the
     text (or, obviously, the image) is processed at all, the strongest form of "before any model
     sees it."
   - an attachment alongside PII-bearing `text` and a PII-bearing `skillPayload` → still a bare
     refusal; neither is scrubbed or walked.
   - adversarial fixture-label table (ID-card photo, rotated/split text, no-text image, "OCR
     timeout") — four `demoAttachment`-shaped fixtures whose `storageKey` only is renamed for the
     test's own documentation value (e.g. `test/uploads/id-card-fixture.png`); all four refused
     identically; a comment states plainly that these labels are illustrative only (no OCR exists
     to tell them apart) and names the follow-up for when one does.
   - the thrown error's `String()`, `.message`, `.stack` and a `JSON.stringify` of it never contain
     the turn's `text`, `skillPayload` values or any attachment field (reusing the file's existing
     `shown()` helper).
   - `ATTACHMENT_REFUSED_REPLY` is friendly, English, names no ids, and does not contain "error"
     or a code (mirrors `entitle.test.ts`'s own check on `DEFAULT_LIMIT_REACHED_REPLY`).
2. Build: the `ScrubFailureCause` union edit, then the `scrub.ts` check, to turn 1 green.
3. `runner.test.ts`, red first (needs step 2 done):
   - an attachment-bearing turn through `runTurn` with `defaultSteps.scrub` ends
     `[{type:'error', code:'guard_blocked', retryable:true}]`; no model call (the test's gateway
     double records none); `result.trace` reflects the existing fail-closed shape (same as any
     other scrub failure — no new trace fields); nothing is committed.
   - `result.background` has exactly one entry, `{task:'runner', error: ScrubFailedError}` with
     `detail: {guardCause:'attachment'}`.
   - **the regression test:** `text` carries a raw-distress marker *and* `attachments` is
     non-empty → the turn still escalates (`events` show the safety alert and the caring reply,
     `commits[0].outcome === 'escalated'`), not a bare `guard_blocked` — modelled directly on the
     existing "the distress keyword check on the raw text" describe block, reusing its
     `distressCheck` override and `MARKER` pattern.
   - no distress hit + an attachment → the ordinary `guard_blocked` path (the first bullet above),
     explicitly contrasted with the escalation case in the same `describe` block.
4. Update `scrub.ts`'s header comment and `README.md` (doc-only, no test).
5. Full gate: `turbo run typecheck lint test --filter=@edmate/harness...`.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

None (checked against risk-paths.txt). Every file this plan touches is under
`packages/harness/src/pipeline/**` or `packages/harness/README.md` — neither matches any glob in
risk-paths.txt (the safety glob is specifically `packages/harness/src/guardrails/**`, and this plan
makes no change there; no `packages/contracts/**`, `content/**`, `.claude/**`, `.github/**` or
`.githooks/**` edit). No `risk: high` decision entry is required by the merge gate.

That said: this is safety-adjacent (a PII/attachment refusal that interacts directly with distress
escalation), so — matching 4.2's own precedent of recommending safety-reviewer attention on
`scrub.ts` even when it wasn't a listed risky path — **recommend safety-reviewer review this PR
anyway**, especially the distress-interaction test, even though the gate will pass without it.
Also recommend typescript-reviewer (the `ScrubFailureCause` union edit) and silent-failure-hunter
(a new fail-closed cause, same family 4.1/4.2 asked them to check). None of these are required by
the gate; the lead may merge without them if agent capacity is tight.

Separately: risk-paths.txt's safety glob (`packages/harness/src/guardrails/**`) does not cover
`packages/harness/src/pipeline/steps/scrub.ts` even though it carries PII- and distress-adjacent
logic (4.2 noted the same gap). Worth an architect follow-up to widen the glob — not this task's
call to make (editing `.claude/**` is itself a risky-path change needing security-reviewer), so not
done here.

## Open questions (recommendations)

- **Q1 Scope: refuse now vs. build the real OCR/vision pipeline now.** See the scope-call section
  above. *Recommend:* refuse now (this plan); design-only for the rest. If the lead wants the real
  pipeline built now instead, that needs: an ADR for a new OCR/vision port (or a `ModelRequest`
  image-content-block change) reviewed by architect, security-reviewer and typescript-reviewer; a
  storage-fetch mechanism (none exists for any attachment/document today — 5.1's ingestion isn't
  built either); and synthetic-OCR-text fixtures for `packages/evals`. That is a materially
  different, larger task and should not be folded into this one.
- **Q2 No injectable `FallbackReplies.attachmentRefused` hook (yet).** `limitReached` and
  `lockedReply` both follow an injectable-with-built-in-fallback pattern; 4.2b could match that for
  consistency. *Recommend:* skip it for now — nothing in the runner currently reads any such hook
  for a `guard_blocked` turn (the wire event carries no text at all, see Design), so an injectable
  surface would be unused plumbing. Add it when a real wire-delivery mechanism exists and needs a
  localisable (or overridable) string, same moment the OCR pipeline design gets picked up.
- **Q3 The pre-existing "guard-blocked turns carry no friendly text to the client" gap.** Not
  introduced by 4.2b — it already applies to `limit_reached` and will apply to every future
  `guard_blocked` case (4.4's moderation/jailbreak blocks). *Recommend:* out of scope for 4.2b; flag
  as a cross-cutting follow-up (likely apps/web's job once it exists, or a `TurnEventSchema` change
  with its own ADR) rather than something one guard task should fix piecemeal.
- **Q4 Residual risk: PII smuggled as inline data inside `skillPayload` rather than `attachments`**
  (for example a base64 image blob in a skill's free-form payload) is not caught by this plan — it
  would only be caught by the existing text-pattern scrub, which cannot parse binary-encoded image
  data. *Recommend:* accept as a known, pre-existing gap (base64 smuggling through `skillPayload` is
  not new to 4.2b and isn't the attachment path this task is scoped to); worth a note in the
  decision log, not a blocking item.

## Decisions to log on merge

- `risk: medium` (not required by the gate, logged anyway per the safety-adjacent note above): any
  turn carrying an `attachments` entry is refused at the scrub step, before anything about it is
  read, until a real extract-and-scrub pipeline exists; the refusal reuses 4.2's existing
  fail-closed mechanics (`ScrubFailedError`, `guard_blocked`, the raw-text distress check still
  runs first).
- Q1-Q4 above, once the lead confirms (Q1 has the only scope-changing consequence).
- The decision that `ATTACHMENT_REFUSED_REPLY` is exported but not yet wired to any client-visible
  channel (same pre-existing gap as `limit_reached`'s friendly text).

## Lead revisions (19 Oct 2026)
1. Q1: refuse now. Photo upload is P1 in the PRD; the extract-then-scrub pipeline (fetch port, OCR or vision port, ADR) is designed here and built when photo upload is scheduled. The board gets a P1 follow-up.
2. Q2: no FallbackReplies hook yet. Q3: the missing client text on guard_blocked turns is a separate cross-cutting fix (noted for 9.4). Q4: PII smuggled inside skillPayload stays out of scope.
3. Reviewers: safety-reviewer, typescript-reviewer and silent-failure-hunter, even though no risky glob matches. The key test is that a distress marker in the text still escalates with an attachment present.
