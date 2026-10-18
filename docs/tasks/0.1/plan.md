# Task 0.1 — Monorepo scaffold

Board: `python3 .claude/skills/board/board.py show 0.1` · Milestone M0 · deps: none · branch: `m0/0.1-monorepo-scaffold`

## Acceptance (verbatim, from `docs/board/tasks.yaml` / build plan §Milestones M0)

Title: "Monorepo scaffold: pnpm, Turborepo, strict tsconfig, eslint (with the harness purity rule from
rule 3), prettier, Vitest; every directory in Repo layout: `apps/web` (Next.js with `/api/health`),
`apps/worker` (BullMQ no-op worker), `apps/cli` (`edmate --version`), all `packages/*` as empty
workspaces."

Accept: "`corepack pnpm build && corepack pnpm test && corepack pnpm lint` green; `/api/health`
returns 200 in dev; importing `drizzle-orm` from `packages/harness` fails lint."

### How each item is shown in the PR

- `corepack pnpm build && corepack pnpm test && corepack pnpm lint` — paste the three command
  outputs (green) in the PR description, run via `source ~/.nvm/nvm.sh && corepack pnpm build &&
  corepack pnpm test && corepack pnpm lint`. CI (task 0.5) will re-run this later; for 0.1 it's a
  manual paste since GitHub Actions doesn't exist yet.
- `/api/health` returns 200 in dev — paste `curl -i localhost:3000/api/health` output after
  `corepack pnpm --filter web dev` in the PR description, plus the unit test in
  `apps/web/app/api/health/route.test.ts` that calls the handler directly (see Tests first).
- Importing `drizzle-orm` from `packages/harness` fails lint — the vitest suite in
  `packages/config/eslint/__tests__/harness-purity.test.ts` lints a *virtual* file (never a real
  committed file) at `packages/harness/src/fake.ts` containing `import { drizzle } from
  'drizzle-orm'` and asserts ESLint reports an error; also paste one manual
  `corepack pnpm lint --filter harness` run against a throwaway local edit (added then reverted,
  not committed) in the PR description.

## Scope note: `packages/contracts` here is an empty shell, not the contracts

Build plan §Core contracts: "Task 0.3 creates them [the Zod schemas]; changing one afterwards
needs an ADR." Task 0.1 only needs `packages/contracts` to exist as a workspace so the
dependency graph resolves. This task puts **only**:
- `packages/contracts/package.json` (name `@edmate/contracts`, no runtime deps yet)
- `packages/contracts/tsconfig.json` (extends the shared strict base)
- `packages/contracts/src/index.ts` — `export {};` placeholder, zero types, zero schemas

No Zod schema, no `z.infer` type, no fixture goes in this PR. This is explicitly *not* a contract
change under rule 2 (nothing is defined yet to change), but because the path is listed in
`.claude/skills/merge-gate/risk-paths.txt` (`packages/contracts/**`), the PR still needs the
human's `human-approved` label before merge, and `.claude/hooks/check-edit.sh` will `ask` the
build agent before writing into that path — expected, not a blocker. The PR description must say
in one line that this is scaffold-only so the reviewer doesn't mistake it for 0.3's work.

## Harness purity rule — implementation and test

