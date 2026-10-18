# Edmate decision log

Every decision the spec did not already make, in plain words, newest first. Agents write entries in their task's handoff, and the team lead copies them here when the PR merges. Your own decisions are logged too.

- **risk: low** · the agent decided and moved on
- **risk: medium** · the agent or lead decided; worth a skim
- **risk: high** · you decided (risky or ambiguous)

Format and rules: `.claude/skills/merge-gate/SKILL.md`.

---

### 18 Oct 2026 · Merge policy · decided by you · risk: high
Decided: No permission prompts from the repo's hooks, and the team lead decides every merge, risky ones included. A risky merge needs the right specialist reviewers (safety-reviewer for child safety, security-reviewer for access, payments, sign-in and keys, architect for contracts and ADRs) and is logged as risk: high. Hard blocks stay: no secrets or key files, secret scan before pushes, harness purity, no force-push.
Why: You don't want to approve merges or edits; the lead holds the context.
Alternatives: Your approval for risky paths (the old rule).
Reversible: Yes; restore the ask rules and the merge gate's exit 3.

### 18 Oct 2026 · Repo and push policy · decided by you · risk: high
Decided: The code is now on GitHub at github.com/sid2305/edmate (public). Agents push, including straight to main; there is no human push step. Force-push stays blocked, and every push to main runs the secret scan first and is refused if anything is flagged.
Why: You don't want to run pushes yourself.
Alternatives: Agents push task branches only and the human pushes main; PR-only merges.
Reversible: Yes; restore the deny rule in guard-bash.sh.

### 18 Oct 2026 · Merge policy · decided by you · risk: high
Decided: Changes to packages/contracts no longer need your approval. The team lead decides, provided an ADR (written by architect) explains the change, security-reviewer and an Opus typescript-reviewer have reviewed it, and the lead logs it as risk: high. ADRs about the tech stack or prompt-pack behaviour, and all other risky paths, still need you.
Why: You don't want to be the bottleneck for contract changes.
Alternatives: Keep your approval for every contract change.
Reversible: Yes; put packages/contracts back on the human list.

### 17 Oct 2026 · Board · decided by you · risk: low
Decided: Added task 0.7, harness fixes found in the 0.1 dry run: a local human approval for the merge gate, decision-log checks, shell-write guards for protected paths, and planner and plan-file fixes.
Why: Without them, risky tasks can't pass the gate before GitHub exists, and some rules are only enforced for the Edit and Write tools.
Alternatives: Live with the gaps until CI (0.5).
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by tdd-guide · risk: low
Decided: Pinned pnpm 12.14.0, Turborepo 2.11.9, ESLint 10.13, Vitest 5.0.5, Next.js 16.4.2, React 19.3.1, BullMQ 6.3.16, Node 22.x. TypeScript 6.0.3, not 7, because the ESLint TypeScript plugin doesn't support 7 yet.
Why: Newest stable versions that work together on Node 22.
Alternatives: TypeScript 7 without type-aware linting.
Reversible: Yes, by bumping versions.

### 17 Oct 2026 · 0.1 Harness purity rule · decided by tdd-guide · risk: medium
Decided: Two narrow exceptions to the harness import rule: `vitest` in test files only, and tooling config files at the harness root (eslint.config.js, vitest.config.ts). Everything else fails closed, including relative paths that leave the package, unreadable import paths and indirect use of `require`.
Why: Harness tests need vitest and the lint config needs its preset; neither ships as harness code.
Alternatives: Vitest globals with no exceptions.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by you · risk: low
Decided: `packages/payments` is not created as an empty workspace; the payments milestone (M10) creates it.
Why: Same rule as the other risky folders: no empty placeholders in risky paths.
Alternatives: An empty shell like contracts, which would also need your approval.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by planner · risk: low
Decided: `edmate --version` runs from the built output; no dev-mode entrypoint. The web app gets no Tailwind, shadcn or next-intl yet, only `/api/health` and the minimal pages Next.js needs.
Why: Matches the acceptance order (build, then test, lint); UI choices belong to the UI tasks.
Alternatives: A tsx dev entrypoint; wiring the UI stack now.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by tdd-guide · risk: low
Decided: pnpm is a root dev dependency (no global install); install scripts are off by default; BullMQ uses its plain-JS fallback instead of a native add-on. Next.js's auto-generated AGENTS.md is off and next-env.d.ts is git-ignored.
Why: Repo rules forbid global installs; fewer install scripts means less supply-chain risk; the repo's CLAUDE.md already holds agent rules.
Alternatives: corepack enable; committing generated files.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Review · decided by team lead · risk: low
Decided: Two LOW review findings left as they are: the CLI reads its own package.json with an unchecked type cast, and the worker test passes a fake Redis with a type cast.
Why: Neither handles outside data.
Alternatives: Validate with Zod; build a typed fake connection.
Reversible: Yes.

