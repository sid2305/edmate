# 8.3c handoff: outline editor page (Phase C of 8.3)

Status: DONE
- **Branch:** `m8/8.3c-outline-editor` (local `work-83c`)
- **Worktree:** `.claude/worktrees/agent-a6a06a41ee562f034`
Tool calls used: 32
- **Scope:** `apps/web` only (`apps/web/app/teacher/outline/**`, `apps/web/app/teacher/view.tsx`
  (+test), `apps/web/messages/en.json`). No `packages/contracts`, `.claude/`, `.github/` or
  `apps/web/src/auth/**` change.
- **Risky path:** none (plan 8.3's "Risky paths touched": Phase C "not gate-risky").

## What changed

- New `apps/web/src/studio/outlineClient.ts`: the browser side of `GET`/`PUT /api/studio/outline`
  and `POST /api/studio/outline/generate` (8.3b's API), mirroring `uploadClient.ts`'s
  `ApiResult`/`call` shape. Types `Outline`/`OutlineModule`/`OutlineTopic`/`OutlineSource` (the
  read shape) and `OutlineInput`/`ModuleInput`/`TopicInput` (the `PUT` shape).
- New `apps/web/app/teacher/outline/page.tsx` — `requireRole(['teacher'])`, renders
  `<OutlineView>` inside `AppShell` with the Studio/Uploads/Outline nav. No database read: the
  teacher is always the session's own principal on the API side (8.3b), so this page needs
  nothing beyond the guard.
- New `apps/web/app/teacher/outline/OutlineView.tsx` (client): fetches the outline on mount;
  per module, rename (text input) and reorder (up/down buttons, swapping both the row and its
  `order` field); per topic, rename, reorder, a checkbox "select to merge" plus a module-level
  "Merge selected topics" button (unions the selected topics' `chunkIds` by `chunkId`, keeps the
  first selected topic's id/title, drops the rest), and a split control (checkboxes over a
  topic's linked chunks, a new-topic title field, "Split selected into a new topic" — moves the
  checked chunks into a brand-new topic with no `id`, appended after the existing topics with the
  next `order`). Each topic lists its linked chunks' `sourceTitle`/`locator` read-only. A
  "Generate from uploads" button confirms first when there are unsaved edits (`dirty` state) since
  it replaces the whole tree; "Save" sends the exact edited tree via `putOutline` and shows the
  returned `outlineVersion`. An empty state ("No modules yet…") renders when `modules.length===0`.
  Errors map to the same six keys the server can return (`validation`/`not_found`/`unauthorized`/
  `forbidden`/`rate_limited`/`provider_error`), same pattern as `UploadsView.tsx`.
- `apps/web/app/teacher/view.tsx` (+ test): added the "Outline" nav link, between Uploads and
  Your profile.
- `apps/web/messages/en.json`: `teacher.outlineLink`, and a new `outline` namespace (all the
  editor's strings — intro, labels, confirm/save/generate copy, and the six error keys).
- Tests (written first): `src/studio/outlineClient.test.ts` (GET/PUT/generate with the exact
  method/body/url, error-code reading, network failure); `app/teacher/outline/OutlineView.test.tsx`
  (RTL + jest-axe, fetch stubbed with an in-memory outline API, same pattern as 8.2's
  `UploadsView.test.tsx`): initial render, rename, reorder swap, merge, split (partitions the
  original topic's chunks), Save (exact PUT body + shown version), Generate (warns before
  discarding unsaved edits, then replaces the tree), the empty state, a GET failure alert, and
  zero axe violations.

## Evidence

```
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/web...
  → Tasks: 34 successful, 34 total
  → @edmate/web test: all suites pass (new: src/studio/outlineClient.test.ts,
    app/teacher/outline/OutlineView.test.tsx, app/teacher/view.test.tsx extended)
    src/studio/outlineClient.ts   100 % stmts / 75 % branch / 100 % funcs / 100 % lines
python3 .githooks/secret-scan.py --all   → clean (no findings)
```

`git merge origin/main` was a fast-forward (only `docs/board/tasks.yaml` changed upstream since
this branch was cut from main) — no conflict with 8.4b's shared edits to `view.tsx`/`en.json`
because 8.4b has not merged to `main` yet. Pushed after.

## Deviations from the plan

1. **No separate `page.test.tsx`.** The 8.3 plan's Phase C file list names only
   `OutlineView.test.tsx` as a new test file (not a page test) — unlike 8.2's `uploads/page.test.tsx`,
   which exists because that page itself reads `modules.ids()` from the database. This page does
   no database read of its own (the outline API is always scoped to the session's own principal),
   so there is nothing page-specific left to assert beyond `requireRole` gating that
   `OutlineView.test.tsx`/the API's own tests don't already cover; following the plan's file list
   literally rather than adding a thin wrapper test with nothing left to verify (same precedent
   8.3b's handoff noted for not adding per-route test files).
2. **Manual timed walkthrough (plan step 7) skipped per the lead's instruction** — the lead
   decided the human times the edit pass during their own try-it run instead of a builder doing
   it; logged under Decisions below.

## Decisions

### 22 Oct 2026 · 8.3c Manual timed walkthrough deferred to the human's try-it run · decided by lead · risk: low
- Decided: the plan's Phase C step 7 (a manual timed edit pass over ~20 fixture chunks, pasting
  timestamps into the handoff) is skipped by this builder; the human will time the edit pass
  during their own try-it run instead.
- Why: this bar is a human-usability check, not a CI assertion (the plan itself calls out the
  same precedent as 9.1's Lighthouse run and 8.2's dev-stack step); the lead chose to have the
  human run it directly rather than have a builder spin up the dev compose stack for a timing
  exercise with no automated assertion attached.
- risk: low

### 22 Oct 2026 · 8.3c Merge is module-scoped; split appends a new topic rather than inserting in place · decided by builder · risk: low
- Decided: "Merge selected topics" only combines topics within the same module (the plan's
  checkbox-based merge control is rendered per module, scoped to that module's own topics); a
  split's new topic is appended after the module's existing topics with the next integer `order`,
  rather than attempting to insert it adjacent to the original topic's position.
- Why: the plan's acceptance table scopes merge/split to topics (scope decision 1 of 8.3's plan,
  "modules are rename/reorder only; topics are the mergeable/splittable unit") without specifying
  cross-module merge or exact split placement; appending keeps the `order` values simple integers
  (matching the server's `OrderSchema`) and the teacher can reorder the new topic afterward with
  the existing up/down controls if they want it elsewhere.
- risk: low

## Phase C: done

8.3 is now complete: a signed-in teacher can generate and edit their outline end to end
(`/teacher/outline`), with source links visible and reorder/rename/merge/split all working, and
the version shown after Save.