Rule 3 (frozen, non-negotiable #3): `packages/harness` may import only `@edmate/contracts`, `zod`,
`mathjs` and its own (relative) modules. This must fail `pnpm lint` in CI, independent of the
Claude Code `PostToolUse` hook (`.claude/hooks/check-edit.sh`), which only fires for Claude's own
edits and uses a deny-list regex — not sufficient for the acceptance criterion, which must hold for
any PR, agent-written or not.

- **Rule shape:** allow-list, not deny-list, so an SDK nobody has thought of yet still fails
  closed. A deny-list (like the existing hook's regex) only catches packages already named.
- **Where it lives:** a small local ESLint rule, `packages/config/eslint/rules/harness-purity.js`
  (plain JS, no new npm dependency), registered as a local plugin in
  `packages/config/eslint/harness.js` — the flat-config preset that
  `packages/harness/eslint.config.js` extends. Other packages extend
  `packages/config/eslint/base.js` instead, which does not include this rule.
- **Rule logic:** on `ImportDeclaration` / `ImportExpression` / `require()` call, read the import
  source; allow if it matches `^zod($|/)`, `^mathjs$`, `^@edmate/contracts($|/)`, or `^\.`
  (relative); allow `^node:` built-ins (see Decisions — the literal spec text is silent on these);
  otherwise report `harness-purity/no-external-import`.
- **Test fixture, not a real file:** `packages/config/eslint/__tests__/harness-purity.test.ts` uses
  ESLint's `Linter` API (`lintText` with a virtual `filename` of
  `packages/harness/src/fake.ts`) so the violating import is never committed inside
  `packages/harness` itself (which would itself be a purity violation sitting in the repo). Cases:
  1. `import { drizzle } from 'drizzle-orm'` at `packages/harness/src/fake.ts` → 1+ error, ruleId
     `harness-purity/no-external-import`.
  2. `import { z } from 'zod'; import * as math from 'mathjs'; import type { Usage } from
     '@edmate/contracts'; import { helper } from './helper';` at the same virtual path → 0 errors.
  3. Same `drizzle-orm` import at `packages/gateway/src/fake.ts` → 0 errors from this rule (scoped
     to `packages/harness` only; `gateway` is allowed to import adapters).

## Files to create

```
package.json                          # root workspace: scripts build/test/lint/typecheck via turbo
pnpm-workspace.yaml
turbo.json
tsconfig.base.json                    # strict, noUncheckedIndexedAccess
.nvmrc                                # 22
.prettierrc
.prettierignore
.eslintignore                         # if needed under the chosen eslint version
README.md                             # dev commands (rule 10: keep docs current)
packages/config/package.json
packages/config/tsconfig/base.json
packages/config/eslint/base.js
packages/config/eslint/harness.js
packages/config/eslint/rules/harness-purity.js
packages/config/eslint/__tests__/harness-purity.test.ts
packages/config/prettier/index.js

apps/web/package.json
apps/web/tsconfig.json
apps/web/next.config.ts
apps/web/eslint.config.js             # extends packages/config/eslint/base.js
apps/web/app/layout.tsx               # minimal
apps/web/app/page.tsx                 # minimal placeholder
apps/web/app/api/health/route.ts      # GET -> 200 { status: 'ok' }
apps/web/app/api/health/route.test.ts

apps/worker/package.json
apps/worker/tsconfig.json
apps/worker/eslint.config.js
apps/worker/src/worker.ts             # no-op BullMQ Worker, connection injected not opened at import
apps/worker/src/worker.test.ts
apps/worker/src/index.ts              # entrypoint: creates real connection, calls worker.ts factory

apps/cli/package.json
apps/cli/tsconfig.json
apps/cli/eslint.config.js
apps/cli/src/cli.ts                   # run(argv): handles --version
apps/cli/src/cli.test.ts
apps/cli/bin/edmate                   # shebang wrapper -> dist/cli.js (post-build)

packages/contracts/{package.json,tsconfig.json,src/index.ts}      # empty shell, see above
packages/harness/{package.json,tsconfig.json,eslint.config.js}
packages/harness/src/{pipeline,access,pedagogy,skills,roleplay,tools,guardrails,memory}/.gitkeep
packages/harness/src/index.ts         # export {}; placeholder
packages/gateway/{package.json,tsconfig.json,src/index.ts}
packages/ingest/{package.json,tsconfig.json,src/index.ts}
packages/payments/{package.json,tsconfig.json,src/index.ts}
packages/db/{package.json,tsconfig.json,src/index.ts}
packages/evals/{package.json,tsconfig.json,src/index.ts}
packages/ui/{package.json,tsconfig.json,src/index.ts}

content/prompt-packs/.gitkeep
content/skills/.gitkeep
content/locales/.gitkeep
content/demo-teacher/.gitkeep
evals/suites/{leak,locked,safety,accuracy,persona,pedagogy,advice}/.gitkeep
evals/fixtures/.gitkeep
docs/adr/.gitkeep
docker/.gitkeep
```

All `.gitkeep`/directory-only entries and every `packages/<x>/src/index.ts` placeholder stay
content-free — later tasks (0.2 Compose, 0.3 contracts, 0.4 ADRs, M1–M10 package logic) fill them
in. No build-plan prose, prompt-pack text or ADR content gets written here.

## Files to modify

- `.gitignore` — add `node_modules`, `.turbo`, `dist`, `.next`, `coverage` if not already present.

## Files out of bounds (belong to other tasks)

- `packages/contracts/src/*` beyond the empty placeholder, `packages/contracts/fixtures/**` (0.3).
- `docker/compose.yaml`, `docker/Caddyfile`, `docker/env.example`, real Compose content (0.2).
- `docs/adr/0001-*.md` etc. content (0.4) — only the directory exists after 0.1.
- `.github/**` workflows, PR template, risk labeller (0.5).
- `.devcontainer/**` (0.6).
- Any Drizzle schema, migration, repository (M1); gateway adapters (M2); harness pipeline logic,
  access filter, pedagogy, skills, guardrails, memory implementations (M3–M6); eval suite cases,
  content/prompt-packs text, content/locales data, content/demo-teacher material (M5/M7 and
  pedagogy/eval-author tasks).
- `.claude/**`, `.github/**` config itself — not touched by this task.
- `docs/board/tasks.yaml` status field and `docs/decisions/log.md` — updated by the team lead at
  merge, not by this task's PR.

## Tests first (write before implementation, per `tdd-workflow`)

1. `packages/config/eslint/__tests__/harness-purity.test.ts` — the three cases above (fails until
   the rule exists).
2. `apps/web/app/api/health/route.test.ts` — import `{ GET }` from `./route`, call it directly,
   assert status 200 and a JSON body; no real server needed for this test (the dev-server curl is
   separate, manual evidence for the "200 in dev" criterion).
3. `apps/worker/src/worker.test.ts` — construct the worker with an injected fake connection object
   (no real Redis socket opened — rule 4: no real external calls in tests); assert it builds
   without throwing and exposes a `close()`/no-op `process` that does nothing.
4. `apps/cli/src/cli.test.ts` — call the exported `run(['--version'])` and assert stdout equals the
   version in `apps/cli/package.json`, before `cli.ts` exists.

`packages/*` empty-shell workspaces (contracts, gateway, ingest, payments, db, evals, ui) get no
dedicated tests in this task — they have no logic yet. Turborepo's `test`/`lint` tasks must be
configured so a package without that script is skipped, not failed (confirm this is still true for
the pinned Turborepo version before relying on it).

## Risky paths touched

- `packages/contracts/**` (frozen path, `risk-paths.txt` line 21) — empty shell only, as described
  above. Needs the human's `human-approved` label before the team lead merges (rule 6); the
  `check-edit.sh` hook will `ask` on each write into this path during build, which is expected.

No other path in `.claude/skills/merge-gate/risk-paths.txt` is touched: `.claude/**`/`.github/**`
config, guardrails, access filter, payments, webhooks, auth, db repositories and ADRs are all out
of scope for 0.1 (see Files out of bounds).

## Decisions for the task handoff (spec silent, team lead/build agent decides and logs — not a
human blocker)

