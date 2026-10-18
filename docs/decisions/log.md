# Edmate decision log

Every decision the spec did not already make, in plain words, newest first. Agents write entries in their task's handoff, and the team lead copies them here when the PR merges. Your own decisions are logged too.

- **risk: low** · the agent decided and moved on
- **risk: medium** · the agent or lead decided; worth a skim
- **risk: high** · you decided, or the lead merged a risky change (contracts, ADRs, safety, access, payments, the harness) after its required reviewers; skim these first

Format and rules: `.claude/skills/merge-gate/SKILL.md`.

---

### 18 Oct 2026 · 0.3 Contracts created · decided by team lead · risk: high
Decided: The shared contracts now exist as Zod schemas, exactly matching the build plan's Core contracts. Tests fail if the code and the spec drift apart. Unknown fields are rejected, and the limits in the spec comments are enforced. From now on, changing a contract needs an ADR.
Why: Every package builds on these shapes; the tests prove they match the spec.
Alternatives: Hand-written TypeScript types without runtime checks.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Ports live in contracts · decided by team lead · risk: medium
Decided: The ports (Guard, Tool, RetrievalIndex, the stores, UsageMeter, ModelGateway, TraceSink, AlertSink) are type-only interfaces in packages/contracts/src/ports.ts, with no Zod schemas and no fixtures. The db, gateway and ingest adapters implement them by importing contracts, although the spec's repo layout says the harness defines them.
Why: Adapters can implement them without depending on the harness; functions can't be Zod data.
Alternatives: Define them in packages/harness.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Spec shapes kept as written · decided by team lead · risk: low
Decided: TurnEvent hint_rung keeps rung as a number and TurnTrace guards keep action as a plain string, as the spec says; at runtime hint_rung must be a whole number from 0 to 4.
Why: No type change to the spec, but bad rungs are still caught.
Alternatives: Change the types to the rung union and the guard action enum (needs an ADR).
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Conditional rules enforced · decided by team lead · risk: medium
Decided: Four rules from the spec comments are checked at runtime: an entitlement has a subscriptionId exactly when its source is subscription; no module is both allowed and locked (fail closed); a message turn needs text; a skill_action turn needs a skill. Each has a valid and an invalid fixture. TeacherQuestion.answeredAt has no rule.
Why: The spec states them in comments; checking them stops bad data at the boundary.
Alternatives: Leave them to the code that uses the data.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Field formats · decided by team lead · risk: medium
Decided: Timestamps are ISO 8601 with Z or an offset. Languages are a lowercase 2–3 letter primary tag. Currency is three capital letters. Market is a two-capital-letter ISO 3166 code or the word "global" (no invented codes; the pilot market stays your decision). Ids are any non-empty string. Counts, token numbers, versions, minor-unit amounts and cost are whole numbers from 0 up. Mastery p is between 0 and 1. Characters are counted as Unicode code points and words as runs of non-space. Attachment mime must start with image/.
Why: The spec gives these fields as plain strings and numbers; these are the narrowest formats it implies.
Alternatives: No format checks.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 No default message limit in the contract · decided by team lead · risk: low
Decided: PackageConfig.dailyMessageLimit is required in the contract; the studio and the seed fill in 20.
Why: A Zod default would make the field optional in the input type and break the exact match with the spec.
Alternatives: A Zod default of 20.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Zod version and strict objects · decided by tdd-guide · risk: low
Decided: Contracts pin zod 4.6.7 exactly (the newest stable 4.x on npm today). Every object schema is strict, so unknown keys are errors, not silently dropped; a client-sent packageId on a turn is rejected. Optional fields use Zod's exactOptional, so the types match the spec exactly and an explicit undefined is rejected.
Why: Zod 4 has the features the plan needs; strict objects catch typos and client-sent access fields.
Alternatives: zod 3; stripping unknown keys.
Reversible: Yes for the version; strictness only by ADR.

