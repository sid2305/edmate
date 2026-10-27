# Handoff: 0.20k

Status: DONE

## Summary

**Reproduced first.** The local dev teacher (`demo-teacher`) in this worktree's Postgres is
permanently at `PACKAGES_MAX` (20): package creation never deletes rows (versions are immutable),
so every prior local run of this spec left it one or more packages richer. Running
`teacher-packages-walkthrough.spec.ts` against it reproduced the exact reported failure on the
first try: `TimeoutError: locator.click: Timeout 10000ms exceeded` waiting for
`getByRole('button', { name: 'Save' })` on the reuse/edit branch of the second package.

**Root cause (from the trace, not a guess).** The per-step completion check was
`page.getByRole('heading', { name: options.newName })`, with no scope and no `level`. That
locator also matches the edit form's own live `<h2>Editing {name}</h2>` title
(`PackagesView.tsx`'s `editingTitle`), which appears the instant the name field is typed — long
before the `PUT` that the Save click sends has round-tripped. On the reuse path this let the
first edit (renaming the "Starter" package) report "done" and let the test start editing the
second ("Full") package while the first edit's save was still in flight. When that stale save's
response finally landed, its success handler (`onSave`, correct by design — it has no way to know
a newer edit started) reset `editingId` to `null` and the form to blank, wiping out the
in-progress second edit and leaving no Save button at all — exactly the reported hang. Confirmed
via: (1) the trace's `resources/*.json` payload, which showed the server-side `draft.name` was
correct, ruling out a server bug; (2) an in-page `MutationObserver` injected with
`page.evaluate()`, which gave a relay-latency-free, authoritative order of DOM/state changes and
showed the `<h2>` satisfying the old locator before the real PUT response arrived. The app code
(`PackagesView.tsx`) is not buggy — nothing in the spec should have let a second edit start before
the first save resolved, and the fix for that belongs in the test's own assertions, not the app.

**Fix (spec only).** In `apps/web/e2e/teacher-packages-walkthrough.spec.ts`, every heading
assertion used to confirm a save landed is now scoped to the package list's own `<h3>` headings
(`page.getByRole('list', { name: 'Your packages' }).getByRole('listitem')`, filtered to
`level: 3`), never any heading on the whole page. This applies to the per-step check inside
`createOrRenamePackage` and the two final assertions in the test body. A doc comment explaining
the finding (with the trace evidence summarized) was added above `createOrRenamePackage`.

**Proving the acceptance.**
- *At the cap* (5 runs): the worktree's dev teacker is permanently at `PACKAGES_MAX`, so running
  the fixed spec as-is against `demo-teacher` five times in a row (one at a time, foreground) is
  the "at cap" proof. All 5 passed (~1.7–2.5s each test, ~9–13s wall including dev-server warm
  reuse): run 1 2.5s, run 2 1.9s, run 3 2.0s, run 4 1.7s, run 5 2.2s.
- *Starting empty* (5 runs): the local dev teacher cannot be brought under the cap without
  deleting rows (forbidden), so per the plan's own fallback ("use a fresh teacher id the spec
  creates"), I added a `createFreshTeacher()` helper to `apps/web/e2e/fixtures.ts` built only from
  public `@edmate/db` repository methods already used elsewhere in that file —
  `identity.createStudent`, then `identity.grantRole({ role: 'teacher', by: 'operator' })` (the
  documented path to mint a teacher with no staff account yet), then `repos.styleCards.create` so
  the package builder's presets render — returning the new teacher's id for
  `signInAsTeacher(context, baseURL, id)`. To exercise it, I wrote a temporary, uncommitted spec
  (`apps/web/e2e/tmp-empty.spec.ts`, deleted before this handoff) that signs in as a fresh teacher
  and creates two packages via the "Free starter"/"Full course" presets (a fresh teacher is never
  at cap, so this only exercises the create branch, not reuse/edit — that branch is covered by the
  5 at-cap runs above). Ran it five times; all 5 passed (~1.8–3.0s each): run 1 3.0s, run 2 2.2s,
  run 3 1.8s, run 4 1.9s, run 5 2.3s. No row any other test created was touched or deleted. The
  helper itself was used only for that one-off local proof and nothing committed calls it; it was
  removed in fix round 1 (below), and CI's empty database already covers the starting-empty path
  for the committed spec.

## Decisions

### 27 Oct 2026 · 0.20k fresh-teacher helper for the "empty" proof · decided by builder · risk: low
- Decided: added `createFreshTeacher()` to `apps/web/e2e/fixtures.ts`, and proved the "starting
  empty" acceptance leg with a temporary, uncommitted spec file that used it, rather than
  committing a second permanent spec file or wiring the helper into the existing walkthrough spec.
- Why: the plan's own fallback for "empty" is "use a fresh teacher id the spec creates"; the
  committed walkthrough spec already exercises both the create and (when at cap) reuse/edit paths
  against `demo-teacher`, and CI's database starts empty anyway so the committed spec already
  proves the "empty" case there. A second committed spec would duplicate coverage for no gain, so
  the fresh-teacher run was done once as a local proof and not left in the tree. The helper was
  used only for that one-off local proof: nothing committed calls it, so it was removed in fix
  round 1 (see below) — CI's empty database already covers the starting-empty path on its own.

## Gate

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/web
→ Tasks: 10 successful, 10 total (typecheck, lint, test all green)

python3 .githooks/secret-scan.py --all
→ clean, no output

git status --porcelain
→  M apps/web/e2e/fixtures.ts
→  M apps/web/e2e/teacher-packages-walkthrough.spec.ts
```

10 Playwright runs of `teacher-packages-walkthrough.spec.ts`/the temporary empty-case spec, all
passed (details above).

## Fix round 1

- [MEDIUM] `apps/web/e2e/fixtures.ts:162` (code-reviewer and typescript-reviewer) —
  `createFreshTeacher()` is exported but nothing committed calls it; the "starting empty" proof
  used a temporary spec that was deleted.
- Change: removed `createFreshTeacher()` and its doc comment from `apps/web/e2e/fixtures.ts`. No
  import in that file was only used by it, so no import changes were needed. No new spec was
  added — CI's empty database already covers the starting-empty path.
- Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` green;
  `git grep -n createFreshTeacher` returns only handoff lines; `corepack pnpm exec prettier --check`
  clean on changed files; `python3 .githooks/secret-scan.py --all` clean.

Fix round builder count: 10

## Budget

Tool calls used: ~58
