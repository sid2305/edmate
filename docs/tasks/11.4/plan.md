# 11.4 plan: live-class recording ingestion into the agent's knowledge (P1)

Board: 11.4 (M11), deps 11.1, 5.2, 8.1, 9.1, M6 (all done). Planned 22 Oct 2026.

Status: **READY.** No open question blocks Phase A. Phases B and C wait on other tasks merging first (see "Build order"), not on answers. Q2 (consent wording) goes to the human. If it isn't answered when Phase C starts, the builder uses the recommended wording.

## Acceptance (verbatim)
Build plan 11.4: "Live-class recording ingestion into the agent's knowledge (P1). *Accept:* searchable within 15 minutes."
PRD T12: "Add live-class recordings to the agent's knowledge | Recording searchable within 15 minutes | P1".

Human answer B-47 (22 Oct 2026): YouTube material comes from the owner's exported caption file (.vtt or .srt), and Edmate never calls YouTube. Web links may fetch any public https site. This task follows B-47: the cheapest, fastest path for a class recording is its **transcript or caption file** (Zoom exports one as .vtt). Audio stays supported.

### How it will be shown
1. **Linked and searchable (Phase A, db int tests).**
   - A document created with `liveClassId` for one of the teacher's own classes that has already started gets that class id.
   - Its chunks, written through the existing `chunks.insertManyIfStorageKey`, come back from the existing scoped retrieval search (`retrieval.int.test.ts` pattern) for that module. Their locator is a timestamp.
   - `liveClasses.listRecordingsForTeacher` returns the recording with its status.
   - Another teacher's class, a class that hasn't started and a missing class all give `not_found`, and nothing is written.
2. **No wait added anywhere (Phase B, route tests).** `complete` on a class recording enqueues at once on the existing `edmate-ingest` queue, with the same job shape as any upload: no `delay`, and the same `fileKind`/`mimeType` rules.
   - A recording type the worker can't transcribe is refused at `create` with 413 and fixed words, before any upload. Today such a file uploads (up to 500 MB) and fails minutes later. Example: a video or M4A over 24 MB (Q3).
   - Only transcript-kind types (captions, audio, video) may carry `liveClassId`.
3. **Teacher flow (Phase C, view tests and manual dev-stack run).** On `/teacher/live-classes`, a class that has started shows "Add recording". The teacher:
   - picks a .vtt/.srt/.mp3/.wav (or a short .m4a/.mp4/.webm),
   - picks one module out of the class's packages,
   - ticks the 12.3c rights declaration and the recording-consent line (Q2),
   - uploads.
   The class row then shows `uploading → processing → ready` (or `failed` with a fixed reason), polled live, and still shows after a reload.
   - Manual evidence in the Phase C handoff: one synthetic `.vtt` through the dev stack to `ready`, with the seconds from `complete` to `ready` taken from the worker log (dev stack with `EDMATE_INGEST_EMBEDDINGS=off`; captions need no transcriber).
4. **The 15-minute budget, stated in the Phase C handoff.**
   - Captions and transcripts reach `ready` in seconds. The pipeline is parse, chunk, write, embed, with no transcription.
   - A 60-minute MP3 at 128 kbps is about 58 MB. It becomes 3 Whisper pieces of 24 MB or less, transcribed one after another.
   - A real-audio timing can't run in tests (no real model calls). Q5 asks the lead or human to time one real recording during the 9.0 try-it run.
   - Chunks can be searched by full text as soon as they're written. Status is display only (documents repo: "never a retrieval gate").
   - B-43: material added after publish reaches students at once, without a republish.

## What already exists (reused, not rebuilt)
- **The ingest pipeline end to end:** upload centre `create → PUT → complete` (8.2), the `edmate-ingest` queue and processor (`apps/worker/src/ingest/processor.ts`), and Whisper transcription with WAV/MP3 splitting (`packages/gateway/src/transcriber`).
- **Caption files** (`vtt`/`srt`): parse 8.2j (done), worker 8.2k (running), upload centre 8.2l (todo).
- **Rights declaration on every upload:** 12.3b (running) and 12.3c (todo).
- **Retrieval by teacher and module.** A new document's chunks are searchable once written.
- **No change** to `packages/ingest`, `packages/queue`, `packages/gateway` or `apps/worker`.