### 17 Oct 2026 · Tech stack · decided by Claude (lead), at your request · risk: medium
Decided: Keep TypeScript end to end; no Rust. Revisit only for a single hot spot at scale, as a Rust service behind an existing port, with its own ADR.
Why: Turns are dominated by model, database and network waits, not our code; one language lets every app share the Zod contracts; the libraries we need (Next.js, Auth.js, AI SDK, Drizzle, BullMQ, payment SDKs) are TypeScript-first; agents and contributors move faster in TypeScript.
Alternatives: Rust backend with a TypeScript front end; Rust for the harness only.
Reversible: Yes, per component behind ports.

### 17 Oct 2026 · 0.1 Monorepo scaffold · decided by you · risk: low
Decided: The scaffold does not create empty placeholder folders in risky or safety paths (harness access and guardrails, prompt packs, skills, locales, safety and locked evals, ADRs). The task that fills each folder creates it; the README lists the full layout.
Why: Empty files there would trigger safety review and approval for nothing.
Alternatives: Create every folder now.
Reversible: Yes.

### 17 Oct 2026 · 0.1 Harness purity rule · decided by you · risk: low
Decided: The harness may import only contracts, zod, mathjs and its own files. Node built-ins (like node:crypto or fs) are blocked too.
Why: Rule 3 taken literally keeps the harness free of hidden I/O; a later need gets an explicit allow-list entry and a log entry.
Alternatives: Allow all node: built-ins.
Reversible: Yes, a one-line lint change.

### 17 Oct 2026 · Product · decided by you · risk: high
Decided: When the teacher's material doesn't cover a question, the agent says so and sends the question to the teacher. The teacher answers from an inbox; the answer goes back to the student and becomes a teacher note and a test case, so the agent can answer similar questions next time. The agent never fills gaps with general knowledge.
Why: Keeps the teacher in the loop and makes the agent better with every answer.
Alternatives: Allow labelled general knowledge; strict "not covered" with no follow-up.
Reversible: Yes.

### 17 Oct 2026 · Scope · decided by you · risk: medium
Decided: MVP cuts from the review: Google and email sign-in (no phone OTP); two model adapters; provider subscriptions with manual monthly payouts; study plan and photo upload moved to P1; load test at 50 students; manual teacher verification and regulated-subject review. One course and one agent per teacher. A public teaching scorecard on teacher pages is in the MVP.
Why: A smaller pilot that still shows what makes Edmate different.
Alternatives: Full scope.
Reversible: Yes; each item returns as a P1 task.

### 17 Oct 2026 · Build plan · decided by Claude · risk: medium
Decided: Applied the independent review (Fable) to the plan before task 0.1: completed the core contracts (about 12 missing types, entitlement sources for teacher preview and evals, one status list, guard results that carry replacement text, timezone, structured skill events); a code-only probe so "locked" and "not covered" are told apart without locked text reaching any model; concurrent checks so the harness adds under ~600 ms; per-turn cost ceiling and a default of 20 messages a day; the eval runner moved before the guards, with seeded suites; a defined "leak"; gates scoped by change. New tasks: demo teacher content (1.8), prompt packs v1 (3.11), eval runner (3.12), seed suites (4.0), ask-the-teacher path (5.10), outline and style drafters (5.11), scorecard (7.8), questions inbox (8.9). Now 104 tasks.
Why: The contracts freeze at task 0.3; fixing them later would need ADRs and rework.
Alternatives: Start building and fix as we go.
Reversible: Yes, until 0.3 merges.

