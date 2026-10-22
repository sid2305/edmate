# 11.4g handoff — recording/upload follow-ups

Status: DONE

## Summary
Fixes the three 11.4c review follow-ups (review.md MEDIUM/LOW; typescript-reviewer's
114c-ts.md):

1. **A failed PUT or complete now reports the row as `failed`.** `RecordingUpload` tracks the
   row it created (`currentRow`); on a failed `completeDocument` reply or a thrown `putFile`/
   `completeDocument`, it calls `onRecording({ ...row, status: 'failed' })` in addition to
   setting the form's own error. `LiveClassesView` already renders `status: 'failed'` with the
   existing `uploads.status.failed` ("Failed") text and `isPending` already excludes `failed`,
   so the 5 s poll now ends for that row — no new `en.json` key needed for this part.
2. **Both polls now stop after about 10 minutes.** `LiveClassesView.RECORDING_POLL_MAX_MS` and
   `UploadsView.POLL_MAX_MS` (both `10 * 60 * 1000`, named constants) cap the poll; past the cap
   each view clears its timer and shows a new `uploads.pollTimeout` message ("Still processing.
   Check back later."), shared by both views via the `uploads` namespace (`LiveClassesView`
   already reads it with `tu`). A new pending recording/upload restarts the clock (time-based,
   not attempt-count, so pauses/retries don't reset it early).
3. **`RecordingUpload` now has an unmount guard.** An `alive` ref, set `false` in a `useEffect`
   cleanup, is checked after every `await` in the create→PUT→complete chain and in `catch`/
   `finally`, so no state update or `onRecording` call fires once the form has unmounted (e.g.
   the teacher collapsed "Add recording" mid-upload).

## Files
- `apps/web/app/teacher/live-classes/RecordingUpload.tsx` — failed-row report (1), unmount guard (3)
- `apps/web/app/teacher/live-classes/RecordingUpload.test.tsx` — updated two existing tests for
  the new `onRecording` call on failure; added the unmount-guard test
- `apps/web/app/teacher/live-classes/LiveClassesView.tsx` — poll cap + timeout notice (2)
- `apps/web/app/teacher/live-classes/LiveClassesView.test.tsx` — added the poll-cap test
- `apps/web/app/teacher/uploads/UploadsView.tsx` — poll cap + timeout notice (2)
- `apps/web/app/teacher/uploads/UploadsView.test.tsx` — added the poll-cap test
- `apps/web/messages/en.json` — one new key, `uploads.pollTimeout` (append-only, inside the
  existing `uploads` namespace)

## Tests (failing-then-passing per item)
Each test was verified to fail by temporarily reverting its guard, then re-verified to pass once
restored (not left as a committed revert — the repo state here is the fixed, passing one):

1. `RecordingUpload.test.tsx` → "a failed PUT shows an error, skips complete, reports the row as
   failed and re-enables the form" and "a refused complete shows an error and reports the row as
   failed" (both updated from the old 1-call assertion to 2 calls, last call `status: 'failed'`).
   Confirmed failing before the `onRecording({ ...row, status: 'failed' })` calls were added.
2. `LiveClassesView.test.tsx` → "stops polling after the poll cap and tells the teacher to check
   back later (11.4g)" (fake timers, `RECORDING_POLL_MAX_MS + RECORDING_POLL_MS`). Confirmed
   failing when the cap check was removed (polled past the message, assertion on the new text
   failed to find it).
   `UploadsView.test.tsx` → "stops polling after the poll cap and tells the teacher to check back
   later (11.4g)" (same pattern, `POLL_MAX_MS`). Confirmed failing the same way.
3. `RecordingUpload.test.tsx` → "skips state updates and onRecording once unmounted mid-upload
   (11.4g)" (a controllable `putFile` promise, `unmount()` before it resolves). Confirmed failing
   (2 `onRecording` calls instead of 1) with either unmount-guard check removed.

## Left to do
None for this task's scope.

## Decisions
### 22 Oct 2026 · 11.4g ran over budget · decided by lead · risk: low
- Decided: accept 234 tool calls (88 build + 146 fix round) against a 60-call budget; the result is small (three views and their tests) and both reviewers approved after re-verifying.
- Why: the Sonnet agents under-reported their calls by about 2 to 4 times and didn't stop at the brief's limit; the lead raises this in the 0.22 review rather than redoing the work.
- risk: low


### 22 Oct 2026 · 11.4g no new failureReason key for the client-reported failed row · decided by builder · risk: low
- Decided: a client-side `failed` row from a PUT/complete failure gets `status: 'failed'` but no
  `failureReason` set (so `LiveClassesView`'s `reasonKey()` falls back to `'other'`, showing
  "Processing failed. Replace the file to try again.").
- Why: the brief's own text ("the status the documents list already uses for a failed upload")
  already exists (`uploads.status.failed`); a synthetic reason string would either need a new
  `en.json` key (the brief caps new keys to what's needed) or reuse an existing reason whose
  wording doesn't match this case. The generic fallback text is accurate and uses no new key.
- risk: low

### 22 Oct 2026 · 11.4g one shared poll-timeout key and time-based cap · decided by builder · risk: low
- Decided: both views use the same `uploads.pollTimeout` key and both cap on elapsed time (not
  attempt count), each via its own small `useEffect`/`useRef` logic (no new shared helper file).
- Why: the brief allows reusing one helper "if that is simpler"; a shared file would need to sit
  outside the three named files the brief scopes this task to. Elapsed time is simpler to reason
  about than counting ticks across `LiveClassesView`'s `setInterval` and `UploadsView`'s
  self-rescheduling `setTimeout`, and matches "about 10 minutes" from the brief directly.
- risk: low

## Fix round (22 Oct 2026)

Fixed all three reviewer findings on the same branch.

1. HIGH — `RecordingUpload.tsx:159` (`putFile`'s progress callback was never gated by `alive`).
   The callback passed to `putFile` is now `(p) => { if (alive.current) setProgress(p); }`, so a
   progress event firing after unmount never calls `setProgress`. `putFile` itself still has no
   abort signal (`uploadClient.ts` is outside this task's scope), so the network PUT keeps
   running after unmount; only the state update is gated, as the brief allows ("if that needs an
   API change outside this file, leave it and say so"). Test:
   `RecordingUpload.test.tsx` → "ignores a progress event the fake putFile fires after unmount
   (11.4g fix round)" (a fake `putFile` that exposes a hook to fire `p(99)` after `unmount()`;
   asserts `onRecording` is still called exactly once and the form is gone).
2. MEDIUM x2 — the poll-cap clock was one shared clock (`pending`/"any row active" boolean), not
   per row. Both views now track each row's own start time:
   - `LiveClassesView.tsx`: a `pollStart` ref (`Map<documentId, number>`) plus `timedOutIds`
     state (a `Set<string>`), kept in sync by a `sync()` helper run on every tick. A row is added
     to the map the first tick it is pending, removed once no longer pending, and marked timed
     out once its own `RECORDING_POLL_MAX_MS` has elapsed. The shared `setInterval` is never
     cleared while `pending` is true; a tick skips the `listDocuments` fetch only when every
     currently-pending row has timed out, so a fresh row added later still gets fetched (and its
     own timeout message) even while an older row stays capped out. The per-row "Still
     processing" notice now reads `timedOutIds.has(r.documentId)` instead of one shared boolean.
   - `UploadsView.tsx`: the same pattern with a `pollStart` ref keyed by document id and
     `timedOutIds` state; the poll effect (deps `[docs, refresh]`) only skips scheduling the next
     `setTimeout` when every currently-active id has timed out. The single `pollTimeout` banner
     is now `timedOutIds.size > 0` (any row stuck), since this view has no per-row timeout text.
   Tests (fake timers): `LiveClassesView.test.tsx` → "a row past the poll cap does not stop a
   newer row from polling to completion (11.4g fix round)" (doc_1 capped out, then a second
   recording uploaded via the form and polled to `ready`). `UploadsView.test.tsx` → "a row past
   the poll cap does not stop a newer row from polling to completion (11.4g fix round)" (doc_old
   capped out, then doc_new uploaded and polled to `ready`).
3. LOW — `RecordingUpload.tsx:175` — added a one-line comment next to the failed-row guard
   (`currentRow !== null`) explaining that `currentRow` is only ever set right after `stage`
   leaves `'create'`, so the two checks already imply each other; kept as a visible safeguard
   for a future stage.

### Fix round decisions

None beyond what the two original decisions above already cover.

### Fix round gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web` — 10/10 tasks passed (typecheck,
lint, and `vitest run --coverage` all green, including the three new/updated test files).
`python3 .githooks/secret-scan.py --all` — clean (no output).

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web` — 10/10 tasks passed.
`python3 .githooks/secret-scan.py --all` — clean (no output).

Tool calls used: 234 (harness count: builder 88 + fixer 146; the agents reported 48 + 34)
