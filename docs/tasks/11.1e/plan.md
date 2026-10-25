
# 11.1e plan — 11.1d review LOWs (packages/db live-classes.ts + LiveClassesView.tsx)

## Acceptance (verbatim)
> db typecheck, lint and test green with the new tests.

How shown: both gate commands below green, plus the secret scan clean. Phase B (apps/web) has
no separate acceptance line of its own in the board entry — its two items come from the 11.1d
Phases B/C review (deferred LOWs/MEDIUM), so Phase B is shown green on the `@edmate/web` gate
(typecheck/lint/test) even though the board's one-line `accept` names only `db`.

## Context (read, not reproduced here)
- `docs/tasks/11.1d/review.md` — the ten deferred findings this task closes (7 in
  `packages/db/src/repositories/live-classes.ts` + its tests, 2 in `LiveClassesView.tsx`, 1
  already covered by existing Phase A code — see "Decisions" row below).
- `docs/tasks/11.1d/handoff.md` — Phase A/B/C shape, the per-row edit/cancel state, and the
  `editingIdRef` stale-save guard this task has to adjust, not replace.
- `packages/db/src/repositories/live-classes.ts` — current `update`/`cancel`/`listForTeacher`/
  `listUpcomingForStudent` bodies (read in full).
- `packages/db/test/live-classes.int.test.ts`, `packages/db/test/repositories.int.test.ts`
  (`'liveClasses.update'`/`'liveClasses.cancel'` CASES, ~line 3740) — current coverage.
- `apps/web/app/teacher/live-classes/LiveClassesView.tsx` — `saveEdit`'s stale-guard (line
  ~277) and the Edit/Cancel-class buttons (line ~492, ~495, both currently plain `t('editButton')`
  / `t('cancelButton')` text, no `aria-label`).

## Phase A — packages/db (live-classes.ts review LOWs)

### Items
1. `update`'s `live_class.update` audit (line ~353): add `link` to both `before` and `after`
   (read `link` in the existing `FOR UPDATE` select, which currently selects only
   `status`/`startsAt`/`title`); normalise `after.startsAt` with `iso(new Date(i.startsAt))`
   instead of the raw caller string `i.startsAt`, matching `before.startsAt`'s `iso(row.startsAt)`
   shape.
