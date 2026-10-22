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

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web` — 10/10 tasks passed.
`python3 .githooks/secret-scan.py --all` — clean (no output).

Tool calls used: 48