1. Exact tool versions: the build plan pins the *stack* (Node 22 LTS, pnpm workspaces + Turborepo,
   TypeScript strict, Next.js "current major", Vitest) but not patch/minor versions or
   config-file style. Decision: pin via `package.json#packageManager` (`pnpm@<latest-stable>`) and
   `engines.node = "22.x"`; use ESLint flat config (current major at implementation time); pick the
   latest stable Next.js major, Turborepo major and Vitest major compatible with Node 22 at
   install time. Record the exact versions chosen in the handoff.
2. `node:` built-in modules (e.g. `node:crypto`) are not literally on rule 3's list
   ("contracts, zod, mathjs and its own modules"). Decision: allow `node:`-prefixed built-ins in
   the purity rule — rule 3's intent (per its own wording: "everything else goes through ports")
   targets frameworks, DB, queue and provider SDKs, not language runtime primitives. Flag this
   reading in the handoff so the architect can override it before M3 harness-core code leans on
   it.
3. `apps/cli` ships a `bin/edmate` wrapper pointing at a build output (`dist/cli.js`), so
   `edmate --version` only works after `pnpm build` — consistent with the acceptance command order
   (`build && test && lint`). No dev-mode (`tsx`) entrypoint is added in this task.
4. `apps/web` gets no Tailwind/shadcn/next-intl wiring in this task — those are stack choices for
   later UI-bearing tasks; 0.1's web scope is strictly `/api/health` plus the minimal layout/page
   Next.js needs to build.

## Open questions for the human

None. This task is a scaffold with no contract content, no safety/access/payments logic and no
spec ambiguity; the only risky path touched (`packages/contracts/**`) is an explicitly-sanctioned
empty shell per the build plan's own task ordering (0.1 before 0.3), handled by the existing
human-approved-label process rather than a planning block.

## Verdict

READY.

## Team lead amendments (17 Oct 2026, decided by the human) — these override the sections above

1. **No placeholders in risky or safety paths.** Do NOT create `packages/harness/src/access/`,
   `packages/harness/src/guardrails/`, `content/prompt-packs/`, `content/skills/`,
   `content/locales/`, `evals/suites/safety/`, `evals/suites/locked/` or `docs/adr/`. The task that
   fills each one creates it. Create the other layout folders as planned, and list the full Repo
   layout (marking which folders later tasks create) in `README.md`. The only risky path this task
   touches is the empty `packages/contracts` shell. Copy this into the handoff's `## Decisions`
   (decided by the human, risk: low).
2. **Purity rule is strict: `node:` built-ins are NOT allowed** in `packages/harness` (rule 3 to the
   letter; keeps the harness runtime-neutral). Add a test case: `import { randomUUID } from
   'node:crypto'` at `packages/harness/src/fake.ts` → error. Bare built-ins (`fs`, `crypto`) also
   fail. Replace planner Decision 2 with this in the handoff (decided by the human, risk: low).
3. `.eslintignore` is not used by ESLint flat config; use `ignores` in the config instead.
4. Don't modify `.gitignore` unless something is actually missing (it already lists
   node_modules, .turbo, dist, .next, coverage).
