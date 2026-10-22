# Handoff: 9.7b — E2E full flow, Phase B (discover + upgrade)

Branch: `m9/9.7b-e2e-discover-upgrade` (local `work-97b`), worktree
`.claude/worktrees/agent-a82bae8db818dfaed`.

## Summary
`apps/web/e2e/full-flow.spec.ts` now runs the whole student/teacher story from discovery:

1. **discover**: `/teachers` → search "Python" (the page's own GET form) → result link "Demo
   Teacher" → `/teachers/demo-teacher` (h1 "Demo Teacher") → "Choose a package" →
   `/packages/demo-agent`.
2. subscribe (free), learn, locked notice: Phase A's steps, unchanged.
3. **upgrade**: `/learn/demo-agent/plan` → the "Full course" row's **Upgrade** button (the real
   9.6 `PATCH /api/subscriptions/:id`, no payment) → lands on `/learn/demo-agent` with no `?s=`.
   A second tab then opens the plan page and checks "Your current package" now reads "Full
   course". The subscription change is real; only the chat replies are mocked.
4. **unlocked**: one more message gets a normal (mocked) reply, and "This is part of Full
   course." has count 0.
5. uncovered question → teacher answers → student reloads and sees the answer: Phase A, unchanged.

No app code, fixtures, global setup, config or CI changes. `fixtures.ts` and `global-setup.ts`
needed nothing: discovery only needs the teacher verified, which 9.7a's setup already does.

## Files
- `apps/web/e2e/full-flow.spec.ts` (edit): discover and upgrade/plan-check/unlocked steps, a fourth
  mocked turn (unlocked reply), a `method` option on `postOnce` (POST by default, PATCH for the
  upgrade), a `navigateUntil` helper for GET navigations and links, and a question text that is
  unique per run.

## Tests
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → `Tasks: 10 successful, 10 total`
  (after merging `origin/main`).
- `python3 .githooks/secret-scan.py --all` → exit 0.

## e2e run evidence
Throwaway Postgres: `EDMATE_PG_TEST_PORT=55497 docker compose -p edmate-97b -f docker/compose.yaml
-f packages/db/test/compose.port.yaml up -d --wait postgres`, with a fresh `docker/data/postgres`
in this worktree. Run with `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55497/edmate
EDMATE_E2E_PORT=3197 corepack pnpm --filter @edmate/web e2e`. The project was removed afterwards
(`down`, data dir deleted). The `edmate-*` stack containers were not touched. Each run starts a
cold `next dev`. The host was shared with other builders, at load average 8–234.

```
# final spec, before the origin/main merge: 5 in a row
run 1  ✓ full-flow.spec.ts › full flow: discover -> subscribe (free) -> ... -> teacher answer (36.3s)  1 passed
run 2  ✓ ... (21.8s)  1 passed
run 3  ✓ ... (22.2s)  1 passed
run 4  ✓ ... (15.8s)  1 passed
run 5  ✓ ... (21.7s)  1 passed
# whole suite (chat + full-flow + skills)
15 passed (33.8s)
# after merging origin/main: 3 in a row (load average 234 → 58)
run 1  ✓ ... (36.5s)  1 passed
run 2  ✓ ... (48.5s)  1 passed
run 3  ✓ ... (41.5s)  1 passed
```

Earlier failures, now fixed in the spec:
- A re-run after a failed run hit 9.7a's clean-DB problem: the inbox `getByText(question)`
  matched two rows. The question text now has a per-run suffix.
- Under load, separate fill and click calls on the search box sometimes submitted `?q=` empty.
  The trace showed `next dev` reloading the page over and over (Fast Refresh) between the two
  calls. The search box is now filled and the form submitted in one in-page step (still the
  real input and Search button). Each idempotent navigation is retried until its URL matches.
- Seen once while the host load average was about 27, and not caused by this change: the
  untouched `chat.spec.ts` failed every test in one whole-suite run. It types before hydration
  and has no retry, and the trace showed the same dev reloads. The next whole-suite run passed
  15/15.

## Decisions

### 22 Oct 2026 · 9.7b The discover search is typed and submitted in one in-page step · decided by builder · risk: low
- Decided: the search step sets the real search input's value and calls `form.requestSubmit` with
  the real Search button in one `evaluate`. It is wrapped in `navigateUntil`, which retries only
  idempotent GET navigations and link clicks until the URL matches. Link clicks stay as normal
  Playwright clicks.
- Why: on a loaded host, `next dev` reloaded the page between a separate `fill` and `click`, so
  the GET form was submitted as `?q=` again and again (seen in the trace). One in-page step
  leaves no gap for a reload. It still uses the page's own form, so the search path is still
  covered. POSTs keep using `postOnce`, so they are never repeated.
- risk: low (test-only).

### 22 Oct 2026 · 9.7b The uncovered question text is unique per run · decided by builder · risk: low
- Decided: `UNCOVERED_QUESTION_TEXT` ends with a base-36 timestamp suffix.
- Why: 9.7a's handoff noted that the spec needed a clean DB, because a failed run leaves its question
  open and the next run's inbox `getByText` matched twice. A unique text removes that. CI is
  unaffected (fresh DB).
- risk: low (test-only).

### 22 Oct 2026 · 9.7b The upgrade is checked on the plan page, not only through mocked replies · decided by builder · risk: low
- Decided: after the redirect, a second tab opens `/learn/demo-agent/plan` and checks that "Your
  current package" shows "Full course". Then the unlocked message is sent.
- Why: the locked and unlocked replies are mocked, so without this check the test could pass
  even if the real `PATCH` upgrade did nothing.
- risk: low (test-only).

## Left to do
- Not proven in GitHub Actions from this branch. The lead should confirm the PR's `node` job is
  green.
- Follow-up idea, not a blocker: `chat.spec.ts` (9.4) has no hydration retry, and it failed all
  tests once under heavy host load. If CI shows the same, give it a `postOnce`-style send. A
  separate fix is a Playwright `outputDir` outside the watched app tree, if the dev reloads turn
  out to come from trace writes (not confirmed). Both are out of scope for 9.7b.

Status: DONE
Tool calls used: 45