**Gap this task closes (found while planning).** The worker composes `createWhisperTranscriber` with no chunker, so only WAV and MP3 over 24 MB can be split. A typical Zoom or Meet MP4, or a Zoom M4A over 24 MB, uploads fine (the cap is 500 MB) and then fails as `input_too_large` after the download. Phase B refuses those files up front with words that point to MP3 or the transcript file (Q3). A real fix is an ffmpeg chunker, which is a new system binary in the worker image and so needs an ADR. That is a follow-up (M13), not this task.

## Files out of bounds (every phase)
- `packages/contracts/**` (no contracts change and no ADR: `DocumentInput` and the live-class rows are local types in `packages/db`)
- `packages/harness/**`, `packages/ingest/**`, `packages/queue/**`, `packages/gateway/**`, `apps/worker/**`
- `packages/db/src/identity/**`, `apps/web/src/auth/**`, `apps/web/app/home/**`, `apps/web/app/teacher/uploads/**`, `apps/web/app/legal/**`
- `content/**`, `docs/adr/**`, `.claude/**`, `.github/**`, `.githooks/**`

Fixtures are synthetic text only. No real recording, transcript or caption file goes in the repo (rule 5).

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- **Phase A:** `packages/db/src/repositories/chunks.ts`, `live-classes.ts` and (append-only) `index.ts` match `packages/db/src/repositories/**`.
  - Required: **security-reviewer**. Recommended, per the precedent for this folder (8.4a, 8.5a, 8.6b, 11.1a): **database-reviewer** (new migration with a foreign key), code-reviewer and typescript-reviewer.
  - The Phase A handoff logs a `risk: high` decision.
  - The migration only adds a column and an index. It drops and deletes nothing, so the drop rule in `merge_gate.py` doesn't apply.
  - `packages/db/src/schema/**`, `packages/db/migrations/**` and `packages/db/test/**` match no glob.
- **Phase B:** `apps/web/src/studio/**` matches no glob. **None.**
- **Phase C:** `apps/web/app/teacher/live-classes/**`, `apps/web/src/studio/liveClasses/**` and `apps/web/messages/en.json` match no glob. **None.**

## Shared files (don't run alongside; append-only where noted)
| File | Phase | Shared with | Rule |
|---|---|---|---|
| `packages/db/src/repositories/chunks.ts` (`documentsRepo.create`) | A | **12.3b** (running, adds `rightsDeclared`), 12.3e, 8.2i, 8.2a | A starts only after 12.3b merges; not alongside 12.3e or 8.2i |
| `packages/db/src/repositories/live-classes.ts` | A | 11.1d (M13) | not alongside 11.1d |
| `packages/db/src/schema/content.ts`, `packages/db/migrations/*` + `meta/_journal.json` | A | any migration task (e.g. 11.2c) | take the next free migration number on `main`; merge `main` before pushing (no rebase) |
| `packages/db/src/repositories/index.ts`, `packages/db/src/index.ts`, `repositories/README.md`, `test/repositories.int.test.ts` (CASES), `test/scope.test.ts` | A | every db task | append-only, no reordering |
| `apps/web/src/studio/files.ts`, `routes.ts`, `uploadClient.ts` (+ tests) | B | **8.2l**, **12.3c**, 8.2a | B starts only after 8.2l **and** 12.3c merge |
| `apps/web/app/teacher/live-classes/*`, `apps/web/src/studio/liveClasses/loadLiveClasses.ts` | C | 11.1d, 11.2 follow-ups | not alongside them |
| `apps/web/messages/en.json` | B, C | everyone | B edits `uploads.errors.*` (one new key); C appends keys inside `liveClassesStudio` only |

## Build order
Run 11.4a (Phase A) after 12.3b merges. Run 11.4b (Phase B) after 11.4a, 8.2l and 12.3c merge. Run 11.4c (Phase C) after 11.4b. Each phase is a fresh builder that reads this plan and the previous phase's handoff.

---

## Phase A: packages/db, link a recording to its class (~60 tool calls)

