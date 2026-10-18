# 0.1 handoff: Monorepo scaffold

- **Status:** DONE
- **Branch:** `m0/0.1-monorepo-scaffold`
- **Worktree:** `.claude/worktrees/agent-a6853eae80d608676`
- **Risky path touched:** `packages/contracts/**`. It is an empty shell only (`export {};`, no schemas, no types, no fixtures). This is scaffold work, not task 0.3. The PR needs the human's `human-approved` label.

## Tool versions chosen

| Tool | Version | Note |
|---|---|---|
| Node | 22.x (`.nvmrc` 22, `engines.node` 22.x; ran on 22.22.3) | |
| pnpm | 12.14.0 (`packageManager`, also a root devDependency) | see Decisions |
| Turborepo | 2.11.9 | |
| TypeScript | 6.0.3 | 7.0.2 is out, but typescript-eslint 8.71 supports only `<6.1` |
| ESLint | 10.13.0 (flat config), `@eslint/js` 10.0.1, typescript-eslint 8.71.2, globals 17.13.0 | |
| Prettier | 3.9.10 | |
| Vitest | 5.0.5 with `@vitest/coverage-v8` 5.0.5 | |
| Next.js | 16.4.2, React / React DOM 19.3.1 | |
| BullMQ | 6.3.16, ioredis 6.0.0 | |
| @types/node | 22.20.5 | |

## Acceptance evidence

`corepack pnpm build && corepack pnpm test && corepack pnpm lint`: green. I ran it uncached with `--force`, using Node 22.22.3 from nvm.

```text
$ corepack pnpm install --frozen-lockfile
Done in 36ms using pnpm v12.14.0
$ corepack pnpm build --force
 Tasks:    10 successful, 10 total
Cached:    0 cached, 10 total
@edmate/web:build: └ ƒ /api/health
$ corepack pnpm test --force
@edmate/cli:test:      Tests  7 passed (7)
@edmate/web:test:      Tests  2 passed (2)
@edmate/worker:test:   Tests  3 passed (3)
@edmate/config:test:   Tests  26 passed (26)
 Tasks:    5 successful, 5 total
$ corepack pnpm lint --force
 Tasks:    12 successful, 12 total
$ corepack pnpm typecheck --force
 Tasks:    12 successful, 12 total
$ corepack pnpm format:check
All matched files use Prettier code style!
```

Coverage (v8):
- `packages/config/eslint/rules/harness-purity.js`: 100% of statements, branches, functions and lines. The threshold is set to 100%.
- `apps/cli/src/cli.ts`: 100%.
- `apps/worker/src/worker.ts`: 100%.
- `apps/web/app/api/health/route.ts`: 100%.

Workspaces without a `test` script are skipped by Turborepo, not failed. I checked this on Turborepo 2.11.9.

`/api/health` returns 200 in dev. Port 3000 was taken by an unrelated local process, so I used 3100. The server was stopped afterwards.

```text
$ corepack pnpm --filter @edmate/web dev --port 3100   (background)
$ curl -i localhost:3100/api/health
HTTP/1.1 200 OK
cache-control: no-store
content-type: application/json

{"status":"ok"}
```

Unit test: `apps/web/app/api/health/route.test.ts` calls `GET()` directly. It checks for status 200, a JSON body `{status:'ok'}` and `no-store`.

Importing `drizzle-orm` from `packages/harness` fails lint:
- The test `packages/config/eslint/__tests__/harness-purity.test.ts` lints virtual text at `packages/harness/src/fake.ts`.
- I also ran one manual check. The input file was in the session scratchpad and was never written into the repo:

```text
$ cd packages/harness && eslint --stdin --stdin-filename src/fake.ts < <scratchpad>/fake-harness-import.ts
packages/harness/src/fake.ts
  1:25  error  packages/harness may not import 'drizzle-orm': only @edmate/contracts, zod, mathjs and its own modules are allowed (build plan rule 3). ...  harness-purity/no-external-import
  2:28  error  packages/harness may not import 'node:crypto': ...  harness-purity/no-external-import
✖ 2 problems (2 errors, 0 warnings)
exit=1
```