### 18 Oct 2026 · 0.3 Prompt-pack version is semver · decided by tdd-guide · risk: low
Decided: AgentConfig.promptPackVersion must be a semantic version such as 1.0.0 or 2.1.0-rc.1, because the spec comment says one semver pins the prompt-pack set.
Why: Catches values like "latest" that would break pinning.
Alternatives: Any string.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Size caps and safe formats · decided by tdd-guide · risk: medium
Decided: After review, the contracts cap sizes and narrow formats the spec left open. Ids are 1–128 letters, digits, _ or -. An attachment storage key is a relative path of at most 200 safe characters with no ".." part; an attachment is a PNG, JPEG, WebP or HEIC image of 1 byte to 20 MB. A skill payload is at most 16 KB of JSON. Turn text is also capped at 8,000 UTF-16 units before the 4,000-character count. Guard reasons are at most 500 characters; rewrite text and alert excerpts at most 8,000. Each locale PII pattern is at most 500 characters and must be a valid regular expression. The numbers live in LIMITS.
Why: Untrusted or model-made data reaches storage, prompts and alerts; small fixed caps stop abuse and runaway output at the boundary.
Alternatives: No caps; caps enforced only in the API layer.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 Turn context must be consistent · decided by tdd-guide · risk: medium
Decided: A turn context is rejected if a retrieved chunk comes from a module the entitlement doesn't allow or from another teacher, or if the entitlement's package id, package version or agent id don't match the package and agent in the context.
Why: Fails closed if a bug ever mixes another package's or teacher's material into a turn.
Alternatives: Leave the checks to the pipeline code.
Reversible: Only by ADR.

### 18 Oct 2026 · 0.3 One shared zod copy · decided by tdd-guide · risk: low
Decided: Contracts lists zod 4.6.7 as a peer dependency (and a dev dependency for its own tests), and each consumer installs zod itself; the harness now lists zod 4.6.7 because it uses the contracts at runtime.
Why: Every package then shares one zod, so schemas and their types stay compatible.
Alternatives: zod as a normal dependency of contracts.
Reversible: Yes.

### 18 Oct 2026 · 0.3 Review · decided by team lead · risk: low
Decided: The type cast in packages/harness/src/testing/fixtures.test.ts stays for now; the ports-in-contracts note goes into ADR-0002 (task 0.4). MEDIUM review findings were fixed in this PR, not deferred, because contracts freeze on merge.
Why: The cast is test-only and narrow; fixing contracts later would need an ADR and three reviewers.
Alternatives: Defer the MEDIUMs to a follow-up task.
Reversible: Yes.

### 18 Oct 2026 · 0.2 MinIO image from a community build · decided by tdd-guide · risk: medium
Decided: The local S3 server is `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`, a maintained community build of the MinIO server with dated release tags, because the official MinIO images are no longer published.
Why: The amendment asks for MinIO pinned to a dated release tag; this is the only source found that still has one. It is dev-only, and the app talks plain S3, so it can be swapped without code changes.
Alternatives: `bitnamilegacy/minio` (frozen at 2025.7, no updates); Chainguard's MinIO (free tier is `latest` only); a different S3 server such as SeaweedFS or RustFS; building MinIO from source in our own image.
Reversible: Yes, one image line in docker/compose.yaml.

### 18 Oct 2026 · 0.2 Other image pins · decided by tdd-guide · risk: low
Decided: `pgvector/pgvector:0.8.1-pg16`, `redis:7.4.6-alpine`, `caddy:2.10.2-alpine`, and `node:22.22.3-alpine3.22` for both app images (the same Node as `.nvmrc` 22 in dev).
Why: Exact tags as amendment 2 asks; pgvector's image is Postgres 16 with the extension built in.
Alternatives: Floating tags such as `pg16`, `7-alpine`, `2-alpine`, `22-alpine`.
Reversible: Yes.

### 18 Oct 2026 · 0.2 S3 client · decided by lead · risk: low
Decided: The storage round-trip uses the AWS SDK v3 S3 client (`@aws-sdk/client-s3` 3.1152.0, exact), with path-style addressing on by default for MinIO.
Why: Production is any S3-compatible bucket, not necessarily MinIO (amendment 7).
Alternatives: The MinIO JS SDK.
Reversible: Yes.

### 18 Oct 2026 · 0.2 Ports and defaults · decided by tdd-guide · risk: low
Decided: Only Caddy publishes a port, on 127.0.0.1:8080 (`EDMATE_HTTP_PORT`), plus MinIO's API and console on 127.0.0.1:9000/9001; web, worker, Postgres and Redis stay on the compose network. Compose runs with no env file: every setting has a dev default (`edmate` / `edmate-dev` / `edmate-dev-storage`) documented in docker/env.example.
Why: Port 3000 is taken on this machine (amendment 4); binding to 127.0.0.1 keeps the dev passwords off the local network; agents cannot create env files (amendment 3).
Alternatives: Publish on all interfaces; require an env file.
Reversible: Yes.