### 17 Oct 2026 · Setup · decided by you · risk: low
Decided: All coding work (tdd-guide, build-error-resolver) runs on Opus 5.5 at medium effort, pinned in their agent files. The team lead no longer switches models for coding; cheaper defaults and per-task choices still apply to planning, review and docs agents.
Why: Code quality matters most where code is written; medium effort keeps token use in check.
Alternatives: Sonnet by default with Opus only for risky tasks.
Reversible: Yes, two lines in the agent files.

### 17 Oct 2026 · Setup · decided by you · risk: medium
Decided: The team lead picks each agent's model per task to save tokens. Every agent has a cheap default (mostly Sonnet, Haiku for docs lookup); the lead moves up to Opus only for risky or core tasks, or after two failed fix rounds. The safety reviewer always runs on Opus. The model used is recorded per task on the board.
Why: Most tasks don't need the most expensive model; the record shows where it is worth paying for.
Alternatives: One fixed model per agent.
Reversible: Yes, edit the table in the team-lead skill.

### 17 Oct 2026 · Product · decided by you · risk: medium
Decided: Edmate is country-neutral. Currency, language, helplines, payments, tax and privacy rules live in a locale pack per market; prices are stored as amount + currency. The pilot launches in one market, chosen later.
Why: Keep the platform open to any market; adding one later should mean adding a pack, not rewriting code.
Alternatives: India only.
Reversible: Yes, but cheapest to decide now, before the contracts freeze (task 0.3).

### 17 Oct 2026 · Setup · decided by Claude · risk: medium
Decided: The agent team changes for v0.3. The life-skills content-author is replaced by a pedagogy-author (platform prompt packs, skill and persona templates, the demo course). The safety-reviewer and eval-author now also cover locked content and regulated-subject advice. The access filter, payments and webhooks, and skill templates count as risky paths. marketing-agent and market-research move into the Validate phase; seo-specialist moves to the website phase; search-first is added for library choices.
Why: Teachers now bring their own course material, and the new promises (locked packages, payments) need the same protection as safety code.
Alternatives: Keep the v0.2 agents unchanged.
Reversible: Yes.

### 17 Oct 2026 · Build plan v0.3 · decided by Claude · risk: medium
Decided: Rewrote the build plan for PRD v0.3: 14 milestones, 94 tasks. The harness is still built and proven first (M0–M7), now with the access filter at its centre (task 5.4) and an exit gate requiring zero locked-content leaks. Payments (M10) and the trust console (M12) can run alongside. The v0.2 plan and PRD are archived in docs/archive/.
Why: The product changed from a school harness to a teacher-agent marketplace.
Alternatives: Patch the v0.2 plan.
Reversible: Yes; task IDs changed, so nothing built against the old plan exists yet.

### 17 Oct 2026 · Product · decided by you · risk: high
Decided: Edmate is a platform where a student finds the right teacher and learns with that teacher's AI agent. Teachers build the agent from their own knowledge and sell packages that control what the agent knows and can do. Not classroom-based, not a school replacement.
Why: Your direction for the product (PRD v0.3).
Alternatives: The v0.2 free, school-based life-skills harness.
Reversible: Yes, before code is built.

### 16 Oct 2026 · Setup · decided by you · risk: high
Decided: Nothing private or personal goes into the repo. A secret scan blocks credentials, private keys, personal emails and home-folder paths at three points: when an agent edits a file, at every git commit, and (from task 0.5) in CI. GitHub secret scanning and push protection are switched on when the repo is created.
Why: The repo is public, and anything pushed can be copied before it is deleted.
Alternatives: Rely on .gitignore only.
Reversible: Yes, but a leaked key must always be rotated, never just deleted.

