# Edmate

Edmate lets a student find the right teacher and learn with that teacher's AI agent every day. Teachers build the agent from their own knowledge and sell **packages** that control what it knows and can do; the teacher teaches live once or twice a month. It is country-neutral (locale packs per market) and open source (MIT).

- Product spec: `docs/edmate-prd.md` (PRD v0.3)
- Build spec: `docs/edmate-harness-build-plan.md` (v0.3: 14 milestones, 95 tasks, rules, Definition of done)
- How the agent team works: `docs/architecture.html`
- Task board: `docs/board/tasks.yaml` (`python3 .claude/skills/board/board.py next | status | show <id>`)
- Decision log: `docs/decisions/log.md` (newest first, plain words)

## You are the team lead
The main session runs the team with the **`team-lead` skill**: pick ready tasks, choose each agent's model, delegate plan → build → review, run the merge gate, merge, and log decisions. Never write feature code in the main session. **Current focus: the harness (M0–M7) and its exit gate.**

## Non-negotiables (full list: build plan § Agent operating rules)
1. One task, one branch (`m<milestone>/<task-id>-<slug>`), one PR.
2. `packages/contracts`, the tech stack and prompt-pack behaviour are frozen; changing them needs an ADR a human approves.
3. `packages/harness` imports only contracts, zod, mathjs and its own modules; everything else goes through ports (a hook rejects violations).
4. No real model or payment calls in tests; use the scripted gateway and fixtures.
5. **The repo is public.** Never commit credentials, keys, real student data, teacher uploads or personal details. The secret scan blocks them at edit, commit and CI.
6. Risky paths (`.claude/skills/merge-gate/risk-paths.txt`) need the human's `human-approved` label; everything else the lead merges once the merge gate passes.
7. Ask, don't guess: an unclear spec or an open decision goes to the human.
8. Log every decision the spec didn't make (task handoff `## Decisions` → decision log on merge).

## Commands
Node comes from nvm; pnpm runs through corepack (never install globally):

```bash
source ~/.nvm/nvm.sh && corepack pnpm install
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=<pkg>...
python3 .claude/skills/merge-gate/merge_gate.py <task-id>
python3 .githooks/secret-scan.py --all
```

## The team (`.claude/agents/`)
- **Plan:** `planner`, `architect`, `docs-lookup`
- **Build:** `tdd-guide` (own worktree), `build-error-resolver` (own worktree), `pedagogy-author`, `eval-author`
- **Review:** `code-reviewer`, `typescript-reviewer`, `database-reviewer`, `security-reviewer`, `silent-failure-hunter`, `rag-pipeline-reviewer`, `safety-reviewer`

Website and launch agents (React, e2e, a11y, performance, SEO, marketing) are added from ECC when those phases start. Most agents are adapted from [ECC](https://github.com/affaan-m/ECC) (MIT); each file says so.

## Skills (`.claude/skills/`)
`team-lead`, `merge-gate`, `board`, `edmate-pedagogy`, `locale-context`, plus ECC skills: `tdd-workflow`, `verification-loop`, `coding-standards`, `backend-patterns`, `postgres-patterns`, `database-migrations`, `api-design`, `docker-patterns`, `security-review`, `agent-security-hardening`, `search-first`, `strategic-compact`.

## Hooks (`.claude/settings.json`)
- **Edits:** ask before touching contracts, safety or access/payments code, the spec or the harness config; block `.env` and key files; reject impure harness imports and anything the secret scan flags.
- **Shell:** no force-push and no pushes to `main`; `gh pr merge` must pass the merge gate; only the human adds `human-approved`; commits on `main` ask unless they only touch `docs/board/` or `docs/decisions/`.
