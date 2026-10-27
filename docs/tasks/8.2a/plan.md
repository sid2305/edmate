# Plan 8.2a: 8.2 follow-ups (review MEDIUM/LOW)

## Goal
Board accept line: "a production worker or web with missing or dev storage config refuses to
start ingest or uploads and logs only a code; no orphan uploading row after a signing failure."
Close that gap (worker still falls back to dev S3 defaults in production; web's `create` still
writes the document row before signing the upload URL), plus the other cheap/local items from the
8.2 review that are still open, and sort every other follow-up named in 8.2a's title into
**defer** (a new board task) or **drop** (already done elsewhere, cited below). Nothing here
touches a real model, a real bucket or a real network call (rule 4); every storage/S3 call in
tests is the existing fake `S3Like`/in-memory stand-ins already used by `presign.test.ts`,
`roundtrip.test.ts` and `routes.test.ts`.

## Item sort (14 items from the board title)

### Now (6 items — ties to the accept line, or cheap and local)
1. **Worker `storageConfigFromEnv` falls back to dev defaults under any `NODE_ENV`**
   (`apps/worker/src/storage/roundtrip.ts:38-67`) — confirmed still open: `read()` always
   substitutes `DEV_DEFAULTS` for a missing/blank value, with no production check at all, unlike
   `apps/web/src/storage/presign.ts`'s `storageConfigFromEnv` (which already throws
   `StorageConfigError` under `NODE_ENV=production`). This is the accept line's first clause and
   the review's deferred MEDIUM (`review.md:13`, `apps/worker/src/storage/roundtrip.ts:44`).
2. **Studio `create` writes the row before signing** (`apps/web/src/studio/routes.ts:279-292`) —
   confirmed still open: `create` calls `b.documents.create(...)` then
   `b.storage.createUploadUrl(...)`; a signing failure after the write leaves an orphan
   `uploading` row. `replace` already signs first (the Phase 3 fix round, `review.md`'s other
   deferred LOW, `routes.ts:215` at review time). This is the accept line's second clause
   (`review.md:14`).
3. **Web `storageConfigFromEnv` accepts explicit dev placeholder credentials in production**
   (`apps/web/src/storage/presign.ts:54-77`) — confirmed still open: `REQUIRED_IN_PRODUCTION` only
   checks each setting is non-blank, not that it differs from `DEV_DEFAULTS[name]`, so a
   production deploy that explicitly sets `S3_ACCESS_KEY_ID=edmate-dev` (copy-paste from
   `docker/env.example`) passes the check (`review.md:18`, `presign.ts:74`). Same fix extends to
   worker's new production path (item 1): both must refuse a value equal to their own
   `DEV_DEFAULTS` entry, not just a blank one.
