# Task 1.8: Demo teacher content

Board: `python3 .claude/skills/board/board.py show 1.8` · Milestone M1 · deps: 0.3, M0 (both done) · branch `m1/1.8-demo-teacher` · risk: expert (named human reviewer sign-off; no risk-paths.txt glob matched — see Risky paths touched).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Demo teacher content (`content/demo-teacher/`): an open-licensed course with modules, notes, a question bank with answers, ≥ 30 rubric-scored student answers, a style card, a common-mistakes list, a Q&A recall set and two packages"
Accept: "`edmate content validate` passes; licence recorded per file; a named human reviewer signs off."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| `edmate content validate` exists and passes | `corepack pnpm --filter=@edmate/cli exec edmate content validate content/demo-teacher` exits 0 against the committed content; a deliberately broken fixture (missing licence entry, licence type outside the allowed list, <30 rubric answers, dangling module reference, style card >300 words, paid package not a superset of free) exits 1 and prints every issue found, not just the first. |
| Open-licensed course | `content/demo-teacher/course.yaml` plus `modules/<id>/notes.md` for 5 modules of "Python programming basics for beginners". |
| Question bank with answers | `content/demo-teacher/question-bank/*.yaml`, every question has a non-empty answer; validator rejects any without one. |
| ≥ 30 rubric-scored student answers | `content/demo-teacher/rubric-answers/*.yaml`, summed entries ≥ 30, each with a score, max score and rubric notes; validator counts and fails under 30. |
| Style card | `content/demo-teacher/style-card.yaml`, ≤ 300 words (enforced by the existing frozen `StyleCardSchema` refine, reused not re-implemented). |
| Common-mistakes list | `content/demo-teacher/common-mistakes.yaml`; style card's `mistakeTags` must be a subset of it (validator rule). |
| Q&A recall set | `content/demo-teacher/qa-recall.yaml`, each item tied to a real module id (for 5.3's later recall@5 eval). |
| Two packages | `content/demo-teacher/packages/free.yaml` and `paid.yaml`; validator enforces paid ⊋ free on `moduleIds` and `skills` (lead decision: "paid package with extra modules and skills"). |
| Licence per file | `content/demo-teacher/licences.yaml` manifest has one entry per content file (path, licence type restricted to `CC-BY-4.0 \| CC-BY-SA-4.0 \| CC0-1.0 \| public-domain`, `source_url` when adapted, `reviewed_by`); validator fails on any content file with no entry or a disallowed licence type (catches NC/ND by construction). |
| Named human reviewer | `licences.yaml`'s top-level `reviewed_by` default names the repo owner (lead decision: sign-off is the repo owner, after the merge-ready review); the manifest field holds a name/handle only, never an email or other contact detail. Sign-off itself is a human action on the PR, not something the validator can check — recorded in the handoff as a manual step, matching board risk `expert`. |
| Gates | `corepack pnpm turbo run typecheck lint test --filter=@edmate/content... --filter=@edmate/cli...` green; `packages/contracts/**` untouched (only imported from, via its public exports). |

## Design

### Where this sits
- No `Module`, `Course` or `QuestionBank` type exists in `packages/contracts` (checked § Core contracts and every file under `packages/contracts/src`) — the course/content shapes are **not frozen contracts**. Only `StyleCard` and `PackageConfig` are frozen, so the content's `style-card.yaml` and `packages/*.yaml` are typed as **drafts**: `StyleCardSchema.omit({ id: true, teacherId: true, version: true })` and `PackageConfigSchema.omit({ id: true, version: true, teacherId: true, agentId: true })` from `@edmate/contracts`. This reuses the frozen shapes (so 1.5's seed can add the omitted ids/versions with no drift) without needing an ADR — nothing in `packages/contracts` changes.
- New package `packages/content` (code; mirrors `packages/evals`'s role for `evals/suites/`) owns: schemas for the non-frozen shapes, a loader, cross-file content rules, and `validateContentDir()`. `apps/cli` adds a thin `content validate` command, matching how `edmate eval` wraps `packages/evals`.
- `packages/harness` purity (rule 3) does not apply here — `packages/content` is not `packages/harness`. It may use `js-yaml` (already a repo dependency via `packages/evals`) and Node's `fs`/`path`. It must not import `@edmate/harness`.
- `edmate content validate [dir]` is designed to be reused, not just built for this task: it dispatches on what it finds in `<dir>` (a `course.yaml` → this task's rules). Task 3.10 ("`edmate content validate` fails on missing fields" for locale packs) adds a second branch for `content/locales/**` later without changing this task's code — noted so 1.8 doesn't box in 3.10.

### Content layout (`content/demo-teacher/`)
```
content/demo-teacher/
  course.yaml                 # { id, title, description, modules: [{ id, title }] }
  modules/<module-id>/notes.md
  question-bank/<module-id>.yaml     # [{ id, moduleId, question, answer }]
  rubric-answers/<module-id>.yaml    # [{ id, moduleId, questionId, studentAnswer, score, maxScore, rubricNotes }]
  style-card.yaml              # StyleCardSchema minus id/teacherId/version
  common-mistakes.yaml         # [{ tag, description }]
  qa-recall.yaml               # [{ id, moduleId, question, expectedModuleId }]
  packages/free.yaml           # PackageConfigSchema draft
  packages/paid.yaml           # PackageConfigSchema draft
  licences.yaml                # { reviewed_by, entries: [{ path, licence, source_url?, attribution?, reviewed_by? }] }
```
`course.yaml`'s `modules[].id` and every `moduleId` elsewhere use the same `id()` format already frozen in `packages/contracts/src/formats.ts` (letters, digits, `_`, `-`, ≤128 chars) so 1.5's seed can use them directly as `PackageConfig.moduleIds` / `Chunk.moduleId` with no translation step.

### Content rules (`packages/content/src/rules.ts`, beyond per-file Zod shape)
1. **Licence coverage**: every file under `content/demo-teacher/` except `licences.yaml` itself has exactly one entry in it.
2. **Licence type allow-list**: `CC-BY-4.0 | CC-BY-SA-4.0 | CC0-1.0 | public-domain` only (NC/ND variants rejected by the enum, not a string check — fails closed on an unknown value too).
3. **Reviewer present**: every entry resolves a non-empty `reviewed_by` (its own, or the manifest's top-level default).
4. **Rubric count**: total entries across `rubric-answers/*.yaml` ≥ 30.
5. **Question bank answers**: every question bank item has a non-empty `answer`.
6. **No dangling references**: every `moduleId` in question-bank, rubric-answers and qa-recall items, and every `moduleIds` entry in the two packages, exists in `course.yaml`.
7. **Style card mistake tags ⊆ common-mistakes tags**.
8. **Paid ⊋ free**: paid package's `moduleIds` is a strict superset of free's, and paid's `skills` is a superset with at least one extra skill (lead decision: "extra modules and skills").

`validateContentDir(dir)` returns `{ ok: boolean; issues: string[] }` (collects every issue, not just the first — more useful to a content author than the fail-fast-per-file pattern `packages/evals/src/loader.ts` uses for YAML/schema errors, which this task keeps for file-level parse errors only).

### CLI (`apps/cli`)
```
edmate content validate [dir]

Validates content under <dir> (default: content/demo-teacher) against its schemas
and content rules (licence coverage, reviewer, counts, references). Exits 1 and
prints every issue found if any file or rule fails.
```
Adds a `content` branch to `cli.ts` dispatching to `commands/content.ts`'s `runContentCommand`, mirroring `commands/eval.ts`'s `runEvalCommand` shape (`(args, io, deps)`); `deps.cwd` resolves the default/relative dir, no network or DB access.

## Files

### Create
- `packages/content/package.json`, `tsconfig.json`, `vitest.config.ts` (mirrors `packages/evals`)
- `packages/content/src/schema.ts`, `schema.test.ts` — `CourseSchema`, `LicenceEntrySchema`, `LicenceManifestSchema`, `QuestionBankItemSchema`, `RubricAnswerSchema`, `CommonMistakeSchema`, `QaRecallItemSchema`, `StyleCardDraftSchema`, `PackageDraftSchema`
- `packages/content/src/loader.ts`, `loader.test.ts` — `loadDemoTeacherContent(dir)`, throws a `ContentLoadError(filePath, detail)` per bad file (same pattern as `packages/evals/src/loader.ts`'s `CaseLoadError`)
- `packages/content/src/rules.ts`, `rules.test.ts` — the 8 cross-file rules above, one function each, composed by `validate.ts`
- `packages/content/src/validate.ts`, `validate.test.ts` — `validateContentDir(dir): { ok, issues }`
- `packages/content/src/index.ts` — barrel
- `packages/content/test/fixtures/valid/**` — a minimal but complete valid tree (2 modules, a few question-bank items, 30 rubric answers, both packages, a covering `licences.yaml`)
- `packages/content/test/fixtures/broken-*/**` — one fixture tree per rule violation (missing licence entry, `NC` licence type, 29 rubric answers, dangling `moduleId`, style card over 300 words, paid not a superset)
- `apps/cli/src/commands/content.ts`, `content.test.ts`
- `content/demo-teacher/**` (the real content, see below)
- `docs/tasks/1.8/handoff.md` (builder), `docs/tasks/1.8/review.md` (reviewers — no reviewer group required by risk-paths.txt, but the human reviewer's sign-off is recorded here per board risk `expert`)

### Modify
- `apps/cli/src/cli.ts` — add the `content` case; update `USAGE`
- `apps/cli/src/cli.test.ts` — route + usage-text coverage for the new subcommand
- `apps/cli/package.json` — add `@edmate/content` dependency
- `content/demo-teacher/.gitkeep` — removed once real files land

### Out of bounds
- `packages/contracts/**` — no contracts change; only importing/omitting from existing exports.
- `content/locales/**`, `content/prompt-packs/**`, `content/skills/**` — other tasks (3.10, 3.11), and in the safety-reviewer risk group; untouched here.
- Seeding the demo teacher into the database (`1.5`) — this task produces files only, no DB rows.
- `3.9` (CLI chat) and `7.3` (per-agent suite generator) — later consumers; this task does not build or guess their code, only content their later tasks will read.
- `5.7` (feedback skill) — this task's ≥30 rubric answers are the fixture data 5.7 will later be graded against; this task does not implement the feedback skill or its ≥70% agreement check.

## Tests first (Vitest, red before green — tdd-guide)

1. `schema.test.ts` — each schema's required fields; `LicenceEntrySchema`'s `licence` enum rejects `CC-BY-NC-4.0` and `CC-BY-ND-4.0`; `StyleCardDraftSchema`/`PackageDraftSchema` reject `id`/`teacherId`/`version`/`agentId` (still `strictObject` after `.omit`).
2. `loader.test.ts` — loads the valid fixture tree into a structured object; each `broken-*` fixture that is a parse-level problem (malformed YAML, schema-invalid file) throws `ContentLoadError` naming the file.
3. `rules.test.ts` — one test per rule against the valid fixture (passes) and its matching `broken-*` fixture (fails with a specific, identifiable issue string).
4. `validate.test.ts` — the valid fixture returns `{ ok: true, issues: [] }`; each broken fixture returns `{ ok: false, issues: [...] }` containing the expected issue, and running two broken fixtures' issues together (a combined tree) surfaces both, proving issues are collected, not fail-fast.
5. `apps/cli/src/commands/content.test.ts` — exit 0 on the valid fixture dir; exit 1 with every issue printed on a broken one; default dir resolves to `content/demo-teacher` relative to `cwd` when no argument is given.
6. `apps/cli/src/cli.test.ts` — `edmate content validate` routes correctly; `--help`/usage text includes it.

Implementation order: `schema.ts` → `loader.ts` → `rules.ts` → `validate.ts` → `index.ts` → `apps/cli` command → `cli.ts`. Only once this is green does `pedagogy-author` write `content/demo-teacher/**`; the builder then runs `edmate content validate content/demo-teacher` and fixes structure (file paths, licence entries, reference ids) — not the pedagogical content itself.

### Content substance (pedagogy-author, no shell — writes files only)
Subject: Python programming basics for beginners (teen/adult self-learners), 5 modules, e.g. Variables & Types, Control Flow, Functions, Lists & Loops, Error Handling. Guidance:
- Adapted explanatory notes may cite a real CC BY-SA 4.0 source (e.g. "A Byte of Python" by Swaroop C H, which is CC BY-SA 4.0 — **not** "Think Python"/"Python for Everybody", which are CC BY-NC and therefore excluded by the lead's licence decision); record `licence: CC-BY-SA-4.0`, `source_url`, `attribution` per file.
- Originally authored material (question bank, rubric answers, qa-recall, common-mistakes, style card) is Edmate demo data, not sourced from a third party; record `licence: CC0-1.0` for these unless the lead prefers otherwise (open question Q1).
- Rubric answers: a simple `{ score, maxScore, rubricNotes }` shape (not a frozen contract — can evolve before 5.7 needs more).

Commands: `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/content... --filter=@edmate/cli...`.

## Risky paths touched

Checked every planned path (including new `packages/content/**` and `content/demo-teacher/**`) against `.claude/skills/merge-gate/risk-paths.txt`:
- `content/demo-teacher/**` — not listed (only `content/prompt-packs/**`, `content/skills/**`, `content/locales/**` are, under `safety-reviewer`); untouched groups confirmed.
- `packages/content/**`, `apps/cli/**` — not listed under any group.
- `packages/contracts/**`, `docs/adr/**` — untouched (imported from only, no edits).
- `packages/harness/src/guardrails/**`, `packages/harness/src/access/**`, `packages/payments/**`, `apps/web/app/api/webhooks/**`, `apps/web/src/auth/**`, `packages/gateway/src/keys/**`, `packages/db/src/repositories/**` — untouched.
- `.claude/**`, `.github/**`, `.githooks/**` — untouched.

**None (checked against risk-paths.txt).** No `risk: high` decision entry is planned. Board risk `expert` (named human reviewer) is satisfied by the repo owner's sign-off on the PR, recorded in the handoff — not a merge-gate reviewer-group requirement.

## Decisions (to copy into the handoff `## Decisions`)

- **1.8 Content shapes not added to `packages/contracts`** · planner · risk: low. Why: no `Module`/`Course`/`QuestionBank` type exists in Core contracts; adding one needs an ADR for shapes nothing outside content authoring consumes yet. `style-card.yaml`/`packages/*.yaml` instead reuse `StyleCardSchema`/`PackageConfigSchema` via `.omit()` so 1.5's seed can't drift from the frozen shape. Reversible: yes, by ADR if 5.11 (outline/style-card drafter) later needs a shared type.
- **1.8 `edmate content validate` lands in a new `packages/content`, used by `apps/cli`** · planner · risk: low. Why: mirrors `packages/evals`'s existing split from `apps/cli`'s `eval` command; keeps 3.10's later locale-pack validation addable without touching `apps/cli`'s command wiring, only `packages/content`.
- **1.8 Validator collects every issue instead of failing on the first** · planner · risk: low. Why: a content author fixing licences/counts benefits from seeing all problems at once; file-level parse errors (bad YAML) still fail fast per file, matching `packages/evals`'s existing convention for that narrower case.

## Open questions (lead can decide; none blocks the build)

- **Q1. Licence for originally-authored demo content (question bank, rubric answers, qa-recall, common-mistakes, style card).** Recommendation: `CC0-1.0` (public-domain dedication), since it's Edmate's own demo data, not a real teacher's content under the PRD's "teachers own their content" rule, and CC0 is explicitly on the lead's allowed list.
- **Q2. Rubric answer shape for the ≥30 samples.** Recommendation: `{ score: number (0-10), maxScore: 10, rubricNotes: string }` — simple, not a frozen contract, easy for 5.7 to extend once the feedback skill's real rubric structure is known.
- **Q3. Should the validator's paid-⊋-free rule be a hard failure or a warning?** Recommendation: hard failure — the lead's decision explicitly says the paid package has "extra modules and skills", so the demo content should actually demonstrate that, not just be allowed to.

None of these are open items in `docs/board/tasks.yaml`'s `decisions:` block; the planner is prepared to proceed with the recommendations above if the lead doesn't weigh in.

## Lead answers (18 Oct 2026)

- Q1: CC0-1.0 for originally authored demo content; third-party material only under CC BY, CC BY-SA, CC0 or public domain, with source URL and licence per file in licences.yaml.
- Q2: `{score, maxScore, rubricNotes}`.
- Q3: hard failure.
- Order: tdd-guide builds packages/content + `edmate content validate` first (tests with tiny fixtures), pushes the branch; then the lead starts pedagogy-author on the same worktree for content/demo-teacher/**; then the builder runs validate and fixes structure only.
- `reviewed_by`: the repo owner (the human), recorded after their sign-off on the PR.
