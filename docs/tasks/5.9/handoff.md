# 5.9 · Revision skill — handoff

Status: DONE

## Files
- `evals/suites/revision/revision-values-variables-notes.yaml` (new)
- `evals/suites/revision/revision-conditions-notes.yaml` (new)
- `evals/suites/revision/revision-loops-notes.yaml` (new)
- `evals/suites/revision/revision-functions-notes.yaml` (new)
- `evals/suites/revision/revision-lists-dicts-notes.yaml` (new)
- `evals/suites/revision/revision-values-variables-flashcards.yaml` (new)
- `evals/suites/revision/revision-loops-flashcards.yaml` (new)
- `evals/suites/revision/revision-uncited-bad-en.yaml` (new)
- `evals/suites/revision/revision-locked-module-bad-en.yaml` (new)
- `evals/suites/revision/revision-empty-material-en.yaml` (new)
- `packages/evals/src/revisionFixtures.test.ts` (new)

No prompt-pack, pedagogy or contracts files touched (all reused unchanged, per plan).

## Tests
`corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...` — green, 14/14 tasks
successful, 952 tests passed (18 test files), including:
- `src/revisionFixtures.test.ts` (17 tests): loads all 10 cases (suite `revision`, package `paid`,
  `reviewed_by: lead`); `decidePolicy` routes a covered revision turn to `move: 'explain'`,
  `skill: 'revision'`, and routes the empty-material case to `ask_teacher` (never inventing
  notes); `composeSystemPrompt`, built against the real, already-signed
  `content/prompt-packs/set@1.1.0.yaml`, renders `revision@1.0.0`'s "source [n] on every point or
  card" clause and `move-explain`'s "citing [n]" line; every retrieved section is allowed by
  `paid.yaml`'s entitlement; the UNGUARDED bad stub fails each case's own checks while the good
  stub passes; the material block lists exactly the covered chunks, numbered; the mutation case
  (a chunk from an out-of-package module injected into `ctx.retrieved`) makes `composeSystemPrompt`
  throw `LockedMaterialError`.
- `src/suites.test.ts` (26 tests): unaffected, still green (the `revision` folder is not a guard
  folder, so no minimum-case rule applies; naming/package/reviewer rules all pass).

`python3 .githooks/secret-scan.py --all` — clean (no output, no findings).

## Decisions

### 21 Oct 2026 · 5.9 cases use the real prompt-pack set, parsed locally in the test · decided by tdd-guide · risk: low
- Decided: `revisionFixtures.test.ts` reads `content/prompt-packs/set@1.1.0.yaml` and its pinned
  pack files directly (front-matter + body, the same layout `@edmate/content`'s loader reads) and
  calls the harness's own exported `parsePromptPackSet`, instead of using the harness's synthetic
  `fixturePromptPackSet` (which only carries placeholder marker text, e.g. "[[SKILL:revision]]
  Fixture revision pack", not the real "source [n] on every point or card" wording) or adding a new
  `packages/evals` dependency on `@edmate/content` (out of scope: the plan's files-to-modify list
  names no `package.json` change).
- Why: the plan's acceptance proof requires showing the composer renders the real, human-signed
  `revision@1.0.0` and `frame@1.0.0` (`move-explain`) text verbatim, which the fixture set cannot
  demonstrate. Re-parsing the already-reviewed files locally keeps `packages/evals`'s dependency
  graph unchanged (only `node:fs`, `@edmate/contracts`, `@edmate/harness`, `js-yaml`, all already
  depended on) and touches no file under `content/prompt-packs/**` or `packages/content/**`.
- risk: low — test-only, reversible, no runtime or production code path affected.

### 21 Oct 2026 · the empty-material case asserts `ask_teacher`, not an invented revision reply · decided by tdd-guide · risk: low
- Decided: `revision-empty-material-en` is built with zero retrieved chunks; the test asserts
  `decidePolicy` sends it to `move: 'ask_teacher'` (via the existing `coverageGate`, already built
  in 4.7/5.4, never new code), and the case's own checks (`must_not_contain: ["[1]", "classes are
  blueprints"]`) catch a stubbed bad reply that fabricates a citation and content anyway.
- Why: the revision skill has no special "nothing to revise yet" branch of its own; it inherits the
  platform's coverage gate like every other skill, so the honest way to show "it never invents
  notes with nothing covered" is to exercise the real gate, not to special-case the test around a
  made-up `revision`-only empty-state contract.
- risk: low — test-only; exercises already-built, unchanged pedagogy code (`coverage.ts`).
