# 11.2a: class questions repository and clustering in packages/db

## Summary

Phase A of task 11.2: a student's pre-class question queue.

- `classQuestionsRepo.submit(scope, { liveClassId, text })` (student-scoped write): writes one
  `class_questions` row only when, in a single statement, the live class belongs to the scope's own
  teacher, the scope's student holds a live (`trial`/`active`) subscription to one of the class's
  packages, and the class has not started yet (`startsAt > now`) — the same entitlement/window
  `liveClasses.listUpcomingForStudent` already checks. Anything else is `not_found`; nothing is
  written.
- `classQuestionsRepo.listQueueForTeacher(scope, { limit? })` (teacher-scoped read): the teacher's
  own classes' pending questions, clustered by lexical similarity via a new `clusterQuestions`
  (a pure sibling of 5.10's `bestGroup`, clustering a whole flat list at once rather than joining
  one new item onto caller-filtered candidates). Returns biggest group first, then oldest; a
  cluster may span more than one of the teacher's classes. The table carries no student id, so the
  result never carries one.
- No schema change: `class_questions` and `live_classes` already exist since migration 0001 (lead
  answer, 22 Oct 2026). No `packages/contracts` change.

## Files

- `packages/db/src/repositories/class-questions.ts` (new)
- `packages/db/src/repositories/question-similarity.ts` (added `clusterQuestions`,
  `ClusterableQuestion`, `QuestionCluster`; simplified one pre-existing, provably-unreachable
  ternary branch in `questionSimilarity` — see Decisions)
- `packages/db/src/repositories/index.ts` (registered `classQuestions`; shared file with 12.5a —
  only my own lines added)
- `packages/db/src/repositories/README.md` (new "Pre-class question queue" section; shared file
  with 12.5a — only my own lines added)
- `packages/db/test/class-questions.int.test.ts` (new)
- `packages/db/test/question-similarity.test.ts` (added `clusterQuestions` tests, plus two
  branch-coverage tests for the pre-existing `bestGroup`/`questionSimilarity`)
- `packages/db/test/repositories.int.test.ts` (added `'classQuestions.submit'` and
  `'classQuestions.listQueueForTeacher'` isolation cases, plus the `CLASS_Q_TEXT` fixture; shared
  file with 12.5a — only my own lines added)

## Tests

- `class-questions.int.test.ts`: 9 cases — submit happy path; refused for `past_due`/`paused`/
  `ended` subscriptions; refused for the wrong package; refused across teachers; refused once the
  class has started; refused for empty/over-length (8001-char) text; `listQueueForTeacher` teacher
  isolation; clustering across two of a teacher's classes with a dissimilar question staying
  separate; confirms the result never carries a student id.
- `question-similarity.test.ts`: 12 new/changed cases for `clusterQuestions` (empty input, a loose
  3-item cluster across two classes, two unrelated singletons, biggest-first/oldest/group-id
  ordering with both tie directions, order-independence, the `MIN_SHARED_TERMS` exclusion) plus one
  new case each for `questionSimilarity`'s unreachable-union branch and `bestGroup`'s
  equal-score/equal-createdAt id tie, both directions.
- `repositories.int.test.ts`: added both new methods to the generic isolation grid (`CASES`), so
  the existing cross-actor/cross-target sweep covers them the same way as every other repository
  method.

Gate (Postgres up via a disposable `edmate-test-112a-pg` container, since removed):

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --force --concurrency=1
 Tasks:    26 successful, 26 total