### Files
- `packages/db/migrations/<next>_document_live_class.sql` (new) and its `meta/` snapshot and journal entry, made the way the db README and the `database-migrations` skill say. The SQL:
  - `ALTER TABLE documents ADD COLUMN live_class_id text`.
  - The foreign key `REFERENCES live_classes(id) ON DELETE SET NULL`, added `NOT VALID` then `VALIDATE`d (the 0017 lesson in 8.2a). `SET NULL` means 11.1d's later cancel or delete of a class never strands or blocks its recordings.
  - A partial index `documents_live_class_id_idx ON documents (live_class_id) WHERE live_class_id IS NOT NULL`.
  - There is no backfill.
- `packages/db/src/schema/content.ts` (edit): `documents.liveClassId` is nullable text that references `liveClasses.id` (lazy thunk, `onDelete: 'set null'`), plus the index. If importing `operations.ts` makes an import cycle that lint refuses, keep the FK in SQL only and say so in the handoff.
- `packages/db/src/repositories/chunks.ts` (edit, `documentsRepo.create` only):
  - `DocumentInputSchema` gains `liveClassId: IdSchema.optional()`.
  - When it is set, the existing `INSERT … SELECT FROM modules WHERE …` also requires `EXISTS (select 1 from live_classes where id = $lc and teacher_id = $t and starts_at <= now())`. Otherwise it gives `not_found` and writes nothing, the same shape as a foreign module, so class ids can't be probed.
  - It writes `live_class_id`.
  - `get`, `listForTeacher`, `startReplace` and `DocumentRow` stay as they are. A replace keeps the link.
- `packages/db/src/repositories/live-classes.ts` (edit): a new method, `listRecordingsForTeacher(scope: TeacherScope): Promise<LiveClassRecording[]>`.
  - It returns `{ liveClassId, documentId, sourceTitle, status, failureReason? }`, newest first, at most 500 (the `DOCUMENT_LIST_MAX` precedent).
  - It is one query: `documents` where `teacher_id = scope` and `live_class_id is not null`, joined to `live_classes` on `id` and the same `teacher_id`.
  - The existing `TeacherLiveClassRow` is **not** changed, so `apps/web` typechecks untouched in this phase.
- `packages/db/src/repositories/index.ts` and `src/index.ts`: export the `LiveClassRecording` type (append-only).
- `packages/db/src/repositories/README.md` (edit): a short "Live-class recordings (task 11.4)" note. Follow the "Adding a method" section: scope first, scope validated before any SQL, a `CASES` entry, and the `scope.test.ts` sweep.

### Tests first (red before code)
- `packages/db/test/documents.int.test.ts` (edit):
  - `create` with the teacher's own class that has started stores `live_class_id`.
  - Another teacher's class, a future class and an unknown id each give `not_found`, with no row and no revision bump.
  - Without `liveClassId`, behaviour is unchanged.
  - `startReplace` keeps the link.
- `packages/db/test/retrieval.int.test.ts` or `video-ingest.int.test.ts` (edit, whichever already writes transcript chunks): a class-linked transcript document's chunks are found by the scoped search for its module, with a timestamp locator. They are not found for a scope without that module.
- `packages/db/test/repositories.int.test.ts` CASES and `test/scope.test.ts` (edit): cover `listRecordingsForTeacher`.
  - A bad scope throws `RepositoryError('scope')` before any SQL.
  - Two teachers' recordings never mix.
  - Status and failure reason come through after `updateStatus`.
- Migration test: follow `document-status-migration.int.test.ts`. The column is added, existing rows have `null`, and deleting a live class sets its documents' `live_class_id` to null.

### State after this phase
`documents.create` can link a recording to an own class that has started. `liveClasses.listRecordingsForTeacher` lists recordings by class. Nothing in the web app uses either yet. `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` is green (this filter includes the packages that depend on db, apps/web among them), and the db int tests are green against the builder's throwaway Postgres. The secret scan is clean. The handoff logs the `risk: high` decision.

## Phase B: apps/web studio API, class recordings and the fail-fast cap (~50 tool calls)