Fix round 1 (code-reviewer LOW, `harness-purity.js` require check): the rule now flags every other use of the global `require`, not only direct calls. That covers an alias (`const r = require`), `module.require`, `module['require']`, `globalThis.require`, `typeof require` and passing `require` as a value. A local variable or parameter named `require` is not flagged (scope analysis). Results: `corepack pnpm turbo run lint test --filter=@edmate/config... --filter=@edmate/harness...` → 5/5 tasks, 34 tests passed, rule coverage still 100%; secret scan clean.

```text
$ apps/cli/bin/edmate --version
0.0.0
$ python3 .githooks/secret-scan.py --all
(no findings, exit 0)
```

## Changes

- **Root:**
  - `package.json`: turbo scripts for build, test, lint, typecheck and format.
  - `pnpm-workspace.yaml`, with an `allowBuilds` policy.
  - `turbo.json`, `tsconfig.base.json`, `.nvmrc`, `.prettierrc`, `.prettierignore`.
  - `eslint.config.js`: a fallback config for workspaces that don't have their own.
  - `README.md`: commands, the purity rule, and the full repo layout with *(later)* folders marked.
  - `.gitignore`: added `next-env.d.ts`.
- **`packages/config`:**
  - The strict tsconfig base, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
  - ESLint presets: `base.js`, and `harness.js` (base plus the purity rule).
  - The rule itself: `rules/harness-purity.js`.
  - The Prettier preset.
  - The purity test suite, with 26 cases.
- **`apps/web`:** Next.js 16 with `GET /api/health`, a minimal layout and page, and the route unit test.
- **`apps/worker`:**
  - `worker.ts`: `createNoopWorker(connection, {autorun})`, a real BullMQ `Worker` with `autorun: false` by default and nothing connecting at import.
  - `index.ts`: the entrypoint. It opens ioredis from `REDIS_URL` and shuts down cleanly on SIGINT/SIGTERM.
  - Tests use a fake Redis client that never opens a socket. They also check that BullMQ never calls `connect`.
- **`apps/cli`:** `run(argv, io)` handles `--version`, `-v`, `--help`, `-h`, no arguments, and unknown commands. `bin/edmate` points at `dist/cli.js`.
- **Empty workspaces:** `contracts`, `harness`, `gateway`, `ingest`, `db`, `evals` and `ui`. Each `src/index.ts` contains only `export {}`.
- **Harness folders:** `pipeline`, `pedagogy`, `skills`, `roleplay`, `tools` and `memory`.
- **Other layout folders:** `content/demo-teacher`, `evals/fixtures`, `evals/suites/{leak,accuracy,persona,pedagogy,advice}` and `docker`.

## Deviations from the plan

1. **`packages/payments` was not created.** It is a risky path (`risk-paths.txt`: `packages/payments/**`). Lead amendment 1 says there are no placeholders in risky paths, and that the only risky path this task touches is contracts. README lists payments as *(later)*. **The lead or human should confirm this**, because the acceptance text says "all `packages/*`".
2. **TypeScript is 6.0.3, not the newest major (7.0.2).** typescript-eslint has no TypeScript 7 support yet.
3. **Root additions the plan didn't list:**
   - A root `eslint.config.js` covers contracts, gateway and the other packages with no config of their own.
   - `pnpm` is a root devDependency. Turborepo needs a `pnpm` binary on PATH, and global installs are forbidden.
4. **The purity rule is stricter than the plan sketch, with two narrow exceptions** (see Decisions):
   - Stricter: relative imports must stay inside `packages/harness`. Non-literal `import()` and `require()` fail. Re-exports, `export *`, `import x = require()` and type-only imports are all checked.
   - Exceptions: `vitest` is allowed only in `*.test.*` and `*.spec.*` files. Tooling config files at the harness package root are exempt.
