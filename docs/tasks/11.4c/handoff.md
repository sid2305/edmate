# 11.4c handoff: live-classes page "Add recording" (11.4 Phase C, apps/web)

Branch: m11/11.4c-add-recording (local `work-114c`)
Worktree: .claude/worktrees/agent-af29ab2bb0b6a8a99
Plan: docs/tasks/11.4/plan.md, "Phase C"

## Summary
- `loadLiveClasses` also reads `liveClasses.listRecordingsForTeacher` (11.4a) in the signed-in
  teacher's own scope, inside the same `Promise.all` after the guard. Each package now carries
  `moduleIds` (from `config.moduleIds`), and the data carries `recordings` and `now` (server ISO
  time; an optional `deps.now()` clock for tests).
- New client component `RecordingUpload.tsx`: file input (`accept={RECORDING_ACCEPT}`), a module
  `<select>` over the union of the class's attached packages' modules (ids, as in the upload
  centre; a fixed hint and no form when the union is empty), an editable title (default
  "Live class: {title}, {date}", 1-500 characters), the 12.3c rights checkbox (exact 12.3c
  wording, "I confirm I hold the rights to upload this material.") and the recording-consent
  checkbox with the "remove students' names" hint (Q2, option (a)). Submit stays disabled until
  a file, a module and both boxes are set. Steps: type check against the recording types,
  `needsSmallerFile` pre-check (shows the 24 MB words, no create call), `createDocument` with
  `liveClassId` and `rightsDeclared: true`, `putFile` with progress, `completeDocument`.
  One busy flag, try/catch/finally, the create ticket and complete reply go through `safeParse`
  (a malformed ticket is an error; a malformed complete reply falls back to `processing`), and the
  form resets after success and after any server failure. A refusal that carries the server's
  fixed `message` (for example 11.4b's 413 words) shows that message; otherwise our own words.
- `LiveClassesView.tsx` (additive): each class lists its recordings (title, status from
  `uploads.status.*`, and for `failed` the fixed reason from `uploads.reasons.*`). A class with
  `startsAt <= now` shows an "Add recording" toggle (`aria-expanded`, labelled "Add a recording to
  {title}") that opens `RecordingUpload`. A new upload is upserted by document id. While any shown
  recording is `uploading` or `processing`, the view polls `listDocuments()` every 5 s, one read at
  a time; the payload goes through `safeParse`, a bad/refused/thrown read keeps the last good view,
  the poll stops when nothing is pending and on unmount, and only rows whose document id matches
  change.
- `page.tsx` passes `recordings` and `now`, and gives the client provider the `uploads` namespace
  too, so status and failure words are reused, not copied.
- `apps/web/messages/en.json`: new keys inside `liveClassesStudio.recording.*` only.

## Files
- apps/web/src/studio/liveClasses/loadLiveClasses.ts
- apps/web/app/teacher/live-classes/RecordingUpload.tsx (new), RecordingUpload.test.tsx (new)
- apps/web/app/teacher/live-classes/LiveClassesView.tsx, LiveClassesView.test.tsx
- apps/web/app/teacher/live-classes/page.tsx, page.test.tsx
- apps/web/messages/en.json (`liveClassesStudio.recording.*`)
- docs/tasks/11.4c/handoff.md

## Tests
Written red first (RecordingUpload suite failed with the component missing; the view and page
cases failed on the missing props and repo call), then green.
- `corepack pnpm exec vitest run app/teacher/live-classes/` → `Tests 42 passed (42)`.
- RecordingUpload (17): happy path order create → PUT → complete with `liveClassId`, chosen module
  and `rightsDeclared: true`; edited title trimmed; empty title refused; submit disabled until all
  four inputs; consent hint shown; 30 MB `.mp4` shows the 24 MB words with no create; a PDF is
  refused with no create; malformed 200, thrown create, 404, server message, failed PUT, refused
  complete and malformed complete reply each handled with busy cleared; module list holds only the
  given modules; empty module union shows the hint; jest-axe clean.
- LiveClassesView (12 new): Add recording only for a started class (fixed `now`, including
  `startsAt == now`, none without `now`); module picker = union of the class's packages' modules
  only; recordings render under their own class with status and failure reason; poll updates
  `processing` → `ready` then stops (fake timers); no poll when nothing is pending; unmount clears
  the timer; malformed payload, refused call and thrown call keep the last good view; a failed
  status shows its reason and unrelated documents are ignored; a new upload appears under its class.
- page (1 new + 2 edited): guard first, nothing read on refusal (including recordings),
  `listRecordingsForTeacher` called in the teacher's own scope, recordings and package
  `moduleIds` passed through.
- Gate: see the commit; `corepack pnpm turbo run typecheck lint test build --filter=@edmate/web...`
  and `python3 .githooks/secret-scan.py --all` were run after merging `origin/main`.

## Deviations
- Plan steps 3 (manual dev-stack run with a synthetic `.vtt`) and 4 (latency statement with a
  measured number) were skipped on the lead's instruction (never touch the running edmate-*
  containers). See "Left to do".
- A recording whose PUT fails stays `uploading` on the server, so the 5 s poll keeps running while
  the page is open (the same behaviour as the upload centre). Not changed here; noted for review.

## Decisions
### 22 Oct 2026 · 11.4c recording-consent wording (Q2, pending B-52) · decided by builder · risk: medium
- Decided: option (a). The form has a required second checkbox, "Everyone heard in this recording
  agreed to it being used to teach, or I removed their parts.", with the hint "Best: upload your
  own transcript with students' names removed." Submit stays disabled until it and the 12.3c
  rights box are ticked. The words live in `apps/web/messages/en.json` under
  `liveClassesStudio.recording.consentLabel` / `consentHint`, so the human can change them without
  a code change. The consent tick is not stored server-side (no contracts or db change in this
  phase).
- Why: the plan's and lead's instruction while B-52 is unanswered; class recordings can carry
  students' names and voices and become material other students' agents quote.
- risk: medium

### 22 Oct 2026 · 11.4c module picker scope and 5 s status poll · decided by builder · risk: medium
- Decided: the module picker offers the de-duplicated union of `config.moduleIds` of the packages
  attached to that class (shown as ids, as in the upload centre). The class row polls
  `listDocuments()` every 5 s only while one of its shown recordings is `uploading` or
  `processing`, one request at a time, and stops when none is pending or on unmount.
- Why: plan Q4 and Phase C; 5 s matches the plan and keeps load low (one list call per open
  page while something is pending).
- risk: medium

### 22 Oct 2026 · 11.4c rights checkbox reuses 12.3c's wording, not its component · decided by builder · risk: low
- Decided: `RecordingUpload` has its own checkbox with 12.3c's exact words
  ("I confirm I hold the rights to upload this material."), stored as
  `liveClassesStudio.recording.rightsLabel`, rather than importing from `app/teacher/uploads/**`.
- Why: 12.3c shipped the checkbox inline in `UploadsView.tsx` (no shared component), and
  `app/teacher/uploads/**` is outside this phase's files.
- risk: low

### 22 Oct 2026 · 11.4c failure reasons reuse uploads.reasons via a local key list · decided by builder · risk: low
- Decided: `LiveClassesView` keeps its own copy of the upload centre's reason-key list and maps
  unknown reasons to `uploads.reasons.other`; the words themselves come from the `uploads`
  namespace passed to the client provider.
- Why: `UploadsView.tsx`'s `reasonKey` is not exported and that folder is out of bounds.
- risk: low

## Left to do
- Plan step 3 for the 9.0 try-it run: one synthetic `.vtt` through the dev stack from
  `/teacher/live-classes` to `ready` (with `EDMATE_INGEST_EMBEDDINGS=off`), seconds from
  `complete` to `ready` taken from the worker log.
- Plan step 4 for the 9.0 try-it run: state the 15-minute budget with the measured caption
  number, and the lead (or human) times one real 60-minute MP3 (Q5).
- B-52 (human): confirm or change the consent wording above.

Status: DONE

Tool calls used: 24