### Files
- `apps/web/src/studio/files.ts` (edit, Q3):
  - `media()` takes a `splittable` flag. `audio/mpeg` and `audio/wav` keep `MAX_MEDIA_UPLOAD_BYTES` (500 MB).
  - `audio/mp4`, `video/mp4` and `video/webm` get a new `MAX_UNSPLIT_MEDIA_BYTES = 24 * 1024 * 1024`. This equals `WHISPER_MAX_UPLOAD_BYTES` in `@edmate/gateway`. Import it if `apps/web` already depends on that package. If not, use a local constant with a comment, plus a test that pins the number.
  - Add `isRecordingType(t)`, which is true when `chunkKind === 'transcript'` (captions from 8.2l, audio, video).
- `apps/web/src/studio/routes.ts` (edit):
  - `CreateSchema` gains `liveClassId: Id.optional()`.
  - With `liveClassId` set, a type that isn't a recording type gives 400 `MSG.type`.
  - The id is passed to `b.documents.create`. A repo `not_found` (foreign class, not yet started, or missing) is already mapped to 404 by the handler wrapper. Confirm this with a test. No upload URL is signed and no row is written.
  - In `newFile`, a too-large unsplittable media file returns 413 with a new fixed message, `MSG.mediaTooLarge`: "Videos and M4A audio over 24 MB can't be transcribed yet. Upload the audio as MP3, or the class transcript (.vtt or .srt)."
  - `complete` doesn't change.
- `apps/web/src/studio/uploadClient.ts` (edit):
  - `createDocument`'s input gains an optional `liveClassId`.
  - Export `RECORDING_UPLOAD_EXTS` (`vtt, srt, mp3, wav, m4a, mp4, webm`) and `RECORDING_ACCEPT`.
  - Export `UNSPLIT_MEDIA_MAX_BYTES` with a `needsSmallerFile(file, contentType)` helper, for the client-side pre-check in Phase C.
- Tests: `files.test.ts`, `routes.test.ts` and `uploadClient.test.ts` (edits).
- `apps/web/messages/en.json`: only if the upload centre's client maps the 413 to a key. Then add one `uploads.errors.media_too_large` key and nothing else.

### Tests first
- `files.test.ts`:
  - The mp3/wav cap stays at 500 MB. The m4a/mp4/webm cap is 24 MB.
  - `isRecordingType` is true exactly for the transcript-kind rows.
- `routes.test.ts`:
  - `create` with `liveClassId` and `text/vtt` gives 201, and the repo receives `liveClassId`.
  - With `application/pdf` it gives 400 and nothing is written.
  - Repo `not_found` gives 404 and no `createUploadUrl` call.
  - A 30 MB `video/mp4` gives 413 with the new words. This holds with or without `liveClassId`.
  - A 30 MB `audio/mpeg` gives 201.
  - `complete` for a class recording calls `enqueue` once, with the existing job shape and no extra options. The pipeline adds no wait.
- `uploadClient.test.ts`:
  - `RECORDING_UPLOAD_EXTS` is a subset of `CLIENT_UPLOAD_TYPES`, and each one maps on the server to `chunkKind: 'transcript'` (table check against `UPLOAD_TYPES`).
  - The request body carries `liveClassId` only when it is given.

### State after this phase
The studio API accepts a recording linked to a class and refuses media the worker can't transcribe before upload. The upload centre behaves as before, except for that new 413. `--filter=@edmate/web...` (typecheck, lint, test) is green and the secret scan is clean.

## Phase C: apps/web live-classes page, "Add recording" (~80 tool calls)

### Files
- `apps/web/src/studio/liveClasses/loadLiveClasses.ts` (edit):
  - Add `liveClasses.listRecordingsForTeacher` to `LiveClassesPageRepos` and to the `Promise.all`.
  - `LiveClassesPackage` gains `moduleIds` (from `config.moduleIds`).
  - The data gains `recordings` and `now` (server ISO time). The class-has-started check is computed against `now`, which keeps the view pure and testable.
- `apps/web/app/teacher/live-classes/RecordingUpload.tsx` (new, client): the form for one class.
  - A file input (`accept={RECORDING_ACCEPT}`).
  - A module `<select>` holding the union of `moduleIds` from the class's attached packages, shown as ids like the upload centre (module names are 8.2a). If that union is empty, show a fixed hint and no form.
  - A title, default "Live class: {title}, {date}", editable, 1–500 characters. It becomes the citation the student sees.
  - The 12.3c rights-declaration checkbox, reusing its component or wording exactly as 12.3c ships it.
  - The recording-consent checkbox (Q2).
  - Steps: client pre-check (`needsSmallerFile` shows the 24 MB message and stops), then `createDocument({ …, liveClassId, rightsDeclared: true })`, then `putFile` with progress, then `completeDocument`.
  - Lessons ("UI state and server replies"):
    - every call is in try/catch/finally around one busy flag;
    - the body read is caught;
    - payloads go through `safeParse` with a fallback view;
    - the form resets after success and after failure.
