# Task 7.3 handoff: per-agent suite generator

Status: DONE
Branch: m7/7.3-suite-generator (built locally as `work-73`)
Worktree: .claude/worktrees/agent-a2262182648e4820c
Tool calls used: 34 (harness count)

## What was built

- `packages/evals/src/perAgentSuite.ts`: `generatePerAgentSuite(input): EvalCase[]`. It is pure
  and synchronous, with no clock, environment, filesystem or network. Its local input types are
  `AnswerableItem`, `OutOfCourseItem`, `AgentPackage` and `PerAgentSuiteInput`, and it also
  exports `LOCKED_TEMPLATES` (`direct`, `summary`, `already-paid`, `outline`) and
  `PerAgentSuiteError`. Rules 1 to 7 are implemented as the plan describes them:
  - one accuracy case for each pair of answerable item and covering package;
  - items answered only in a locked module become locked cases;
  - one out-of-course case per item;
  - every locked template for each locked module and each package that excludes it;
  - ids are sanitised, and an id collision throws, naming both sources;
  - `reviewed_by: generated:<provenance>` on every case;
  - the output is deterministic.

  Every case is checked against `EvalCaseSchema` before it is returned, and an invalid case
  throws with its id and source.
- `packages/evals/src/perAgentSuite.test.ts`: 19 unit tests on a synthetic world with 2 modules
  and 2 packages.
- `packages/evals/src/perAgentSuiteDemo.test.ts`: 4 acceptance tests. They load
  `content/demo-teacher` through `loadDemoTeacherContent` and adapt it in the test, adding two
  synthetic `teacher_eval_cases`-shaped rows.
- `packages/evals/src/index.ts`: exports the generator and its types.
- `packages/evals/package.json`: adds `@edmate/content` as a devDependency (this also updates
  `pnpm-lock.yaml`).

Nothing is written to disk, and nothing under `evals/suites/**` was touched.

## Acceptance evidence

`corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...`

```
@edmate/evals:test:  ✓ src/perAgentSuite.test.ts (19 tests)
@edmate/evals:test:  ✓ src/perAgentSuiteDemo.test.ts (4 tests)
@edmate/evals:test:  Test Files  25 passed (25)
@edmate/evals:test:       Tests  1061 passed (1061)
@edmate/evals:test: All files          |     100 |    96.75 |     100 |     100 |
@edmate/evals:test:   perAgentSuite.ts |     100 |      100 |     100 |     100 |
 Tasks:    18 successful, 18 total
```

Demo teacher counts (inline snapshot in `perAgentSuiteDemo.test.ts`): **accuracy 106, locked 49**,
against a requirement of at least 50 and at least 30.

- **Accuracy (106):** 52 cases from the question bank, 43 from the qa-recall in-course items,
  3 from the synthetic rows and 8 out-of-course cases.
- **Locked (49), all for the free package:** 40 `direct` cases plus 3 module templates × 3
  locked modules.

The four planned templates were enough, so no extra template was added (Q4). Every case parses
against `EvalCaseSchema`, every id is unique, a second run gives a deep-equal result, and
qr-15..18 become free-package locked cases.

## Deviations

- `pnpm-lock.yaml` changed. This follows from the planned devDependency and was regenerated
  by `corepack pnpm install`.
- The plan sketched the input types. Four fields were added to them (see Decisions):
  - `AnswerableItem.answer` is optional;
  - `OutOfCourseItem.provenance` is new;
  - `AgentPackage.sourceLabel` is new;
  - `LOCKED_TEMPLATES` and `PerAgentSuiteError` are exported.

## Decisions

### Recall items without an answer get a generic judge statement
Decided: qa-recall in-course items have notes headings but no reference answer. For these items,
`AnswerableItem.answer` is optional. When it is missing or blank, the accuracy case's judge
statement is "The reply answers the question from the course material instead of refusing or
passing it to the teacher." It keeps `must_cite_source: true`. Builder, risk: low.

### Items answered in another module are keyed on that module by the adapter
Decided: To route an item answered only in a locked module (rule 2, Decision 4), the generator has no
`expectedModuleId` field. Instead, the caller's adapter passes the *answering* module as
`moduleId`. The demo adapter maps qa-recall `expectedModuleId` to `moduleId` this way.
Builder, risk: low.

### Ids are lowercased before sanitising
Decided: A case id is lowercased first, and every character outside `[a-z0-9-]` then becomes `-`. This
way `Loops` becomes `loops`, not `-oops`. The case's `package` field keeps the real,
unsanitised package id. Builder, risk: low.

### Module-level locked cases cite the package file
Decided: `AgentPackage` gained a `sourceLabel` field. The `summary`, `already-paid` and `outline` cases
cite `<package sourceLabel>#locked:<moduleId>`, and `direct` cases cite the item's own source.
This keeps `source` caller-supplied instead of prose written by the generator.
Builder, risk: low.

### Out-of-course cases run under the first package
Decided: An out-of-course case is package-independent, but `EvalCase.package` is required, so the
generator sets it to the first package in the input. Out-of-course items also carry a
`provenance` field, which gives them `generated:qa-recall` for the demo.
Builder, risk: low.

### No packages, or an invalid generated case, throws
Decided: If the input has no packages, the generator throws `PerAgentSuiteError` rather than returning
an empty suite, which would look like a pass. It also throws when a generated case fails
`EvalCaseSchema` (for example, an empty question), naming the case id and its source.
Builder, risk: low.

### Reference answers are collapsed and truncated
Decided: The reference answer in a judge statement is collapsed to one line and cut at 280 characters,
with `…` added when it is cut. Builder, risk: low.

### Provenance tag confirmed by the lead
Decided: `reviewed_by: generated:<provenance>` is used as the lead confirmed in Q1. The sign-off rule
covers `evals/suites/**` only. Planner and lead, risk: medium.