2. `listUpcomingForStudent` (line ~307): a cancelled row currently still carries its `link`
   (Phase C's `/home` view hides it client-side, but the repository row itself should not). Map
   `link: r.status === 'cancelled' ? null : r.link` in the return.
3. `listForTeacher` (line ~218): `orderBy(asc(startsAt), asc(id)).limit(500)` drops the
   furthest-out classes once a teacher has over 500 scheduled rows, keeping only the soonest.
   Fix so classes close to the 500 cap keep the newest schedule entries instead of being silently
   dropped — exact approach (order/window) is the builder's call; see Questions below for the one
   open call on direction.
4. The `r.status as LiveClassStatus` casts (lines ~223 and ~313, both `listForTeacher` and
   `listUpcomingForStudent`) become a checked parse (e.g. `z.enum(['scheduled','cancelled'])`
   or a small parse helper reused by both), not a bare `as`.
5. The comment at line ~62-65 ("Length-capped before the regex so an over-length link fails fast
   and cheap") is wrong for zod v4 — chained `.max().regex()` checks do not short-circuit/abort on
   the first failure. Reword to describe what the ordering actually does (clearer error precedence
   via schema call order), not a performance claim.
6. Tests (`packages/db/test/live-classes.int.test.ts`):
   - the existing "updates title/link/startsAt" test (line ~241) asserts `title`/`link`/`status`
     already; add `expect(row?.startsAt).toBe(iso(new Date(FUTURE_LATER)))` (or equivalent) and a
     count of `live_class.update` audit rows for this class id (expect exactly 1).
   - a new "fails invalid on an over-length link" case for `update` (the existing "non-https or
     over-length" test title only covers the http case today — see read above).
   - the cancelled-class-still-visible test (line ~340) gets `expect(row?.link).toBeNull()` added,
     covering item 2.
   - `packages/db/test/repositories.int.test.ts`'s `'liveClasses.update'`/`'liveClasses.cancel'`
     `verify` callbacks (~line 3740-3785) currently only check the returned `{updated:true}` /
     `{cancelled:true}` shape. Extend each `verify` to read the row back (via
     `r.liveClasses.listForTeacher(scope)` or a raw query) and assert the write actually landed
     (new title for update; `status === 'cancelled'` for cancel).

### Files
- `packages/db/src/repositories/live-classes.ts` (modify)
- `packages/db/test/live-classes.int.test.ts` (modify)
- `packages/db/test/repositories.int.test.ts` (modify — `verify` callbacks only, no new `CASES`
  entries, no touch to any other repository's case)

### Out of bounds (Phase A)
- `packages/db/src/repositories/packages.ts`, `packages-write.ts`, `package-write.ts`,
  `package-versions.ts` — 8.6f is in review on these.
- Any other repository file, and any `CASES` entry in `repositories.int.test.ts` besides the two
  named above.
- The "update/cancel collapse 'already cancelled' and 'already started' into one bare invalid"
  LOW (review.md line 20) — not named in this task's title; leave it for a later task.

### Gate
```
corepack pnpm turbo run typecheck lint test --filter=@edmate/db...
```

### Reviewers
`packages/db/src/repositories/live-classes.ts` matches the risk-paths.txt group at line 40
(`packages/db/src/repositories/**`) → **security-reviewer** required. Recommended alongside it,
per 11.1d's own precedent: database-reviewer (write/audit-shape and index/order change),
code-reviewer, typescript-reviewer (the cast → parse change). Test-only files
(`*.int.test.ts`) are not on the risky-paths list themselves.

### Budget
~30 tool calls (incl. ~10 setup: board/plan/handoff reads, worktree setup, reading the three
files above before editing).

## Phase B — apps/web (LiveClassesView.tsx review follow-ups)

### Items
1. **MEDIUM, stale-save guard over-skips.** `saveEdit`'s success branch (line ~277) currently
   does `if (editingIdRef.current !== c.id) return;` before *both* `setClasses` (applying the
   saved values to the row) and `setEditingId(null)` (closing the form). When another row's edit
   started mid-save, the correct behaviour is: apply the server's successful save to `c`'s row
   (so it doesn't keep showing stale pre-edit values until reload) but skip `setEditingId(null)`
   (never close a form the teacher didn't ask to close, and never clobber `editingId` if it now
   points at a different row). Split the guard: `setClasses` runs unconditionally on success;
   `setEditingId(null)` runs only when `editingIdRef.current === c.id`.
2. **LOW, no per-row accessible name.** The Edit button (line ~492) and Cancel-class button (line
   ~495) use bare `t('editButton')` / `t('cancelButton')` text with no `aria-label`, so two classes
   both named e.g. "Edit" are indistinguishable to a screen reader by row. Add
   `aria-label={t('editButtonLabel', { title: c.title })}` and
   `aria-label={t('cancelButtonLabel', { title: c.title })}`, mirroring the existing join-link
   `joinLinkLabel` pattern (line ~483) and its 11.1d-Phase-B-fix-round precedent of updating the
   one existing test query rather than changing visible text.

### Files
- `apps/web/app/teacher/live-classes/LiveClassesView.tsx` (modify: `saveEdit`, the two buttons)
- `apps/web/app/teacher/live-classes/LiveClassesView.test.tsx` (modify: a new case for "another
  row's edit starts mid-save still applies the first row's saved values"; update/add `aria-label`
  assertions for Edit/Cancel-class, following the join-link test's precedent of asserting both
  the accessible name and the visible text via `toHaveTextContent`)
- `apps/web/messages/en.json` (modify: two new keys inside the existing `liveClassesStudio`
  namespace, `editButtonLabel`/`cancelButtonLabel`, same `{title}` placeholder shape as
  `joinLinkLabel`)

### Out of bounds (Phase B)
- `apps/web/src/studio/styleCard*`, `apps/web/src/discovery/**` — other tasks are running on these.
- `apps/web/src/studio/liveClasses/**` (routes, actions) — Phase A/B of 11.1d already shipped
  these; this task's Phase B items are both inside `LiveClassesView.tsx` only, no backend change.
- `apps/web/app/home/**` — Phase C's cancelled-class view is out of scope here.

### Gate
```
corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force
```

### Reviewers
None of `apps/web/app/teacher/live-classes/LiveClassesView.tsx`, its test, or `messages/en.json`
match any risk-paths.txt glob (not under `apps/web/src/auth/**`, `apps/web/app/api/**`, or any
other listed group). No named reviewer required by the merge gate; code-reviewer runs on every
PR regardless.

### Budget
~30 tool calls (incl. ~10 setup: reading `LiveClassesView.tsx`/test/en.json before editing,
confirming the `editingIdRef` timing with the existing "discard while save in-flight" test from
11.1d's last fix round so the new split-guard test doesn't collide with it).

## Risky paths touched
- `packages/db/src/repositories/live-classes.ts` — matches `packages/db/src/repositories/**`
  (risk-paths.txt line 40) → **security-reviewer**. This is the only risky-paths match in either
  phase; `LiveClassesView.tsx`/test/`en.json` (Phase B) and the two `*.int.test.ts` files
  (Phase A) match no glob in `.claude/skills/merge-gate/risk-paths.txt`.
- The board already carries `risk: high` for 11.1e; the handoff's `## Decisions` must still log a
  `risk: high` entry naming this file and security-reviewer, per the Edmate build-plan rule, even
  though every change here is a bug-fix-shaped LOW/MEDIUM rather than new write behaviour.

## Gate commands (both phases, run from the relevant worktree)
```
corepack pnpm turbo run typecheck lint test --filter=@edmate/db...
corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force
python3 .githooks/secret-scan.py --all
```

## Reviewers (overall)
security-reviewer (required, Phase A only, risk-paths match); database-reviewer, code-reviewer,
typescript-reviewer recommended on Phase A (write/audit-shape, order/cap change, cast→parse);
code-reviewer on Phase B (runs on every PR; no named reviewer required by the gate).

## Budget
Budget: 60 tool calls (2 phases, packages/db + apps/web)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test and the secret scan only — no other
shell use; builders stay inside their own worktree).

## Exit conditions
- **DONE**: both phases' gates (typecheck/lint/test) are green including the new tests listed
  above, the secret scan is clean, and every item 1-6 (Phase A) and 1-2 (Phase B) is either fixed
  or has a logged reason it wasn't (none expected — all are small, scoped fixes).
- **PARTIAL**: a phase goes past ~35 tool calls with gate still red, or a fix touches a file
  outside this plan's two file lists (e.g. the cap fix in item 3 turns out to need a schema/index
  change) — stop, hand off what's green, and flag the rest as a follow-up rather than expanding
  scope.

## Questions (not blocking)
1. Phase A item 3 (`listForTeacher`'s 500-cap ordering) — the task title says "keeps the newest
   classes past the cap (order or window)" but doesn't say whether "newest" means furthest-out
   `startsAt` or most-recently-scheduled (`created_at`, which `TeacherLiveClassRow` doesn't even
   carry today). Builder's reasonable default: keep ordering by `startsAt` ascending as the
   returned list's own order (still soonest-first, since that's what the teacher studio displays),
   but when there are more than 500 rows, don't let the silently-dropped ones always be the
   furthest-future ones — e.g. order by `startsAt` descending with `.limit(500)`, then re-sort the
   500 kept rows ascending for return. Not blocking: no teacher is near 500 scheduled classes in
   the pilot, and the fix is a small, reversible change either way.
2. Whether Phase A needs an integration test actually exercising the 500-cap behaviour (would
   mean inserting 501+ rows). Given the budget and that no teacher is near this in practice, this
   plan does not require one; the builder may add a lighter unit-shaped check if one is cheap, or
   leave it as reasoning-only and say so in the handoff.
3. Phase B's `aria-label` key names (`editButtonLabel`/`cancelButtonLabel`) are the planner's
   choice, not dictated by the board; the builder may pick different key names as long as the
   `en.json` additions stay inside the existing `liveClassesStudio` namespace.

## Lead answers (25 Oct 2026)
- **Q1:** agreed. Order by `startsAt` descending, limit to 500, then re-sort the kept rows ascending. Past classes then never push out newly scheduled ones.
- **Q2:** agreed. No 501-row integration test. A cheap check of the query's order and limit is enough; otherwise explain the reasoning in the handoff.
- **Q3:** the builder picks the key names inside `liveClassesStudio`.
- **Reviewers:** Phase A needs security-reviewer (risk path packages/db/src/repositories/**), code-reviewer and typescript-reviewer, plus a lead risk: high decision. Phase B needs code-reviewer and typescript-reviewer.
- **Order:** Phase A first, then Phase B, each with a fresh builder. Each phase has a budget of 30 calls and stops at 38.
