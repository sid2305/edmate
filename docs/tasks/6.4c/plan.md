# 6.4c plan: the 6.4a review LOWs (M13)

Board: 6.4c (M13), deps 6.4a (done). Planned by the lead, 27 Oct 2026 (small, mechanical task).
Starts after 6.4b (end route) and 6.3c (runner.ts, practice.ts) merge, on a branch from that main.

Verdict: READY

## What to do (test first, red then green, one item at a time)

1. **Telemetry when `evidenceFor` skips a practice turn with no usable topic** —
   `packages/harness/src/pipeline/runner.ts` `evidenceFor`. When the turn is a graded practice
   turn (`turnSkill === 'practice'`, attempt `correct` or `wrong`) but `practiceTopicId` is
   missing or fails the id shape, record the skip through the runner's existing observability
   path (the trace builder or the event/log path the runner already uses for similar skips; pick
   the one that needs no `packages/contracts` change). Record a reason code only
   (`no_topic` / `bad_topic_id`), never the student's text or the item. If no existing path can
   carry it without a contracts change, stop and say so in the handoff instead of changing
   contracts. Test: a graded generated-item turn produces the skip record; a graded bank-item
   turn with a topic does not.
2. **A test for a `SessionSummarySchema` failure in the end route** —
   `apps/web/app/api/sessions/[id]/end/route.test.ts`. A scripted summarizer output that fails the
   schema: the session still ends, `ok()` comes back, no summary is attached, and the log carries
   the error name only. Test-only unless the test exposes a bug.
3. **A `'limit'` case in the end route's `RepositoryError` switch** —
   `apps/web/app/api/sessions/[id]/end/route.ts`. Map `limit` to the same response other routes
   give for it (find the existing mapping, e.g. 429 or the shared helper; follow it). Make the
   switch exhaustive (a `never` check) so a future kind fails typecheck. Test the new case.
4. **`pickItem` gets the topic map when one is given** — `packages/harness/src/tools/practice.ts`.
   Add an optional `topicMap` to the practice tool's options and pass it through to `pickItem`'s
   existing `topicMap` parameter, so a future DB-backed bank item whose topic was deleted (or sits
   under another module) is skipped instead of failing commit. No caller has to pass it yet (no
   DB-backed bank exists). Test: with a topic map that lacks an item's topic, that item is never
   picked; without a map, behaviour is unchanged.

## Files

- Modify: `packages/harness/src/pipeline/runner.ts` (+ a runner test, e.g. next to
  `runner.evidence.test.ts`), `packages/harness/src/tools/practice.ts` (+ `practice.test.ts`),
  `apps/web/app/api/sessions/[id]/end/route.ts` (+ `route.test.ts`).
- Out of bounds: `packages/contracts/**`, `packages/db/**`, `packages/harness/src/pedagogy/**`.

## Risky paths

None of the files above match `.claude/skills/merge-gate/risk-paths.txt` (check again before the
PR). Reviewers: code-reviewer and typescript-reviewer.

## Gate

```bash
corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/web
python3 .githooks/secret-scan.py --all
```

## Budget

Budget: 55 tool calls (one phase).