4. **Deploy docs say production never sets `S3_ALLOW_HTTP`** (`docker/env.example`) — confirmed no
   such line exists yet; `docker/env.example:43-45` describes the opt-in but not that production
   must never use it (`review.md:19`, `docker/compose.yaml:112`). `docker/env.example:46-48` is the
   precedent pattern (`AGE_NOTICE_ALLOW_UNSIGNED`'s "a real deployment never sets it" line) — copy
   that shape. No separate deploy-guide file exists (`docs/setup/` has none); the env file comment
   is the deploy doc here, same as the existing precedent.
5. **`UploadsView` has no unmount guard** (`apps/web/app/teacher/uploads/UploadsView.tsx`) —
   confirmed still open: `refresh`, `send`, `finish`, `onDelete` all call `setDocs`/`setBanner`/
   `patch` after an `await` with no mounted check (`review.md:20`). Cheap: one `useRef` flag set in
   a `useEffect` cleanup, checked before each of those four setState call sites.
6. **Module picker shows "Module 1/2" instead of real names** — not a 8.2 review line item, but
   named in the board title ("module names in the picker") and traced to the Phase 4 decision
   (`docs/decisions/log.md:11036-11039`: "the modules repo returns ids, not titles"). Confirmed
   `packages/db/src/schema/content.ts:49` already has `modules.title`; `packages/db/src/repositories/modules.ts`'s
   `ids()` only selects `modules.id`. No migration: add a sibling read (e.g. `list()` returning
   `{ id, title }[]`, same `orderBy(asc(modules.id))`) and have the teacher/uploads page pass
   titles through to `UploadsView`'s picker instead of `moduleOption`'s `{n}` placeholder. Directly
   serves "a testable product": a pilot teacher with 2+ modules currently cannot tell them apart.

### Defer (2 new board tasks — lead checks id uniqueness; proposed 8.2q, 8.2r)
- **8.2q — upload-centre race, retry and quota hardening** (apps/web, packages/db): three LOW
  items, none urgent at pilot scale, all touching `apps/web/src/studio/routes.ts` plus one small
  `packages/db` addition, so one task can review them together:
  - *Replace-during-complete race*: `complete` reads the row, HEADs the object, then calls
    `updateStatus(scope, id, 'processing')` with no compare-and-set on `storageKey`
    (`review.md:15`, `routes.ts:256` at review time; same shape as the self-healing race the Phase
    3 handoff already documented and left open, `docs/tasks/8.2/handoff.md:310-316`). Needs a
    `updateStatus`-with-expected-key variant in `packages/db/src/repositories/chunks.ts` (the
    pattern already exists: `failIfStorageKey`, added by 8.2i for a different caller, is the
    template) answering 409 on mismatch. Touches `packages/db/src/repositories/**` (risky:
     security-reviewer, plus database-reviewer by this repo's convention for db changes) and
     `apps/web/src/studio/routes.ts`.
  - *Failed S3 deletes are only logged* (`dropObject`, `routes.ts:242-249`; `review.md:16`,
    `routes.ts:181` at review time): add a bounded retry (2-3 attempts, same shape as other
    best-effort cleanup in this codebase) before logging and giving up.
  - *No per-teacher quota or rate limit on `create`* (`review.md:17`, `routes.ts:208` at review
    time): `addLink` already has `linkRateLimit` (8.2f); `create` has no equivalent. Low risk for a
    small trusted pilot, but cheap to close with the same `LinkRateLimiter` shape reused or a
    sibling limiter.
- **8.2r — documents list index and 0017 validate-at-scale hygiene** (packages/db only): two LOW
  items, both explicitly about behaviour "at scale", not at pilot size (today's `documents_teacher_id_idx`
  already serves `listForTeacher`'s small per-teacher row count; `0017`'s `ADD CONSTRAINT ... CHECK`
  table-scan cost is negligible on a tiny table) — bundled because both are database-reviewer-only,
  no new runtime behaviour, and best done together before the table grows:
  - Composite index `(teacher_id, created_at desc, id desc)` for `documents.listForTeacher`'s
    `ORDER BY` (`review.md:21`, `content.ts:88` at review time; confirmed: no such index exists
    today, only `documents_teacher_id_idx`, `documents_module_id_idx`, the two task-8.2p/11.4
    partial indexes).
  - `migrations/0017_document_status.sql`'s `ADD CONSTRAINT ... CHECK` without `NOT VALID` +
    `VALIDATE CONSTRAINT` (`review.md:22`) — since 0017 already shipped, this needs a *new*
    migration (next free number: `0041_*.sql`, confirmed from the highest existing
    `packages/db/migrations/0040_documents_processing_sweep_index.sql`) that drops and re-adds
    `documents_failure_reason_only_when_failed` as `NOT VALID` then `VALIDATE CONSTRAINT` in a
    second statement, following this repo's hand-edited-migration pattern (0017 itself, 0033, 0040).

### Drop (2 items — already done; cited)
- **Web-link and YouTube ingestion pending B-31**: done. Board tasks 8.2b (web-link, all phases
  8.2d/8.2e/8.2f) and 8.2c (YouTube captions, all phases 8.2j/8.2k/8.2l), plus their follow-ups
  8.2g, 8.2h, 8.2i, 8.2m, 8.2n, 8.2o, 8.2p, are **all `status: done`** in `docs/board/tasks.yaml`.
  The upload centre's `addLink` route, `checkWebLinkUrl`, the SSRF-safe pinned fetcher (ADR-0014)
  and caption parsing all exist in today's `apps/web/src/studio/routes.ts` (read above) and
  `packages/ingest`. Nothing left to plan here.
- **`packages/queue/test/latency.test.ts` flake**: done. The file (read in full) already widened
  `BOUND_MS` from 500 ms to 2500 ms with a comment citing both CI failures (PRs #148, #84) and
  `docs/lessons.md`'s "Wall-clock bounds fail on shared CI runners" lesson (confirmed present,
  `docs/lessons.md:23`). No further change needed.

### Lead handles directly (not now/defer/drop — needs a human)
- **Manual dev-stack upload/delete run (with the thin-slice e2e check)**: per the brief, a
  human-run item is never "now". `docs/tasks/8.2/handoff.md`'s Decisions log already parked this
  with 8.1a's browser check (teacher signs up, uploads, student chats) — the lead runs it as part
  of that end-to-end pass, not as a builder task.

## Files touched (this task's "now" items only)
- `apps/worker/src/storage/roundtrip.ts` (+ `roundtrip.test.ts`) — production fail-closed, mirrors
  `apps/web/src/storage/presign.ts`'s existing pattern (`StorageConfigError`-shaped, a `code` only,
  never a value, in the thrown error/log).
- `apps/web/src/storage/presign.ts` (+ `presign.test.ts`) — refuse an explicit dev-placeholder
  value in production, for all four `REQUIRED_IN_PRODUCTION` settings.
- `apps/web/src/studio/routes.ts` (+ `routes.test.ts`) — `create` signs before writing the row,
  same order `replace` already uses (ownership/validation → sign → write); a signing failure
  leaves nothing written.
- `docker/env.example` — one-line addition near the existing `S3_ALLOW_HTTP` note, same shape as
  the `AGE_NOTICE_ALLOW_UNSIGNED` precedent two lines below it.
- `apps/web/app/teacher/uploads/UploadsView.tsx` (+ `UploadsView.test.tsx`) — mounted-ref guard
  around the four async setState call sites.
- `packages/db/src/repositories/modules.ts` (+ a repositories test) — a `list()` method returning
  `{ id, title }[]` alongside the existing `ids()`.
- `packages/db/src/repositories/index.ts` — export the new return type if named.
- `apps/web/app/teacher/uploads/page.tsx` (+ `page.test.tsx`) — pass module titles instead of bare
  ids.
- `apps/web/app/teacher/uploads/UploadsView.tsx` again — render the real title in the picker's
  `<option>` instead of `t('moduleOption', { n: i + 1 })`.
- `apps/web/messages/en.json` — drop or repurpose `uploads.moduleOption` (keep as a fallback string
  for a module with an empty/missing title, never delete teacher-authored text).

None of these are on `apps/web/src/auth/**`, `apps/web/app/api/sessions/**`, `apps/web/src/chat/**`,
`packages/harness/src/pedagogy/**` or `packages/harness/src/pipeline/**` — the open work named in
the brief as out of bounds for this plan.

## Risky paths touched
- `packages/db/src/repositories/modules.ts` and `packages/db/src/repositories/index.ts` match
  `packages/db/src/repositories/**` in `.claude/skills/merge-gate/risk-paths.txt` → **reviewers:
  security-reviewer** (the file's mandated group), plus **database-reviewer** by this repo's
  standing convention for every `packages/db` change (see 8.2's own review, and 8.2p/8.2i).
  `code-reviewer` and `typescript-reviewer` run as usual on the whole diff.
- No other "now" file is on a risk-paths.txt glob (`apps/worker/src/storage/**`,
  `apps/web/src/storage/**`, `apps/web/src/studio/**` and `apps/web/app/teacher/uploads/**` are not
  listed; only `apps/web/src/auth/**`, `packages/db/src/repositories/**`,
  `apps/worker/src/alerts/**` and the payments/webhooks/contracts groups are).
- Because one "now" file is risky, the whole PR needs a **`risk: high` decision** at handoff
  (merge-gate rule): draft — "packages/db/src/repositories/modules.ts gains a `list()` read method
  (id + title, no write, no new column); reviewed by security-reviewer and database-reviewer
  because it's under the risky `packages/db/src/repositories/**` glob, even though it adds no new
  access path (same `teacherScope` guard as `ids()`, same table, read-only)."

## Tests first (red then green; no real model, storage or network calls)
- `apps/worker/test/storage/roundtrip.test.ts` (new cases): `NODE_ENV=production` with a missing
  or blank `S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_BUCKET` throws (a code only,
  never echoing the value); an http endpoint under production throws unless `S3_ALLOW_HTTP==='true'`;
  `NODE_ENV=development|test` keep today's dev-default fallback. Write these first against
  today's `storageConfigFromEnv` (red: it never throws), then make it throw (green).
- `apps/web/src/storage/presign.test.ts` (new cases): each of the four
  `REQUIRED_IN_PRODUCTION` settings set to its exact `DEV_DEFAULTS` value under production throws
  a distinct code (e.g. `${name}_placeholder`); a non-placeholder value still passes;
  `NODE_ENV=development|test` are unaffected.
- `apps/web/src/studio/routes.test.ts` (new case, mirroring the existing "a signing failure
  commits nothing" case for `replace`): `create`'s `storage.createUploadUrl` throwing leaves no
  document row written (the fake `documents.create` call is asserted never called, or the row is
  absent on a subsequent `list`).
- `apps/web/app/teacher/uploads/UploadsView.test.tsx` (new case): unmount the component mid-flight
  (e.g. during a pending `listDocuments`/`completeDocument` promise) and assert no React "state
  update on an unmounted component" warning fires (spy on `console.error`) and no throw.
- `packages/db/test/repositories.int.test.ts` or a new `modules.int.test.ts` (real Postgres, rule
  4 fakes only for anything else): `modules.list` returns each of the scope's modules with its
  title, in id order, cross-teacher isolation (another teacher's modules never appear).
- `apps/web/app/teacher/uploads/page.test.tsx` and `UploadsView.test.tsx`: the picker's `<option>`
  text is the module's title, not `"Module 1"`.

## Gate commands (per changed package)
- `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...`
- `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`
- `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`
- `python3 .githooks/secret-scan.py --all` (every phase; the storage config tests touch
  placeholder-credential strings — they already exist in `DEV_DEFAULTS`/`docker/env.example`, not
  new secrets, but worth a clean run each phase regardless).

## Phases and budget

### Phase A — production storage fail-closed and sign-before-write (apps/worker, apps/web)
Items 1-4. Files: `apps/worker/src/storage/roundtrip.ts` (+test), `apps/web/src/storage/presign.ts`
(+test), `apps/web/src/studio/routes.ts` (+test), `docker/env.example`. No risky path. Gate:
`@edmate/worker...`, `@edmate/web...`.
**Budget: 55 tool calls.**

### Phase B — UploadsView unmount guard (apps/web only)
Item 5. Files: `apps/web/app/teacher/uploads/UploadsView.tsx` (+test). No risky path. Gate:
`@edmate/web...`.
**Budget: 20 tool calls.**

### Phase C — module names in the picker (packages/db, apps/web)
Item 6. Files: `packages/db/src/repositories/modules.ts` (+test), `packages/db/src/repositories/index.ts`,
`apps/web/app/teacher/uploads/page.tsx` (+test), `apps/web/app/teacher/uploads/UploadsView.tsx` (+test),
`apps/web/messages/en.json`. Risky path (`packages/db/src/repositories/**`): security-reviewer +
database-reviewer required; draft `risk: high` decision at handoff. Gate: `@edmate/db...`,
`@edmate/web...`.
**Budget: 35 tool calls.**

Each phase gets a fresh builder that reads this plan and (for B and C) the previous phase's
handoff; each ends in a green commit with a short "state after this phase" note.

**Budget: 110 tool calls (3 phases, packages: @edmate/worker, @edmate/web, @edmate/db)**

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (tests, typecheck, lint, and secret-scan only — no real model,
storage or network calls per rule 4).

## Exit conditions
`Status: DONE` when all three phases are green (gate commands above) and the handoff's acceptance
evidence shows: a production worker/web with a missing or dev-default storage setting refuses to
start and logs only a code (both apps); `create`'s signing-failure case writes nothing; the
unmount-guard test is red-then-green; the module picker shows real titles. `Status: PARTIAL` if a
phase goes past roughly 1.5x its budget, or if fixing one item surfaces a need to touch a file
outside this plan's list (e.g. if the `complete`/`replace` race turns out cheaper to close than
expected and tempts scope creep into 8.2q's territory — stop and hand that back to the lead rather
than absorbing it here).

## Reviewers
code-reviewer and typescript-reviewer on every phase (standard). security-reviewer and
database-reviewer on Phase C only (risky path). No architect/ADR needed (no contracts or
prompt-pack behaviour change).

## Open questions
1. **Should Phase A's worker/web fix also refuse a production `S3_BUCKET` equal to
   `edmate-dev` specifically (not just equal to its own `DEV_DEFAULTS` entry)?** Recommendation:
   the general "refuse any setting equal to its dev default" check already covers this (`S3_BUCKET`'s
   dev default *is* `edmate-dev`), so no separate rule is needed — one check, four settings.
2. **Is `docker/env.example`'s comment enough "deploy docs", or does this warrant a new
   `docs/setup/storage.md`?** Recommendation: keep it in `env.example` (the existing
   `AGE_NOTICE_ALLOW_UNSIGNED` precedent two lines below does the same, and there is no deploy
   guide file yet for 8.2a to be the first to add) — defer a standalone deploy guide to whichever
   task first needs one for more than a single setting (e.g. 8.2g already added egress-rule deploy
   docs; a future task can fold storage in alongside it rather than this one starting a new doc).
3. **Should 8.2q and 8.2r be split further (e.g. one task per LOW item) instead of two bundled
   tasks?** Recommendation: keep them bundled as proposed — all five remaining items are LOW
   severity, non-urgent at pilot scale, and splitting five single-item tasks would cost more
   planning/review overhead than the fixes themselves; the lead can still split further when
   picking them up if a reviewer group mismatch makes that cheaper.
4. **Exact ids for the two defer tasks**: proposed `8.2q` and `8.2r`; the lead confirms uniqueness
   against the board before creating them.

## Lead answers (27 Oct 2026)
1. Agreed: one generic "refuse a dev default in production" check covers all four settings; no bucket-name special case.
2. Agreed: the production note stays in `docker/env.example`; no new deploy doc in this task.
3. Agreed: 8.2q and 8.2r stay bundled.
4. Ids confirmed free and added to the board: 8.2q (deps 8.2a) and 8.2r (deps 8.2a).