- `apps/web/app/teacher/live-classes/LiveClassesView.tsx` (edit, additive):
  - Each class shows its recordings: title, status and the fixed failure reason.
  - A class with `startsAt <= now` shows the "Add recording" toggle that opens `RecordingUpload`.
  - While any shown recording is `uploading` or `processing`, the view polls `listDocuments()` every 5 s. It stops when none are pending and on unmount, and it updates statuses by document id.
- `apps/web/app/teacher/live-classes/page.tsx` (edit): pass `recordings` and `now`. Pass the `uploads` namespace into the client provider too, so failure reasons reuse `uploads.reasons.*` and aren't copied.
- `apps/web/messages/en.json` (edit): new keys inside `liveClassesStudio.recording.*` only.
- Tests: `RecordingUpload.test.tsx` (new), `LiveClassesView.test.tsx` and `page.test.tsx` (edit), and the `loadLiveClasses` test if one exists (else add it to `page.test.tsx`).

### Tests first
- `RecordingUpload`:
  - The happy path calls create, then PUT, then complete in order, with `liveClassId`, the chosen module and `rightsDeclared: true`.
  - Submit stays disabled until both boxes are ticked and a file and module are chosen.
  - A 30 MB `.mp4` shows the 24 MB message, and no create call is made.
  - A 200 response with a malformed body, a 404 and a PUT failure each show an error and re-enable the form, with the busy flag cleared.
  - The module list holds only the attached packages' modules.
  - jest-axe is clean.
- `LiveClassesView`:
  - A class that hasn't started shows no "Add recording". One that has started does (fixed `now`, no clock mocking).
  - Recordings render under their own class only.
  - Polling starts with a `processing` row, updates it to `ready` from a faked `listDocuments`, and then stops (fake timers).
  - Unmount clears the timer.
  - A bad poll payload keeps the last good view.
- `page.test.tsx`: the guard runs before any read, and `listRecordingsForTeacher` is called in the teacher's own scope.

### State after this phase (task done)
A teacher adds a class's transcript, captions or audio from `/teacher/live-classes`. The class row shows it reach `ready`, and its chunks are searchable by students whose package includes the chosen module, cited as "Live class: …" with a timestamp. `--filter=@edmate/web...` (typecheck, lint, test, build) is green and the secret scan is clean. The handoff has the manual dev-stack evidence (step 3) and the latency budget (step 4).

---

## Open questions (each has a recommendation; none blocks Phase A)
- **Q1, link the recording to its class (migration) or not?** Recommend linking: a nullable `documents.live_class_id`, Phase A. The class row then shows its recording and status across reloads.
  - The alternative is no migration. Phase A is dropped (about 60 calls saved), the recording is a plain upload with a "Live class: …" title, and the class row shows status only until reload.
- **Q2, students' voices and names (privacy; the human's call).** A class recording can carry students' names, voices and questions, and it becomes material that other students' agents can quote. Recommend for the MVP:
  - a required second checkbox: "Everyone heard in this recording agreed to it being used to teach, or I removed their parts";
  - a hint: "Best: upload your own transcript with students' names removed".
  - Automatic name scrubbing isn't feasible now.
  - Alternatives: (b) teacher-only audio, with the hint as the only safeguard; (c) block recordings until a scrub exists.
  - The lead should add this to `.claude/blockers.md`. Phase C uses the recommended wording if it isn't answered.
- **Q3, refuse media the worker can't split (over 24 MB, not MP3/WAV) at upload?** Recommend yes (Phase B). It also changes the upload centre, where such files fail today after the upload.
  - Add an M13 board task: an ffmpeg chunker in the worker, so MP4, WebM and M4A recordings of any length work. It needs an ADR (a new system binary, tech stack) with architect, security-reviewer and typescript-reviewer.
