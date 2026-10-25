# Plan: 13.3 — Pre-pilot security review

## Acceptance (verbatim)
"no high findings open."

## How it will be shown
Four read-only `security-reviewer` (sonnet) passes, each over a bounded area, each
writing its raw findings to `docs/tasks/13.3/findings-<phase>.md` (lead transcribes
the reviewer's text; reviewer touches no source files). After all four phases: every
CRITICAL/HIGH is either fixed (own commit, re-checked by the same phase's reviewer)
or turned into its own board fix task; every MEDIUM/LOW becomes a board follow-up
(id, phase, one line). `docs/tasks/13.3/review.md` lists every finding with a
disposition (fixed / follow-up task id / wontfix + reason). Handoff is DONE only
when `review.md` shows zero CRITICAL/HIGH rows without a "fixed" disposition.

## Scope note vs. the lead's suggested areas
Board task 10.8 already owns "payments security review incl. webhooks (moved from
13.3)". So Phase C below reviews `apps/worker` ingest/uploads/SSRF and alerts in
full, but only *confirms scope* on payments/webhooks: no live webhook route exists
yet under `apps/web/app/api/webhooks/**` (not found in the tree), and
`packages/payments/src/testing/*` is test-only. Phase C notes this and defers any
deep payments/webhook finding to 10.8 rather than duplicating that review.

## Existing isolation/leak coverage (don't repeat; cite instead)
- `packages/harness/src/access/{entitlement,property,tools.property,turn.property,
  scopedRetrieval,retrieval.property}.test.ts` — property-fuzzed entitlement/tool/
  retrieval isolation at the harness boundary.
- `packages/db/test/{access-property.int,access-audit,scope,retrieval-leak.int,
  repositories.int,leak,leak-cache,identity.int}.test.ts` and
  `packages/db/test/isolation-seed.ts` — the DB-level isolation grid and leak
  fixtures.
- `apps/web/src/auth/route-coverage.test.ts` — every API route has a declared auth
  policy.
Phases A/B read these first and look for *gaps* (an untested repository method, a
route not in the coverage list, a filter added after the grid was written) rather
than re-deriving what they already assert.

## Phases (each a separate security-reviewer sonnet run, ~40 tool calls, read-only)

### Phase A — DB scope and the access filter
- Directories: `packages/db/src/repositories/**` (esp. `scope.ts`, `map.ts`,
  `insert.ts`, `retrieval.ts`, `chunks.ts`, `question-similarity.ts`,
  `teacher-questions.ts`, `insights.ts`), `packages/harness/src/access/**`.
- Checks: every read/write scoped by the right teacher_id/student_id/agent_id;
  no raw SQL string interpolation; a missing `WHERE` on a new repo method since the
  grid above was written; retrieval leak-check complement scope still fails closed;
  advisory-lock ordering (per the 8.7a/5.10b lesson) on any multi-row writer.
- Output: `docs/tasks/13.3/findings-A.md`.

### Phase B — Web auth, guards, route policy, entitlement
- Directories: `apps/web/src/auth/**`, `apps/web/app/api/**` (all routes, esp.
  `staff/**`, `studio/**`, `sessions/**`, `me/export/**`, `me/memory/**`,
  `subscriptions/**`).
- Checks: entitlement bypass on chat/export/memory (student A reading student B's
  data via an id swap; teacher A reading teacher B's studio data; staff routes
  reachable by non-staff); session pinning vs. a stale/forged session id; rate
  limiting and the age gate; CSRF/method checks on mutating routes; IDOR via path
  params not matched to the authenticated identity.
- Output: `docs/tasks/13.3/findings-B.md`.

### Phase C — Worker, uploads/ingest, payments scope note
- Directories: `apps/worker/src/ingest/**`, `apps/worker/src/webLink/**`,
  `apps/worker/src/storage/**`, `apps/worker/src/alerts/**`;
  `packages/payments/**` (existence/scope check only, per the note above).
- Checks: SSRF on web-link fetch (note open item 5.1a — DNS-rebinding pin is a
  known gap, don't re-litigate, just confirm it's still only an allowlist mitigation);
  file-type/size validation on uploads; path traversal in storage keys; alert
  delivery can't be spoofed cross-tenant; payments: confirm no live webhook route
  and no real provider calls are reachable from a test build.
- Output: `docs/tasks/13.3/findings-C.md`.

### Phase D — Dependencies, headers, secrets, logging
- Scope: repo-root `corepack pnpm audit --prod` output (reviewer reads the JSON/
  text the lead pastes in, doesn't run installs); `apps/web/next.config.ts` and any
  middleware for security headers/CSP (none found yet — confirm and note as a
  finding if genuinely absent); `.env*.example` and `packages/*/src/**` for
  hardcoded secrets or keys; worker/web log calls for PII (student text, phone/
  email, answer keys) reaching stdout or an external sink.
- Output: `docs/tasks/13.3/findings-D.md`.

## Files to create
- `docs/tasks/13.3/findings-A.md`, `findings-B.md`, `findings-C.md`, `findings-D.md`
- `docs/tasks/13.3/review.md` (consolidated dispositions)
- `docs/tasks/13.3/handoff.md`
- Board entries for MEDIUM/LOW follow-ups (lead edits `docs/board/tasks.yaml`)
- Any CRITICAL/HIGH fixed in-task: the minimal diff in its own file(s), named once
  findings are in (unknown until Phase A–D run)

## Files out of bounds
- `.claude/settings.json`, `.claude/**` hooks, `.github/**` — no changes
- No real model or payment calls; no network calls beyond the reviewer reading
  local files and the lead pasting `pnpm audit` output
- `apps/web/app/api/webhooks/**` / deep payments review — owned by 10.8
- `packages/contracts/**` — any fix that would require a contracts change stops and
  goes to the lead/architect (ADR path), not fixed inline here

## Tests first
This task produces no new product code by default — only findings docs. If a
CRITICAL/HIGH needs an in-task fix: write or extend the failing test in the
existing suite nearest the bug first (e.g. add a case to `access-property.int.test.ts`,
`scope.test.ts`, or the relevant route's `.test.ts`), confirm it fails, then fix and
confirm the full suite for that package is green (per the "red CI from changes that
passed locally" lesson — run the whole package suite, not just the new test).

## Risky paths touched
- Phases A–D themselves: read-only, no edits — no risk-paths.txt group is written.
- Any in-task fix would land in: `packages/db/src/repositories/**` or
  `packages/harness/src/access/**` → reviewers: `security-reviewer` (already the
  role running the review); `apps/web/src/auth/**` or `apps/web/app/api/staff/**` →
  `security-reviewer`; `apps/worker/src/alerts/**` → `code-reviewer` (and, per the
  risk-paths.txt header note, 13.3 is the task that restores `safety-reviewer` to
  the guardrails/safety group going forward — any fix touching
  `packages/harness/src/guardrails/**` or `evals/suites/safety|locked/**` gets
  `safety-reviewer` too, not just `code-reviewer`).
- Any fix PR logs a `risk: high` decision per the merge policy.

## Open questions for the human
- None blocking the plan. One scheduling note for the lead (not the human): 13.3's
  board deps are M11, M12, M8, M9 — confirm those milestones are far enough along
  before starting Phase A, since a review mid-build will re-find gaps the in-flight
  tasks are already closing.

## Budget
Budget: 200 tool calls (5 phases: A, B, C, D review + one shared fix round, packages: db, harness, web, worker, payments)

## Allowed tools
Phases A–D (security-reviewer): Read, Grep, Glob only (read-only review).
Fix round (if any CRITICAL/HIGH found): Read, Grep, Glob, Edit, Write, Bash (tests and secret scan only). Lead: Write (findings/review/handoff files, board entries).

## Exit conditions
Status: DONE when all four findings files exist, `review.md` shows zero CRITICAL/HIGH
rows without a "fixed" disposition, and every MEDIUM/LOW has a board follow-up id.
Status: PARTIAL when a phase can't finish inside ~40 calls, when a fix would require
a contracts/ADR change (stop, hand to architect/lead), or when a dependency milestone
(M8/M9/M11/M12) turns out not to be merged enough to review meaningfully — in either
case, name the exact blocker and which phase(s) are unaffected and already filed.
