# 11.1c handoff — upcoming live classes on the student /home (Phase C)

## Summary

Adds an "Upcoming live classes" section to `/home`, per `docs/tasks/11.1/plan.md`'s "Phase C".
`/home` already loads chat/startable links for each of the student's candidate agents
(`chatAgentCandidates`/`homeChatLinks`/`homeStartLinks`); this task adds a third, independent
query over the same candidate list: each candidate agent's owning teacher is resolved once,
deduplicated, and `repos.liveClasses.listUpcomingForStudent` (task 11.1a) is called once per
distinct teacher. Results are merged and sorted by `startsAt`. A failure is caught and logged
(`home.live_classes_failed`), same shape as `homeChatLinks`/`homeStartLinks`, and never affects
the chats/startable lists or the existing placeholder logic (which is untouched — it is still
gated on `chats`/`startable` only).

The view renders a new block (title, start time, the window label unless `later`, and the join
link) whenever `liveClasses.length > 0`; it shows nothing when empty, and never changes whether
the existing placeholder shows.

## Files

- `apps/web/app/home/page.tsx` — added a local `homeLiveClasses` loader (same `open()`/`principal`
  pattern as `homeChatLinks`/`homeStartLinks`) and passed its result as a new `liveClasses` prop.
- `apps/web/app/home/view.tsx` — a third conditional block: title, `<time dateTime>`, the window
  label (skipped for `later`), and a join `<a>` (`target="_blank" rel="noopener noreferrer"`,
  skipped when `link` is `null`).
- `apps/web/messages/en.json` — new keys under `home.liveClasses.*` only (`title`, `join`,
  `window.reminder_24h`, `window.reminder_1h`, `window.starting_soon`; no `later` label, per the
  plan's "a class far out shows later/no label"). No other namespace touched.
- `apps/web/app/home/page.test.tsx` — new cases: queries one teacher per distinct candidate's
  owner, dedupes, sorts by `startsAt`, and a failure path shows no live classes without touching
  chats/startable; a no-candidates case never queries live classes at all.
- `apps/web/app/home/view.test.tsx` — new cases: empty list leaves the existing placeholder
  unchanged; `later` shows no window label; `reminder_24h`/`reminder_1h` show their label; the
  join link always has `target="_blank"`/`rel="noopener noreferrer"`; an axe check with a class
  shown. Also widened the file's `next-intl/server` test mock to resolve dotted keys
  (`liveClasses.window.reminder_24h`) by walking the path, matching real next-intl's own
  flattening of nested namespace JSON — needed because the new keys are nested.

## Tests

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` — green, 34/34 tasks.
- `apps/web/app/home/page.test.tsx` + `view.test.tsx` directly: 18/18 passing, including the
  existing `chats`/`startable` cases (unchanged, still pass).
- `python3 .githooks/secret-scan.py --all` — clean.

## Decisions

### 22 Oct 2026 · 11.1c window label shown unless `later` · decided by builder · risk: low
- Decided: the view renders the window label for `reminder_24h`/`reminder_1h`/`starting_soon`
  only; `later` has no label text (no `home.liveClasses.window.later` key was added).
- Why: the plan's "How it will be shown" explicitly describes "a class far out shows
  `later`/no label" — i.e. `later` is a non-label state, so no translated string is needed for it.
- risk: low

### 22 Oct 2026 · 11.1c live-class lookup lives inline in page.tsx, not a new module · decided by builder · risk: low
- Decided: the per-teacher lookup (`homeLiveClasses`) is a local function inside
  `apps/web/app/home/page.tsx` rather than a new file under `apps/web/src/chat/` or similar.
- Why: the plan's file list for Phase C names only `page.tsx`, `view.tsx`, `en.json` and their
  tests; `repos.liveClasses.listUpcomingForStudent` is scoped per (student, teacher) pair (same
  shape as `subscriptions.findLive`), so resolving each candidate's owning teacher and deduping is
  needed, but adding a new shared module would go beyond the listed files.
- risk: low

## Left to do

Nothing outstanding for Phase C. Edit/cancel of a scheduled class and a real email/SMS reminder
are tracked follow-ups outside this task (per the plan's "Lead answers").

Status: DONE

Tool calls used: 33
