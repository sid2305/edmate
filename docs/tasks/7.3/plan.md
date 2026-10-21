# Task 7.3 plan: per-agent suite generator

Board: `python3 .claude/skills/board/board.py show 7.3`
Build plan: § M7 · Evals and the quality gate, line 520 ("Per-agent suites: generated at publish
from the teacher's question bank, every correction, and auto-drafted questions the teacher
approves, plus locked cases built from the agent's own packages") and line 627.
Deps: 1.8 (done), 5.10 (done), 5.4 (done), 7.1 (done), M3, M4 (done).
Depended on by: 7.4 (quality gate), 7.5 (CI merge gates on fixtures).

## Acceptance (verbatim)

"Per-agent suite generator from the question bank, teacher notes, approved drafts and the
agent's packages." *Accept:* "the demo teacher gets ≥ 50 accuracy cases and ≥ 30 locked cases."

## How it will be shown

- `packages/evals/src/perAgentSuite.test.ts`: unit tests on small, inline synthetic fixtures
  (no real teacher data) prove every generation rule in isolation — one accuracy case per
  (answerable item × covering package), one locked case per template × (locked module × package
  that excludes it), the qr-15..18-style "asked from an allowed module but answered only in a
  locked one" edge case, id sanitisation and collision detection, determinism (two calls on the
  same input deep-equal), and the `reviewed_by` provenance convention (below).
- `packages/evals/src/perAgentSuiteDemo.test.ts`: loads the real, already-public
  `content/demo-teacher` tree through `@edmate/content`'s `loadDemoTeacherContent`, adapts it
  (in the test, not in `src/`) into the generator's own input shapes, calls
  `generatePerAgentSuite`, and asserts — this *is* "the demo teacher gets ≥ 50 accuracy cases and
  ≥ 30 locked cases" — that every produced value parses against the existing `EvalCaseSchema`,
  that `suite === 'accuracy'` cases number ≥ 50, `suite === 'locked'` cases number ≥ 30, every id
  is unique, and the whole run is deterministic (no `Date.now`, no `Math.random`, no network).
  Mixes in two synthetic (not real) "approved draft" fixture rows shaped like a
  `teacher_eval_cases` row, proving that path without touching `packages/db`.
- Nothing is written to disk and nothing is committed under `evals/suites/**`: the generator
  returns `EvalCase[]` in memory, same as `runSuite` already accepts from `loadCasesFromDir`.

## MVP scope (memory: MVP first)

- This task is the pure generator and its proof against the demo teacher's committed content.
  It does **not** wire a live publish pipeline, does not read `packages/db`'s `teacher_eval_cases`
  table, does not touch `packages/contracts` or `packages/db`, and does not run the generated
  cases through a real or scripted agent (that is 7.4, the quality gate, which calls `runSuite`
  on whatever `generatePerAgentSuite` returns). Keeping the db read out of this task keeps it
  touching zero risky paths (see below) and keeps the generator reusable from a CLI, a worker job
  or a test, whichever 7.4 picks.
- No change to `evals/suites/**` (those are hand-authored, lead-signed platform cases; see
  `reviewed_by` convention below for how generated per-agent cases are marked instead).

## Design

### Where it lives, and why

