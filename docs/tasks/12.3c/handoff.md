# 12.3c: upload rights-declaration checkbox and the public `/legal/rights` page

## Summary

Builds on 12.3a (`@edmate/content` rights-declaration loader) and 12.3b (`@edmate/db`
`rightsDeclared` optional on `documents.create`/`startReplace`). This task (apps/web only):

- Makes `rightsDeclared: true` a required field on every studio route that calls a
  `documents` method taking it: `POST /api/studio/documents` (create), the web-link add
  route, and `POST /api/studio/documents/:id/replace`. Missing or `false` returns the
  existing 400 validation response; nothing is written or enqueued.
- Adds a "I confirm I hold the rights to upload this material" checkbox to the teacher
  upload centre (`UploadsView.tsx`). Upload, replace and add-link controls stay disabled
  until it is checked; checking it enables them and the next request carries
  `rightsDeclared: true`.
- Adds a new public page, `/legal/rights`, reading the rights-declaration content (12.3a)
  and the US locale pack's `compliance.grievance` field (3.10). While the grievance contact
  is pending (today, in every pack) it shows a neutral placeholder sentence — never a real
  contact, name or helpline. Links to it from `/teachers`' footer.

No `/api/**` route was added (the public page is a server component, not an API route), no
`apps/web/src/auth` files were touched, and no `packages/**` files were touched (12.3b
already made `rightsDeclared` an accepted, optional repository input).

## Files

- `apps/web/src/studio/routes.ts` — `rightsDeclared: z.literal(true)` on `NewFileSchema`
  (covers create + replace) and `AddLinkSchema` (separate schema); passes the field through
  to `documents.create`/`startReplace`.
- `apps/web/src/studio/routes.test.ts` — one new 400 test per route (create/replace share
  `NewFileSchema`'s it.each cases; add-link and replace each get a dedicated "missing or
  false declaration" test); every existing fixture/body updated to include
  `rightsDeclared: true`.
- `apps/web/src/studio/uploadClient.ts` / `uploadClient.test.ts` — the three call sites
  (`createDocument`, `addLink`, `replaceDocument`) now take and send `rightsDeclared: true`.
- `apps/web/app/teacher/uploads/UploadsView.tsx` — rights checkbox + hint text; disables the
  file input, the replace picker/buttons and the add-link submit button until checked;
  `rightsDeclared: true` on every create/replace/add-link call.
- `apps/web/app/teacher/uploads/UploadsView.test.tsx` — a `checkRights()` helper used before
  existing upload/replace/add-link interactions; two new tests (controls disabled until
  checked; add-link sends `rightsDeclared: true` only once checked).
- `apps/web/src/legal/page-data.ts` (new) — `loadRightsPageData(env)` reads the declaration
  (`readRightsDeclaration`) and the US pack's grievance via `pickLocalePack`; returns
  `grievance: string | null` (null when pending or blank). `RIGHTS_PAGE_MARKET = 'US'`.
- `apps/web/src/legal/page-data.test.ts` (new) — reads the real committed content dir
  (confirms the declaration and the US grievance are still pending) plus fixture-dir cases
  for pending/blank/real grievance and a missing-declaration throw.
- `apps/web/app/legal/rights/page.tsx` (new) — public server component (no `requireRole`,
  no client fetch), same `AppShell`/`publicNav` pattern as `app/teachers/page.tsx`; renders
  the declaration body as paragraphs, the grievance line (fallback or real), and a
  repeat-infringer note with no number or threshold named.
- `apps/web/app/legal/rights/page.test.tsx` (new) — anonymous/signed-in rendering,
  paragraph rendering, pending-fallback, real-contact display, repeat-infringer note, axe.
- `apps/web/app/teachers/page.tsx` / `page.test.tsx` — a footer link to `/legal/rights`.
- `apps/web/src/chat/no-raw-html.test.ts` — added `app/legal` to the existing `ROOTS` scan
  (extends the existing check; no new scan mechanism).
- `apps/web/messages/en.json` — append-only: new `uploads.rightsLabel`/`rightsHint` keys and
  a new `legal` block (`title`, `footerLink`, `grievanceLabel`, `grievanceFallback`,
  `repeatInfringerNote`). No real grievance contact, name or helpline text added anywhere.

## Tests

- `src/studio/routes.test.ts`: 68/68 pass.
- `src/studio/uploadClient.test.ts`: 12/12 pass.
- `app/teacher/uploads/UploadsView.test.tsx`: 17/17 pass.
- `src/legal/page-data.test.ts`: 5/5 pass.
- `app/legal/rights/page.test.tsx`: 7/7 pass (incl. axe).
- `app/teachers/page.test.tsx`: 10/10 pass.
- `src/chat/no-raw-html.test.ts`: 3/3 pass.
- Full gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` → 34/34
  tasks successful.
- `python3 .githooks/secret-scan.py --all` → clean.

## Decisions

### 22 Oct 2026 · 12.3c routes now requiring the rights declaration · decided by builder · risk: medium
- Decided: `rightsDeclared: z.literal(true)` is now required (not merely accepted) on three
  studio routes: `POST /api/studio/documents` (upload-create), the web-link add route under
  the same documents collection, and `POST /api/studio/documents/:id/replace`. A missing or
  `false` value returns the pre-existing 400 validation response and nothing is written,
  replaced or enqueued.
- Why: 12.3b made the field an optional repository input; the plan for 12.3c calls for every
  studio route that calls a `documents` method taking `rightsDeclared` to require it, so a
  teacher cannot upload, replace or link material without confirming they hold the rights.
- risk: medium — a validation-logic change on three write paths in the teacher upload
  centre; covered by one new 400 test per route plus updated fixtures on every existing
  test, and the full `@edmate/web` gate is green.

### 22 Oct 2026 · 12.3c public rights page shows a neutral placeholder, no new ADR · decided by builder · risk: low
- Decided: `/legal/rights` is a plain, anonymous-accessible server component (same shell as
  `/teachers`); it reads the US pack's `compliance.grievance` field and shows a neutral
  fallback sentence ("A grievance contact for this market has not yet been published.")
  whenever that field is pending or blank, in every market, for the length of the pilot.
  The repeat-infringer note names no number or threshold. The page writes no real contact,
  helpline, name or email anywhere in code, content or test fixtures.
- Why: task 12.3's lead answer (Q1) says the public page shows a neutral placeholder while
  `compliance.grievance` is pending; the checkbox copy itself needed no separate human
  sign-off gate (Q4). No `/api/**` route, `apps/web/src/auth` file or `packages/**` file was
  touched, so no ADR applies.
- risk: low — content-only addition to a public page; `app/legal` was added to the existing
  `src/chat/no-raw-html.test.ts` scan (extends an existing check, not a new one) and the page
  has an axe test.

## Left to do

- A human still needs to sign off a real grievance contact in each market's locale pack
  (currently pending everywhere); until then every market shows the neutral placeholder.
- No other follow-up identified; Phase C's scope (apps/web checkbox + public page) is
  complete per the 12.3 plan.

Status: DONE

Tool calls used: 109
