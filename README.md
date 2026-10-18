# Edmate

Edmate lets a student find the right teacher and learn with that teacher's AI agent every day.
Teachers build the agent from their own knowledge and sell packages that control what it knows
and can do. Open source (MIT).

- Product spec: `docs/edmate-prd.md`
- Build spec: `docs/edmate-harness-build-plan.md`
- Contributor and agent rules: `CLAUDE.md`

## Requirements

- Node 22 (`.nvmrc`; install with nvm)
- pnpm through corepack (pinned in `package.json#packageManager`). Never install pnpm globally.

## Commands

```bash
source ~/.nvm/nvm.sh && corepack pnpm install
source ~/.nvm/nvm.sh && corepack pnpm build        # every workspace (Turborepo)
source ~/.nvm/nvm.sh && corepack pnpm test         # Vitest with coverage
source ~/.nvm/nvm.sh && corepack pnpm lint         # ESLint, incl. the harness purity rule
source ~/.nvm/nvm.sh && corepack pnpm typecheck    # tsc --noEmit everywhere
source ~/.nvm/nvm.sh && corepack pnpm format       # Prettier
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=<pkg>...

source ~/.nvm/nvm.sh && corepack pnpm --filter @edmate/web dev   # http://localhost:3000/api/health
source ~/.nvm/nvm.sh && apps/cli/bin/edmate --version            # after `corepack pnpm build`
python3 .githooks/secret-scan.py --all
```

A workspace without a `test` script is skipped by `corepack pnpm test`, not failed.

## Harness purity (build plan rule 3)

`packages/harness` may import only `@edmate/contracts`, `zod`, `mathjs` and its own relative
modules. Node built-ins (`node:crypto`, `fs`, ...) are not allowed either. `corepack pnpm lint`
enforces this with the allow-list rule in `packages/config/eslint/rules/harness-purity.js`;
everything else reaches the harness through ports.

## Repo layout

Folders marked *(later)* are created by the task that first fills them, not by the scaffold.
Risky and safety paths never get empty placeholders.

```text
apps/
  web/                 Next.js app; GET /api/health
  worker/              BullMQ workers (a no-op worker for now)
  cli/                 `edmate` CLI (`edmate --version`)
packages/
  config/              shared tsconfig, ESLint (incl. harness purity) and Prettier presets
  contracts/           Core contracts as Zod schemas + types; fixtures at @edmate/contracts/fixtures
  harness/             turn pipeline and teaching engine
    src/pipeline/ src/pedagogy/ src/skills/ src/roleplay/ src/tools/ src/memory/
    src/access/        (later, M3: the access filter)
    src/guardrails/    (later, M6: pre/post guards)
  gateway/             model gateway (empty until M2)
  ingest/              ingestion (empty until M4)
  payments/            (later: payment adapter, subscription state machine, ledger)
  db/                  Drizzle schema, migrations, repositories (empty until M1)
  evals/               eval runner (empty until M7)
  ui/                  shared React components (empty)
content/
  demo-teacher/        open-licensed sample course (filled by task 1.8)
  prompt-packs/        (later)
  skills/              (later)
  locales/             (later)
evals/
  suites/leak/ accuracy/ persona/ pedagogy/ advice/
  suites/safety/       (later)
  suites/locked/       (later)
  fixtures/            recorded model responses for offline CI
docs/
  adr/                 (later, task 0.4)
docker/                Compose, Caddyfile, env.example (task 0.2)
```