```

`src/repositories/**` coverage: 100% lines/statements/functions; branches aggregate well above the
90% threshold (my own two touched files: `class-questions.ts` 100/100/100/100,
`question-similarity.ts` 100% lines/statements, 93.18% branches — the two remaining uncovered
branch lines there are inside `bestGroup`'s multi-candidate scan loop, pre-existing before this
task and not reachable from any new code path I added).

`python3 .githooks/secret-scan.py --all`: clean.

## Decisions

### 22 Oct 2026 · 11.2a class questions repository touches a risky path · decided by builder · risk: high
- Decided: `packages/db/src/repositories/**` is a risky path (build plan §11.2 Phase A). This PR
  needs `security-reviewer` and `database-reviewer` before merge, per the plan's explicit call-out.
- Why: the new `submit` write path gates on live-subscription entitlement and a class-start-time
  window, and `listQueueForTeacher` must never leak a student id — both are exactly the kind of
  access-control logic the plan asks security-reviewer and database-reviewer to check.
- risk: high

### 22 Oct 2026 · 11.2a scope.test.ts needs no edit for new methods · decided by builder · risk: low
- Decided: did not add manual entries to `packages/db/test/scope.test.ts` for the two new
  repository methods, despite the plan's file list mentioning it.
- Why: `scope.test.ts`'s bad-scope sweep iterates `Object.entries(repos)` at runtime
  (`allMethods()`), so it already covers any method registered in `index.ts` with no per-method
  edit needed; added cases there would have been dead, redundant code.
- risk: low

### 22 Oct 2026 · 11.2a isolation case ownership for a table with no student id · decided by builder · risk: low
- Decided: `'classQuestions.submit'`'s isolation `WriteCase` uses a custom `owns` keyed on
  teacher-equality (`teacherOf(actor) === teacherOf(target)`), not the usual pair-equality, and
  reuses each pair's own already-entitled `liveClassFor` fixture rather than adding a
  subscription-swap fixture.
- Why: `class_questions` carries no student id — ownership of a submitted question is really "did
  this teacher's own class receive it", which the existing per-teacher fixtures already model
  without new fixture machinery.
- risk: low

### 22 Oct 2026 · 11.2a simplified one pre-existing unreachable ternary branch · decided by builder · risk: low
- Decided: in `questionSimilarity`, replaced `return union === 0 ? 0 : shared / union;` with a
  plain `return shared / union;` (both sets are already guarded non-empty above, so `union` can
  never be 0 — the branch was dead code), and added tests to close the resulting branch-coverage
  gaps that the stricter 100%-lines/statements threshold on `src/repositories/**` otherwise failed
  on, caused by this single file.
- Why: this was the only remaining blocker to a clean gate once my own new code's branches were
  covered; the change is behavior-preserving (provably unreachable before and after), scoped to a
  file this task already touches, and avoids editing `teacher-questions.ts` (out of bounds for this
  task — see note below).
- risk: low

## Note for the lead (not a blocker, pre-existing)

While chasing the `src/repositories/**` 100%-lines/statements gate threshold, I found
`teacher-questions.ts` has two pre-existing uncovered branch ranges (lines 296, 399-401 — sort
tie-break comparators in `listGroupsForTeacher`/`answer`). Confirmed via
`git diff --stat origin/main -- packages/db/src/repositories/teacher-questions.ts
packages/db/test/teacher-question-answer.int.test.ts packages/db/vitest.config.ts` (zero diff) that
this is identical on `origin/main` today, not introduced by this task. It does not block this PR's
gate (branches only need 90% in aggregate for the glob, and the aggregate clears that), but a
future task that touches `teacher-questions.ts` should expect a pre-existing, unrelated
branch-coverage gap there. Not filing a blocker since it does not block my own work or anyone
else's right now.

## Fix round 1

One HIGH from review:

- `listQueueForTeacher` scanned `desc(createdAt), desc(id)` before `.limit(QUEUE_SCAN_MAX)`, so a
  teacher with more than 200 pending questions had the oldest ones silently dropped instead of the
  newest. Changed the scan to `asc(createdAt), asc(id)` with the same cap (same output ordering;
  only the pre-cluster scan direction changed). Added
  `class-questions.int.test.ts`'s `"scans oldest-first past the cap: the oldest pending question
  survives, the newest is dropped"` (201 synthetic rows in one bulk insert, QUEUE_SCAN_MAX=200);
  confirmed it fails against the old `desc` scan and passes against the fix.
- Added a one-line comment on `submit`'s `.for('key share')` explaining it blocks a concurrent
  subscription cancel/downgrade until the insert commits (TS [LOW] from review).

Gate (disposable `edmate-test-112a-fix` pgvector/pgvector:pg16 container, since removed):

```
corepack pnpm turbo run typecheck lint test --filter=@edmate/db...
 Tasks: 26 successful, 26 total
```

`python3 .githooks/secret-scan.py --all`: clean.

## Left to do

None for Phase A's own scope. Phase B (apps/web) is explicitly out of bounds for this task.

Status: DONE

Tool calls used: 142
