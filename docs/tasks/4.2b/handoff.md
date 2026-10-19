# Task 4.2b handoff: PII in images and attachments

Status: DONE
Branch: `m4/4.2b-attachment-refusal`
Worktree: `.claude/worktrees/agent-a75fd6a8739906df0` (relative to the repo root)

Built exactly to `docs/tasks/4.2b/plan.md`, including its "Lead revisions (19 Oct 2026)" section:
refuse every turn carrying an attachment inside `packages/harness/src/pipeline/steps/scrub.ts`
(`ScrubFailedError({ guardCause: 'attachment' })`), before the guard chain or the skill-payload
walk, without reading anything about the attachment — not even its storage key. The refusal is not
in `admit`: the runner's raw-text `distressCheck` still runs first and still escalates when an
attachment is present (the regression test named in the brief).

## Acceptance evidence

| Item | Evidence (command → trimmed output) |
|---|---|
| Attachment refused before the guard chain or payload walk, no bypass | `packages/harness/src/pipeline/steps/scrub.test.ts`, describe `"scrub: an attachment is refused, not scrubbed (task 4.2b)"`: 1 attachment, 2 attachments (schema cap), empty `[]` (not a refusal, regression), PII text+skillPayload alongside an attachment, a fake `piiScrub` guard whose `run` is asserted never called, a 4-row adversarial fixture-label table (ID card / rotated-split / no-text / slow-OCR, `storageKey` only), the thrown error's `shown()` form never containing text/skillPayload/storageKey/mime, and `ATTACHMENT_REFUSED_REPLY` content checks. `corepack pnpm --filter @edmate/harness test -- scrub.test.ts` → `Test Files 69 passed (69)` / `Tests 3134 passed (3134)`. |
| Wired into the pipeline, fail closed | `packages/harness/src/pipeline/runner.test.ts`, describe `"an attachment-bearing turn is refused at the scrub step (task 4.2b)"`: `events === [{type:'error', code:'guard_blocked', retryable:true}]`, `t.gateway.requests` has length 0 (no model call), `steps.commits[0]?.input === null`, `result.background` has exactly one `{task:'runner', error: ScrubFailedError}` with `cause: {guardCause:'attachment'}` and no `errorName`. |
| **The distress check still runs on the raw text, attachment or not (critical regression)** | Same describe block, test `"the raw-text distress check still runs and escalates even with an attachment present (regression)"`: a turn with a raw-distress marker in `text` *and* a non-empty `attachments` array still ends `{type:'safety', level:'alert'}` → the caring reply (`LAST_RESORT_DISTRESS_REPLY`, since the scrub failed before any step saw the text) → `done`; `t.alerts.raised` has length 1; `steps.commits[0]` matches `{outcome:'escalated', intent:'distress', input:null}`; the scrub's own failure is still reported on `result.background` (reported, not swallowed). A third test contrasts the no-distress-hit case, which takes the ordinary `guard_blocked` path. |
| Harness purity, full gate | `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --force` → `Tasks: 34 successful, 34 total`; `@edmate/harness:test` → `Test Files 69 passed (69)` / `Tests 3137 passed (3137)`; `@edmate/harness:typecheck` and `@edmate/harness:lint` both ran clean (no errors printed, part of the 34/34 success). No `packages/contracts/**` edit, no new dependency, no new port. |
| Secret scan | `python3 .githooks/secret-scan.py --all` → no output, exit clean. |

## Changes

- `packages/harness/src/pipeline/errors.ts` — added `'attachment'` to `ScrubFailureCause`; updated
  `ScrubFailedError`'s doc comment to note `'attachment'` is a deliberate, by-design refusal, not a
  bug.
- `packages/harness/src/pipeline/steps/scrub.ts` — the attachment check at the top of the step
  (before the guard chain / payload walk); exported `ATTACHMENT_REFUSED_REPLY`; updated the header
  comment to describe what 4.2b actually does (the old "text inside images is task 4.2b" seam note
  is now the description).
- `packages/harness/src/pipeline/steps/scrub.test.ts` — new `describe` block, see table above.
- `packages/harness/src/pipeline/runner.test.ts` — new `describe` block, see table above.
- `packages/harness/src/pipeline/index.ts` — re-exported `ATTACHMENT_REFUSED_REPLY`.
- `packages/harness/README.md` — new bullet under the PII-scrub section describing the
  attachment-refusal stopgap and pointing at this task.

