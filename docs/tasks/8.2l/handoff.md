# 8.2l handoff: caption upload centre (apps/web) and the ADR-0014 amendment

Status: DONE

## Summary
Phase C of 8.2c (docs/tasks/8.2c/plan.md): the teacher upload centre now accepts a caption file
(`.vtt` or `.srt`) the teacher exports from YouTube Studio for their own video, and the YouTube
link refusal points to it. `apps/web/src/studio/files.ts` gained a `caption(...)` helper and two
`UPLOAD_TYPES` rows (`text/vtt` → `vtt`, `application/x-subrip` → `srt`), both filed as
`chunkKind: 'transcript'` (Q2, same as audio/video, so a citation reads as a recording with a
timestamp) at the ordinary 20 MB document cap (Q3). `uploadClient.ts`'s `CLIENT_UPLOAD_TYPES`
mirrors the two rows; `ACCEPT` picks them up with no further change, and `contentTypeFor`'s
existing extension fallback already maps `.srt` (browsers often report `''` or `text/plain`) and
`.vtt` with no new code. `routes.ts`'s `create` and `complete` needed no logic change — the
existing `newFile`/`uploadTypeFor` table lookup and the `media = video || audio` check (so only
audio/video get a `mimeType`) already produce the plan's exact behaviour for the new kinds once
the table carries them. `LINK_REFUSAL_MESSAGE.youtube_unsupported` is now the Q1 words: "YouTube
links can't be added. Upload your video's caption file (.vtt or .srt) from YouTube Studio, or the
video file." `UploadsView.tsx` shows one new hint line (Q4) under the file picker. `en.json`'s
`uploads.acceptHint` and `uploads.errors.unsupported_type` now name caption files, and a new
`uploads.youtubeHint` key holds the Q4 hint; `uploads.reasons.unsupported`'s "or as a PDF" wording
was left as it is (plan: a LOW for later). `docs/adr/0014-web-link-egress.md` is amended: the
Status line records the 8.2c amendment, Decision 10's pilot allow-list value is `*` (answered, no
longer provisional), and Decision 11's refusal text and B-47 note point at the caption-file
export; `check-headings.py` passes.

No `packages/contracts`, `packages/db`, `apps/worker` or `packages/queue` files were touched. No
real network or model call is used anywhere in the new tests.

## Files
- `apps/web/src/studio/files.ts` (edit): `caption()` helper, two `UPLOAD_TYPES` rows.
- `apps/web/src/studio/files.test.ts` (edit): a test for the two new rows' fileKind/chunkKind/cap.
- `apps/web/src/studio/uploadClient.ts` (edit): two `CLIENT_UPLOAD_TYPES` rows.
- `apps/web/src/studio/uploadClient.test.ts` (edit): `contentTypeFor` extension-fallback test for
  `.srt` (empty and `text/plain` browser types) and `.vtt`.
- `apps/web/src/studio/routes.ts` (edit): `LINK_REFUSAL_MESSAGE.youtube_unsupported` words.
- `apps/web/src/studio/routes.test.ts` (edit): `create` with `text/vtt` and `application/x-subrip`
  (201, key extension, `kind: 'transcript'`); a caption over 20 MB (413); `complete` enqueuing
  `{ fileKind: 'vtt' }` with no `mimeType`. The existing YouTube-refusal test already asserts only
  `/YouTube/` in the message, so it needed no change.
- `apps/web/app/teacher/uploads/UploadsView.tsx` (edit): one hint line under the file picker.
- `apps/web/app/teacher/uploads/UploadsView.test.tsx` (edit): the picker's `accept` includes
  `.vtt`/`.srt`, and the YouTube hint text renders. The existing axe test (unchanged) still passes
  with the new hint in the tree.
- `apps/web/messages/en.json` (edit, `uploads.*` only): `acceptHint` and
  `errors.unsupported_type` reworded to name caption files; new key `uploads.youtubeHint`.
  `uploads.reasons.unsupported` untouched.
- `docs/adr/0014-web-link-egress.md` (edit): Status line, Decision 10, Decision 11, per the plan's
  draft text verbatim.

## Tests
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`: 34/34 tasks successful (31
cached). No test failures. Coverage for every touched file stayed at or near 100% (files.ts 100%,
uploadClient.ts 100%/90%/100%/100%, routes.ts 98.97%/99.04%/96.15%/100%) — all above the 80%
threshold. `python3 docs/adr/check-headings.py` passes. `python3 .githooks/secret-scan.py --all`
clean. All fixture text (caption filenames, synthetic bodies) is made up for this task; no real
caption, teacher upload or student data is in the repo.

Manual evidence: not re-run in this phase (no dev stack started); the end-to-end `.vtt` → `ready`
path was already proven in 8.2k's integration test (`apps/worker/test/ingest.int.test.ts`,
real Postgres/Redis). This phase only adds the web-side type table, message and hint, each covered
by its own unit/route/component test above.

## Decisions

### 22 Oct 2026 · 8.2l ADR-0014 amended for the B-47 caption-file answer · decided by builder · risk: high
- Decided: `docs/adr/0014-web-link-egress.md`'s Status line records an 8.2c amendment; Decision
  10's pilot allow-list value is stated as `*` (no longer "stands until the human answers");
  Decision 11's refusal text and B-47 line point at the caption-file export, keeping "Any YouTube
  fetch needs its own ADR." The text matches the plan's draft (docs/tasks/8.2c/plan.md, Phase C)
  verbatim; no wording beyond it was added.
- Why: B-47 (human, 22 Oct 2026, log "YouTube material comes from the owner's exported captions;
  web links fetch any public https site") answers the open question Decision 10 and 11 both
  flagged as pending. The plan's Lead answers section names architect, security-reviewer and an
  opus typescript-reviewer as required on this phase for exactly this edit.
- risk: high (docs/adr/** is a risky path per `.claude/skills/merge-gate/risk-paths.txt`). Required
  reviewers: architect, security-reviewer, typescript-reviewer.

### 22 Oct 2026 · 8.2l caption upload type table (chunk kind, cap, content type) · decided by builder · risk: low
- Decided: `.vtt`/`.srt` are filed as `chunkKind: 'transcript'` at the existing 20 MB document cap,
  with `application/x-subrip` as the SRT content type (no IANA type exists) and an
  extension-based client fallback for it.
- Why: matches the plan's Q2/Q3 recommendations and the Lead answers section ("accepted as
  recommended"); `create`/`complete`/`contentTypeFor` needed no logic change because the existing
  table-driven dispatch already produces the right behaviour once the table carries the new rows —
  verified by the new route and client tests above.
- risk: low (additive table rows and one message string; no change to existing types' behaviour,
  confirmed by the full @edmate/web suite staying green with no snapshot changes needed).

## Left to do
Nothing for 8.2c. All three phases (8.2j Phase A, 8.2k Phase B, 8.2l Phase C) are now done. Q5
(linking back to the YouTube video with a timestamp) and Q6 (the 8.2d "Promise.reject idiom" LOW)
are recommended not-done / wontfix per the plan and were not touched here. 12.3c (rights checkbox)
can now build against the shared files it listed (`routes.ts`, `uploadClient.ts`, `UploadsView.tsx`,
`en.json`) — it appends a `legal` block to `en.json` and was not run concurrently with this phase.

Status: DONE
Tool calls used: 60 (harness count; the builder reported 44)