### 18 Oct 2026 · 0.2 Standalone web image · decided by lead · risk: low
Decided: The web image runs Next.js standalone output (`output: 'standalone'` in apps/web/next.config.ts) as the `node` user; the worker image uses `pnpm deploy --prod` and runs as `node`.
Why: Small runtime images (about 200 MB) with no dev dependencies or root process.
Alternatives: `pnpm --filter web start` on a full install.
Reversible: Yes.

### 18 Oct 2026 · 0.2 Worker healthcheck · decided by tdd-guide · risk: low
Decided: The worker counts as healthy when its container can open a connection to Redis, its queue.
Why: The worker has no HTTP port yet and app code was out of scope; this shows the process is up and its one dependency is reachable.
Alternatives: A heartbeat file or HTTP endpoint written by the worker (needs a change to apps/worker/src/index.ts); no healthcheck.
Reversible: Yes, when real queues land.

### 18 Oct 2026 · 0.2 Review · decided by team lead · risk: low
Decided: Three LOW review notes stay as they are: the MinIO healthcheck in docker/compose.yaml uses the image's own `mc`; apps/web/Dockerfile has no `outputFileTracingRoot`; roundtrip.ts picks a random object key by default. The MinIO community image is pinned by digest.
Why: Each is shown working in the evidence; none affects production.
Alternatives: Add a custom healthcheck, set outputFileTracingRoot, pass an explicit key.
Reversible: Yes.

### 18 Oct 2026 · 0.7 Lead-approved risky merges · decided by tdd-guide · risk: high
Decided: The merge gate passes a risky branch only when review.md names every reviewer its risk groups need (listed in risk-paths.txt) and the handoff has a risk: high entry; otherwise it fails. It no longer reads the PR label and never says "needs human". A risky path with no reviewers line fails the gate.
Why: Your decision that the lead merges everything; this keeps the specialists and puts every risky merge on your skim list.
Alternatives: Keep a human step for some groups.
Reversible: Yes.

### 18 Oct 2026 · 0.7 Decision checks · decided by lead · risk: low
Decided: A [wontfix] finding passes only if a decision entry for the task names its file. `board.py done` needs each handoff `Decided:` line word for word in the log.
Why: Simple, mechanical, hard to satisfy by accident.
Alternatives: Count entries; fuzzy matching.
Reversible: Yes.

### 18 Oct 2026 · 0.7 Locale packs count as safety · decided by tdd-guide · risk: medium
Decided: Changes to content/locales need safety-reviewer and a safety-review.md, like the other child-safety paths.
Why: The scope change put locales in the safety group, and the safety review file goes with that group.
Alternatives: safety-reviewer only, no safety-review.md.
Reversible: Yes, one line in the gate.

### 18 Oct 2026 · 0.7 Wontfix file match · decided by tdd-guide · risk: low
Decided: The file a [wontfix] finding covers is its first word that looks like a path (has a slash or a file extension). An entry passes if it names that path or just the file name.
Why: Matches the review.md format; file names are how people write decisions.
Alternatives: Require the full path.
Reversible: Yes.

` ignored, safety-review.md for safety paths and locales, destructive migration needs `database-reviewer`, a glob with no `# reviewers:` line fails closed, never exit 3. `Wontfix` (6 cases).
- `test_board.py` (11): `done` refused with no handoff / no `## Decisions` / a `Decided:` line not in the log word for word / a condensed line (board file unchanged each time); `None` and whitespace-only differences pass; `next` warns for a planning task with no plan.md and not once it exists; other statuses unchanged.
- `test_hooks.py` (9): runs main's hooks unchanged (no edits): force-push denied, push to main allowed when the secret scan is clean and denied when it flags (a tracked `.npmrc`), label deny, `gh pr merge` needs a number, `.env` deny, no asks; guard-paths denies secrets/key files, allows contracts and harness files.

Gate demo in a temp repo (`contracts` change, `risk: high` entry present):
```
$ merge_gate.py 9.9   (reviewers missing) -> exit 1
  risky packages/contracts/src/x.ts
  FAIL  risky packages/contracts/src/x.ts: review.md Reviewers: is missing architect
  FAIL  risky packages/contracts/src/x.ts: review.md Reviewers: is missing security-reviewer
RESULT: FAIL — fix the items above, re-run the reviewers, then run the gate again.
$ merge_gate.py 9.9   (all three named) -> exit 0
  risky packages/contracts/src/x.ts
RESULT: PASS — risky, lead-approved: the required reviewers ran and a risk: high decision is logged. ...
```

`python3 .githooks/secret-scan.py --all`: clean (see final commit).

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