- **Q4, which module a recording goes to.** Recommend the teacher picks one module from the union of the class's attached packages' modules. Those packages' students can then search it. Module names in the picker wait for 8.2a, as in the upload centre.
- **Q5, real-audio timing for "within 15 minutes".** Tests can't call Whisper. Recommend the lead (or the human, with their key) times one real 60-minute MP3 during the 9.0 try-it run and logs the number.
  - Known tail risk: the queue runs one job at a time across all teachers, and each Whisper piece has a 10-minute timeout, so a hung piece plus a retry can pass 15 minutes.
  - Recommend an M13 task (a separate media queue or a job priority) only if the pilot shows it.
- **Q6, only classes that have started can take a recording; many recordings per class?** Recommend yes to both. A class can have, for example, a transcript plus an audio file, or a recording in parts. There is no extra cap: the upload centre's limits apply.

## Lead answers (22 Oct 2026)
- Q1: yes, link it: nullable `documents.live_class_id` in Phase A.
- Q2: goes to the human as B-52. Until it's answered, Phase C uses the recommended required consent checkbox and the "remove students' names" hint.
- Q3: yes, refuse media the worker can't split, at upload (Phase B). The ffmpeg chunker is board task 11.4d (M13; it needs an ADR).
- Q4: as recommended: one module from the union of the class's attached packages' modules.
- Q5: as recommended. The lead times a real 60-minute MP3 in the 9.0 try-it run. Add a media-queue task only if the pilot shows it's needed.
- Q6: yes to both. Only classes that have started can take a recording, and a class can have several.

## Decisions to log (handoffs)
- **Phase A, risk: high** (`packages/db/src/repositories/**`): `documents.live_class_id` (nullable, FK `ON DELETE SET NULL`, partial index). `documents.create` links only an own class that has started (`not_found` otherwise). New `liveClasses.listRecordingsForTeacher`. Required reviewer: security-reviewer. Recommended: database-reviewer, code-reviewer, typescript-reviewer.
- **Phase B, risk: medium:** unsplittable media (m4a/mp4/webm) is capped at 24 MB at upload, with fixed words. Only transcript-kind uploads may carry `liveClassId`.
- **Phase C, risk: medium:** the recording-consent wording (Q2, pending the human), the module picker scope (Q4), and the 5 s status poll.
- **Lead:** add the M13 follow-ups from Q3 (ffmpeg chunker plus ADR) and Q5 (media queue or priority, if needed).

## Budget
Budget: 190 tool calls (3 phases: A packages/db ~60; B apps/web studio API ~50; C apps/web live-classes UI ~80)

Each phase gets a fresh builder that reads this plan and the previous phase's handoff. Board tasks: 11.4a (A), 11.4b (B), 11.4c (C), each with its own handoff under `docs/tasks/<phase id>/`.

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash. Bash is limited to:
- `corepack pnpm` install, typecheck, lint, test and build for the phase's packages;
- the db package's migration-generate command (Phase A only);
- `python3 .githooks/secret-scan.py`;
- git on the phase's own branch (no rebase, no force push);
- `docker`, only for throwaway Postgres and Redis test containers (and the dev stack in Phase C), removed afterwards.

No network calls beyond the package manager, and no real model or transcription calls.

## Exit conditions
- **DONE:**
  - The phase's tests were written red first and now pass.
  - Its gates are green (`--filter=@edmate/db...` for A, `--filter=@edmate/web...` for B and C) and the secret scan is clean.
  - The diff touches only the phase's listed files.
  - The handoff has `Status: DONE`, `Tool calls used:`, files, tests and decisions. Phase A's decisions include the `risk: high` entry naming security-reviewer.
- **PARTIAL (stop and hand off):**
  - Phase A passes about 75 tool calls, B about 65, or C about 95.
  - A file outside the phase's list needs changes, notably `packages/contracts/**`, `apps/worker/**`, `packages/ingest/**`, `packages/queue/**`, `apps/web/src/auth/**`, or `TeacherLiveClassRow` / `DocumentRow` in Phase A.
  - The migration would need to drop, rewrite or backfill data.
  - A new dependency looks necessary.
  - The gate fails twice for the same cause.
  - Phase B finds that 8.2l or 12.3c isn't merged.