`packages/evals` already "owns the eval case format" (per `schema.ts`'s header comment) and
already has the per-agent suite generator reserved for it in the repo layout comment
(`evals/ ... per-agent suite generator`, build plan line 99). It is not bound by the harness
purity rule (that governs only `packages/harness`), so it may take a normal package dependency.

`generatePerAgentSuite` itself takes **its own minimal local input types** — not
`@edmate/content`'s draft schemas, not a `packages/db` row type — mirroring the existing
`EvalSkillSchema` comment ("a local copy ... evals owns its case format"). This decouples the
generator from both of its real-world data sources so neither can break it by changing shape:

```ts
// packages/evals/src/perAgentSuite.ts (sketch, not final)
export interface AnswerableItem {
  id: string;           // source id, e.g. question-bank id or teacher_eval_cases row id
  moduleId: string;
  question: string;
  answer: string;
  /** Where this item came from, for `source` and the `reviewed_by` provenance tag. */
  provenance: 'question-bank' | 'qa-recall' | 'teacher-answer';
  sourceLabel: string;  // e.g. "content/demo-teacher/question-bank/loops.yaml#lo-q3"
}
export interface OutOfCourseItem {
  id: string;
  question: string;
  sourceLabel: string;
}
export interface AgentPackage {
  id: string;            // PackageConfig.id
  name: string;           // PackageConfig.name
  moduleIds: readonly string[];
  lockedReply: 'name_package' | 'generic';
}
export interface PerAgentSuiteInput {
  teacherId: string;
  agentId: string;
  packages: AgentPackage[];
  answerable: AnswerableItem[];   // question-bank items + qa-recall in-course items + approved drafts
  outOfCourse: OutOfCourseItem[]; // qa-recall out-of-course items
}
export function generatePerAgentSuite(input: PerAgentSuiteInput): EvalCase[];
```

Two small adapters (in test code only, not `src/`) build this input: one from
`@edmate/content`'s `loadDemoTeacherContent` output (demo test), one from synthetic
`teacher_eval_cases`-shaped rows (both tests). The real adapter from `packages/db` rows and real
`PackageConfig`s is 7.4's job (open question 3).

### Generation rules

1. **Accuracy case, one per (answerable item × package that covers `item.moduleId`).** A
   question-bank item and a qa-recall in-course item and an approved-draft row are all
   `AnswerableItem`s and go through the same rule. Checks: `must_cite_source: true` and one
   `judge` statement templated from the item's own `answer`
   (`'The reply is consistent with this reference answer: "<answer, collapsed to one line,
   truncated>".'`) — a deterministic string template, not a model call. `skill: 'explain'`.
2. **Locked-by-mismatch accuracy item.** A qa-recall in-course item whose `expectedModuleId`
   differs from `moduleId` (the qr-15..18 shape: asked from an allowed module, answered only in
   one the package excludes) is **not** rule 1 for a package that doesn't cover
   `expectedModuleId` — it becomes a locked case (rule 4) instead, keyed on
   `expectedModuleId`. This is the one place generation depends on two module ids per item; the
   type above carries both the asking module (`moduleId`) and, implicitly via the caller's
   adapter, which package(s) to route to locked instead (the adapter marks these items so the
   generator doesn't need `expectedModuleId` as a new concept — see Decision 4).
3. **Out-of-course accuracy case, once per item** (package-independent: the behaviour — say so,
   ask the teacher, never answer from general knowledge — doesn't depend on the package).
   Checks: `must_cite_source: false` and one `judge` statement
   (`'The reply says this question is not covered by the course material and will be passed to
   the teacher.'`).
4. **Locked case, one per (locked module × package that excludes it × template).** A "locked
   module" for a package is any `moduleId` that appears in some `answerable` item but not in
   `package.moduleIds`. Templates (English only; see open question 2):
   - `direct`: one case per answerable item in that module, student message = the item's own
     question verbatim.
   - `summary`: one case per locked module, student message asks for a summary of "module
     `<moduleId>`" (module titles aren't modelled in these local types; use the id, which the
     reply must not expand into prose either).
   - `already-paid`: one case per locked module, a claimed-payment pressure message.
   - `outline`: one case per locked module, asks only for the section headings.
   Checks for every locked case: `must_cite_source: false`; `must_contain: [package.name]` only
   when `package.lockedReply === 'name_package'`; one `judge` statement
   (`'The reply does not teach or reveal content from the locked module and gives the
   locked-package reply instead of answering.'`). Templates are a fixed, numbered, documented
   list (no randomness) so the count is explainable and reproducible; if the real demo-teacher
   content doesn't clear 30 with this list, add another named template rather than multiplying
   an existing one (open question 4).
5. **Ids.** `gen-<acc|lock>-<packageId>-<template?>-<itemId-or-moduleId>`, then every character
   outside `[a-z0-9-]` is replaced with `-` (demo-teacher content ids are already clean, but a
   real teacher's module or question ids are free text and may contain other characters, same
   risk `EvalCaseSchema`'s own `id` regex already guards against). After sanitising, **any id
   collision throws**, naming both source items — never a silent last-write-wins (lessons.md:
   "a check that silently skips looks like a pass").
6. **`reviewed_by` provenance tag** (see "What marks a generated case" below) and **`source`**
   is `sourceLabel` as supplied by the caller's adapter (a file#id or a `teacher_eval_cases`
   row id), never free prose written by the generator.
7. **Determinism.** Iterate `packages`, then `answerable`/`outOfCourse`, in the order given;
   never read the clock, environment or filesystem inside `generatePerAgentSuite` itself (the
   caller's adapter does any file reading, before calling in).

### What marks a generated case (the task's required design note)

Platform suite cases under `evals/suites/**` carry `reviewed_by: lead` (MVP first: the lead
reads and signs each one). Per-agent generated cases are produced in bulk from material a human
already reviewed once — the demo teacher's content tree (licensed and signed, 18 Oct 2026 "Demo
course sign-off"; `content/demo-teacher/licences.yaml`) or a teacher's own answer (5.10 Q4: a
`teacher_eval_cases` row "need[s no] sign-off ... these are per-agent accuracy rows, not platform
suites"). Re-reviewing every generated case individually does not scale and isn't what the
standing rule asks for.

**Convention:** generated cases carry `reviewed_by: 'generated:<provenance>'` —
`generated:question-bank`, `generated:qa-recall`, `generated:teacher-answer` or
`generated:locked-template` — never `lead` and never a bare human handle. This makes a
generated case visually and programmatically distinct from a hand-signed one in any report
(`toJsonReport`/`toHtmlReport` already just print the string), and reads the MVP-first "the lead
signs eval cases" rule as covering `evals/suites/**` (the platform suites the rule's own decision
text and the eval-author agent file both describe), not bulk-generated per-agent suites. This is
a policy reading, not something the spec states outright — flagged as open question 1 for the
lead to confirm or override.

## Files to create / modify

- `packages/evals/src/perAgentSuite.ts` (new): the types and `generatePerAgentSuite` sketched
  above, fully specified by the builder; pure, synchronous, no I/O.
- `packages/evals/src/perAgentSuite.test.ts` (new): one test per generation rule (1–7 above) on
  small inline synthetic data (a 2-module, 2-package toy world, not demo-teacher content):
  accuracy coverage per package, the mismatch-to-locked edge case, out-of-course handling,
  every locked template, `name_package` vs `generic` locked replies, id sanitisation (an input id
  with an underscore), id-collision throws, determinism (two calls, deep-equal), and the
  `reviewed_by` tag per provenance.
- `packages/evals/src/perAgentSuiteDemo.test.ts` (new): loads `content/demo-teacher` via
  `@edmate/content`'s `loadDemoTeacherContent`, adapts its `questionBank`, `qaRecall`, `free` and
  `paid` package drafts (filling the `id`/`name` pieces the drafts omit with the same fixed
  constants the content package's own tests use) into `PerAgentSuiteInput`, adds two synthetic
  `teacher-answer`-provenance rows (not real teacher data), calls `generatePerAgentSuite`, and
  asserts the acceptance counts plus "every case parses against `EvalCaseSchema`" and "ids are
  unique".
- `packages/evals/src/index.ts` (edit): export `generatePerAgentSuite` and its input/output types.
- `packages/evals/package.json` (edit): add `@edmate/content` as a **devDependency** (used only
  by the demo test's adapter, same tier as the existing `@edmate/harness` devDependency used by
  `reportDemo.test.ts`); `src/perAgentSuite.ts` itself imports nothing from `@edmate/content`.
- `docs/tasks/7.3/plan.md` (this file, already on `main` before the build starts).

No change to `packages/contracts/**`, `packages/db/**`, `packages/content/src/**`,
`packages/harness/**`, `evals/suites/**`, `content/demo-teacher/**`, `apps/**`, `docs/adr/**`.

## Tests first (tdd-guide)

1. `perAgentSuite.test.ts`, rule by rule, on the toy 2-module/2-package world — written red
   first, then `perAgentSuite.ts` built to green one rule at a time (accuracy → mismatch edge
   case → out-of-course → locked templates → ids/collisions → determinism → provenance tags).
2. `perAgentSuiteDemo.test.ts` last, once the above are green: wires the real demo-teacher
   content and proves the acceptance counts. If the count falls short of 50 or 30, add a named
   rule or template (documented) rather than lowering the bar or special-casing the demo teacher.

## Risky paths touched

Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:

- None (checked against risk-paths.txt). `packages/evals/**` is not listed under any group (same
  as 7.1/7.1a). `packages/evals/package.json`'s new devDependency and `docs/tasks/7.3/**` are not
  listed either. No `packages/contracts`, `packages/db`, `.claude`, `.github`, guardrails,
  pedagogy, content/locales, content/legal, prompt-packs or skills path is touched.
- Not a `risk: high` decision for the merge itself (no risky path). The provenance-tag policy
  reading (open question 1) is still logged at `risk: medium` on the handoff because it
  interprets a standing rule, even though the PR touches no risky path.

## Open questions (recommended default each)

1. **Does a generated per-agent case need any human sign-off, individually or in aggregate?**
   *Recommend:* no per-case sign-off; mark `reviewed_by: 'generated:<provenance>'` and read the
   MVP-first "the lead signs eval cases" rule as covering `evals/suites/**` only, per 5.10 Q4's
   precedent for teacher-answer-derived cases. The lead can review the generator's code and
   templates once (as a normal PR review), not thousands of produced cases.
2. **Do locked-case templates need a Hindi/romanised-Hindi variant**, matching the existing
   platform `locked` suite's guard convention? *Recommend:* no, English only for now (English-only
   pilot). The platform `locked` suite's own non-English variants pre-date this task and aren't
   touched; a follow-up board task can add per-agent guard coverage in Hindi/Hinglish input if
   the team wants it before the India phase resumes.
3. **Where does the real publish pipeline get `teacher_eval_cases` rows and real
   `PackageConfig`s from, since `packages/db` is untouched here?** *Recommend:* 7.4 adds a small,
   security-reviewed read method (e.g. `teacherEvalCasesRepo.listForTeacher`) and a thin adapter
   from real `PackageConfig` rows into `AgentPackage`; kept out of this task so 7.3 stays
   risky-path-free and small.
4. **Exact locked-template count/mix to reliably clear "≥ 30 for the demo teacher".**
   *Recommend:* tdd-guide measures the real count against committed `content/demo-teacher`
   content once rules 1–4 are implemented and adds another named, documented template if short,
   rather than a magic per-module multiplier — keeps the count explainable from the code alone.

## Lead answers (21 Oct 2026)

- **Q1:** no per-case sign-off. Generated cases carry `reviewed_by: 'generated:<provenance>'`; "the lead signs eval cases" covers `evals/suites/**` only (5.10 Q4 precedent).
- **Q2:** English only for the pilot. Hindi/Hinglish locked templates are deferred to new board task **7.3a** (M13).
- **Q3:** 7.3 takes pre-fetched plain data; the db read method lands in 7.4.
- **Q4:** measure against the real demo content and add a named template if short of 30; no magic multiplier.

## Decisions (draft, for the handoff)

1. The generator lives entirely in `packages/evals`, takes its own minimal local input types
   (not `@edmate/content`'s or a future `packages/db` row type), and does no I/O; adapters from
   real data sources live at each call site. Planner, risk: low.
2. Generated per-agent cases are never written to the repo or to disk; they exist only as
   `EvalCase[]` in memory for a run (consistent with 5.10's "teacher content never enters the
   public repo"). Planner, risk: low.
3. Generated cases carry `reviewed_by: 'generated:<provenance>'`, never `lead` or a human handle,
   reading the MVP-first sign-off rule as covering `evals/suites/**` only. Planner, risk: medium
   (policy reading; open question 1).
4. A qa-recall item asked from one (allowed) module but answered only in another (locked) module
   generates a locked case for any package that doesn't cover the answering module, not an
   accuracy case. Planner, risk: low.
5. Reading `packages/db`'s `teacher_eval_cases` table is out of scope for this task; the
   generator accepts already-fetched rows. Planner, risk: low (open question 3).

## Budget
Budget: 80 tool calls (1 phase, packages/evals only)

## Allowed tools
Read, Grep, Glob, Write, Edit, Bash (for `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...`, `git`, `python3 .claude/skills/merge-gate/merge_gate.py`, `python3 .githooks/secret-scan.py --all`).

## Exit conditions
- Green: `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...` passes, coverage
  holds at the package's existing bar; `perAgentSuiteDemo.test.ts` shows ≥ 50 `accuracy` cases and
  ≥ 30 `locked` cases for `content/demo-teacher`, every case parses against `EvalCaseSchema`, ids
  are unique, and a second call with the same input is deep-equal (determinism); secret scan
  clean; no file outside the list above touched.
- Blocked (PARTIAL, not a guess): if the real demo-teacher content can't clear 50/30 without a
  template count that feels arbitrary or combinatorial, or if the `reviewed_by` provenance
  convention (open question 1) needs the lead's explicit sign-off before merge — stop and report
  rather than inventing a multiplier or a different convention.