### 16 Oct 2026 · Setup · decided by Claude · risk: low
Decided: This repo's commits use your private GitHub address (11736444+sid2305@users.noreply.github.com) instead of your Gmail. Your global git settings are unchanged.
Why: Every commit's email is public in a public repo.
Alternatives: Keep the Gmail address.
Reversible: Yes, one git setting.

### 16 Oct 2026 · Setup · decided by you · risk: medium
Decided: Agents act on GitHub through a private GitHub App (edmate-bot), not your account. Its key lives outside the repo in ~/.edmate-bot/.
Why: GitHub can then tell agent actions from yours, so only you can give the human-approved label, and you can approve the bot's PRs.
Alternatives: A second "machine" GitHub account; your own account with a hook.
Reversible: Yes.

### 16 Oct 2026 · Setup · decided by you · risk: medium
Decided: The GitHub repo is public.
Why: Edmate is open source; branch protection and Actions minutes are free for public repos.
Alternatives: Private until the exit gate (needs GitHub Pro for branch protection).
Reversible: Partly. Anything already public may have been copied.

### 16 Oct 2026 · Setup · decided by you · risk: medium
Decided: Code is MIT-licensed. Curriculum content stays CC BY-SA 4.0, as the PRD says.
Why: MIT is the easiest for schools, NGOs and other programmes to adopt.
Alternatives: Apache 2.0; AGPL.
Reversible: Only for future versions.

### 16 Oct 2026 · Setup · decided by you · risk: high
Decided: The team lead merges PRs itself once reviews are done, every CRITICAL and HIGH finding is fixed and re-checked, and the gates are green. You are asked only for risky or ambiguous changes.
Why: Waiting on you for every PR would stall the build; the lead holds the full context.
Alternatives: You approve every PR.
Reversible: Yes, by editing `risk-paths.txt` or the merge-gate skill.

### 16 Oct 2026 · Setup · decided by you · risk: high
Decided: Child-safety code, frozen contracts and ADRs, keys, sign-in, data isolation, migrations that delete data, and the `.claude/` and `.github/` config count as risky and need your `human-approved` label.
Why: The PRD calls a safety incident with a minor "existential", and these areas are hard to undo.
Alternatives: The lead also merges these.
Reversible: Yes, edit `.claude/skills/merge-gate/risk-paths.txt`.

### 16 Oct 2026 · Setup · decided by you · risk: medium
Decided: Keep this decision log as one Markdown file, newest first, written only by the team lead on `main`.
Why: One writer means no merge conflicts between parallel agents; Markdown is easy to read anywhere.
Alternatives: One file per decision; a Claude Doc.
Reversible: Yes.

### 16 Oct 2026 · Setup · decided by you · risk: medium
Decided: Host the code on GitHub and use GitHub Actions for CI gates, the merge-gate check and risk labels (added with task 0.5).
Why: GitHub then enforces the merge rules, rather than us trusting an agent to follow them.
Alternatives: Local checks only.
Reversible: Yes.
Open: private repo with GitHub Pro, or public now; a separate bot account for agent PRs (see the board's decisions).

### 15 Oct 2026 · Setup · decided by you · risk: medium
Decided: Use ECC's agents and skills as a library: copy only what each phase needs into the repo, instead of installing all of ECC.
Why: All of ECC adds about 35k tokens to every session, and its generic rules clash with the build plan.
Alternatives: Full ECC install; ECC plugin scoped to this project.
Reversible: Yes.

### 15 Oct 2026 · Setup · decided by you · risk: low
Decided: Use ECC agents instead of a custom role-based team (team lead, PM, designer and so on). Keep 3 Edmate-only agents ECC lacks: safety-reviewer, content-author, eval-author.
Why: ECC's agents are already tested; Edmate needs only the gaps filled.
Alternatives: A custom team of about 12 role agents.
Reversible: Yes.

### 15 Oct 2026 · Setup · decided by you · risk: low
Decided: Everything lives in `~/edmate` with project-level settings; nothing is installed globally.
Why: Keeps your other projects untouched, and the setup versioned with the code.
Alternatives: Global install in `~/.claude`.
Reversible: Yes.