## Deviations from the plan

None. One technical note while following the plan's own test-first order: the plan's draft
assertions ("ends `guard_blocked`... nothing committed", "the regression test... escalates") were
written before the runner's exact commit/background shape on a scrub failure was re-checked against
the existing code; the actual assertions in the test file match the runner's real behaviour for any
scrub failure (an existing pattern, unchanged by this task): a commit entry is still recorded with
`input: null` (not zero commits), the escalation path replies with `LAST_RESORT_DISTRESS_REPLY` (the
runner's existing fallback-escalation reply used whenever the scrub itself failed, not the
`TEST_CARING_REPLY` test double used when the scrub step itself still returns `ok`), and the scrub's
`ScrubFailedError` is still reported on `result.background` in the escalation case too (reported,
never swallowed, matching 4.2's own rule for every scrub failure). This is proving the existing
4.2 mechanics correctly, not a scope change.

## Decisions

### 19 Oct 2026 · 4.2b — refuse attachments now, design the real pipeline as a follow-up
Decided: every turn carrying an `attachments` entry is refused at the scrub step, before anything
about it is read, until a real extract-and-scrub (OCR/vision) pipeline exists. The refusal reuses
4.2's existing fail-closed mechanics (`ScrubFailedError`, `guard_blocked`); the raw-text distress
check still runs first and still escalates.
Why: no OCR/vision pipeline exists anywhere in the repo; photo upload is explicit P1 (MVP out) per
the PRD and build plan. Building the real pipeline now would need a new storage-fetch port, a new
OCR/vision port or a `ModelRequest` content-block change (either way a `packages/contracts` ADR
reviewed by architect, security-reviewer and typescript-reviewer), and real/fixture OCR output wired
through `packages/evals` — materially bigger than a guard task and building infrastructure for a
deferred feature.
Alternatives: build the real OCR/vision pipeline now (rejected — out of scope, needs an ADR, a board
follow-up should carry it when photo upload is scheduled).
Reversible: yes — this is a stopgap guard, not a contract or schema change; a later task can replace
the refusal with real extraction without touching this decision.
Risk: medium.

### 19 Oct 2026 · 4.2b — no injectable FallbackReplies.attachmentRefused hook yet
Decided: `ATTACHMENT_REFUSED_REPLY` is a fixed exported English constant, not plumbed through an
injectable `FallbackReplies` hook.
Why: nothing in the runner currently reads any such hook for a `guard_blocked` turn — the wire
`TurnEvent`'s `error` variant has no text field at all, so an injectable surface would be unused
plumbing today.
Alternatives: add the hook now for consistency with `limitReached`/`lockedReply` (rejected — no
caller, no localisation need yet).
Reversible: yes.
Risk: low.

### 19 Oct 2026 · 4.2b — the missing client-visible text on guard_blocked turns stays a separate,
cross-cutting fix
Decided: 4.2b does not invent a wire-delivery mechanism for guard-blocked reply text (the same
pre-existing gap `DEFAULT_LIMIT_REACHED_REPLY` already has, and every future `guard_blocked` case,
e.g. 4.4's moderation/jailbreak blocks, will have too).
Why: that is a `TurnEventSchema`/`apps/web` composition concern, not a guard task's job; the lead
flagged it as 9.4 scope.
Alternatives: add a message field to the wire `error` event now (rejected — needs its own ADR and
contracts change, bigger than this task).
Reversible: yes.
Risk: low.

### 19 Oct 2026 · 4.2b — PII smuggled inside `skillPayload` (e.g. base64 image data) stays out of
scope
Decided: accepted as a known, pre-existing gap, not addressed by this task.
Why: this task is scoped to the `attachments` field; `skillPayload` is still scrubbed by the
existing pattern-based text scrub, which cannot parse binary-encoded image data. Not new to 4.2b.
Alternatives: none evaluated — explicitly out of scope per the lead's revisions.
Reversible: n/a (no code change made for this).
Risk: low (noted for awareness, not a blocking item).