5. **`.gitignore` gains `next-env.d.ts`.** Next generates this file, and it imports `.next/types`, so committing it breaks typecheck on a clean checkout. This entry was genuinely missing (amendment 4).
6. **`next.config.ts` sets `agentRules: false`.** Without it, `next dev` writes an `AGENTS.md` into `apps/web` and keeps re-adding it.
7. **The dev-server evidence used port 3100**, because 3000 was in use by another process.

## Decisions

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by tdd-guide · risk: low
Decided: Pin pnpm 12.14.0, Turborepo 2.11.9, ESLint 10.13 (flat config), Vitest 5.0.5, Next.js 16.4.2, React 19.3.1, BullMQ 6.3.16 and Node 22.x. TypeScript is 6.0.3, not 7, because the ESLint TypeScript plugin doesn't support 7 yet.
Why: These are the newest stable versions that work together on Node 22.
Alternatives: TypeScript 7 without type-aware linting.
Reversible: Yes, by bumping versions.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by planner · risk: low
Decided: `edmate --version` runs from the built output (`bin/edmate` → `dist/cli.js`). There is no dev-mode entrypoint.
Why: It matches the acceptance order of build, then test, then lint, and adds no extra tooling.
Alternatives: A `tsx` dev entrypoint.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by planner · risk: low
Decided: The web app gets no Tailwind, shadcn or next-intl yet. It has only `/api/health` and the minimal layout and page Next.js needs.
Why: Those are choices for the UI tasks. The scaffold shouldn't make them early.
Alternatives: Wire them in now.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by the human · risk: low
Decided: No empty placeholders in risky or safety paths. Not created: `harness/src/access`, `harness/src/guardrails`, `content/prompt-packs`, `content/skills`, `content/locales`, `evals/suites/safety`, `evals/suites/locked` and `docs/adr`. The task that fills each one creates it, and README lists the full layout. Applying the same rule, the builder also skipped `packages/payments` (a risky path).
Why: Empty risky folders invite unreviewed code and blur the approval trail.
Alternatives: Create every folder now.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by the human · risk: low
Decided: The harness import rule follows rule 3 to the letter. Node built-ins (`node:crypto`, `fs`, `crypto`) fail lint in `packages/harness`. This replaces the planner's idea of allowing `node:` modules.
Why: It keeps the harness runtime-neutral. Ids, clocks and similar things come in through ports.
Alternatives: Allow `node:` built-ins.
Reversible: Yes, by changing one line in the rule.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by tdd-guide · risk: medium
Decided: The harness import rule has two narrow exceptions. `vitest` is allowed only in test files (`*.test.*`, `*.spec.*`). Tooling config files at the harness root (`eslint.config.js`, `vitest.config.ts`) are exempt. Everything else fails closed, including relative paths that leave the package and imports whose path can't be read.
Why: Harness tests must import vitest, and the lint config must import its preset. Neither ships as harness code.
Alternatives: Vitest globals with no exceptions.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by tdd-guide · risk: low
Decided: pnpm is a root dev dependency, so Turborepo can find it without a global install. Install scripts are off by default. pnpm's own script is allowed. BullMQ's optional native add-on (`msgpackr-extract`) is turned off, so BullMQ uses its plain-JS fallback.
Why: The repo rules forbid global installs, and fewer install scripts means less supply-chain risk.
Alternatives: `corepack enable`, which writes global shims.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by tdd-guide · risk: low
Decided: Next.js's auto-generated `AGENTS.md` is turned off (`agentRules: false`), and `next-env.d.ts` is git-ignored.
Why: The repo's own `CLAUDE.md` carries the agent rules, and a committed `next-env.d.ts` breaks typecheck on a clean checkout.
Alternatives: Commit both generated files.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Review · decided by team lead · risk: low
Decided: Two LOW review findings left as they are: the CLI reads its own package.json with an unchecked type cast, and the worker test passes a fake Redis with a type cast.
Why: Neither handles outside data; one is the CLI's own file, the other is test-only code.
Alternatives: Validate with Zod; build a typed fake connection.
Reversible: Yes.
