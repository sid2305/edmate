# Task 0.4: ADR template; ADR-0001 stack, ADR-0002 ports and adapters, ADR-0003 access filter by construction

Board: `python3 .claude/skills/board/board.py show 0.4` · Milestone M0 · deps: 0.1 (done) · branch: `m0/0.4-adrs`

**Risky.** `docs/adr/**` is in the "Contracts and architecture decisions" group of `risk-paths.txt`. Required reviewers: `architect`, `security-reviewer`, `typescript-reviewer`. The handoff needs a `risk: high` decision (draft below).

## Acceptance (verbatim, from `docs/board/tasks.yaml`)

Title: "ADR template; ADR-0001 stack, ADR-0002 ports and adapters, ADR-0003 access filter by construction (incl. the probe, public titles and the leak definition)"

Accept: "files merged."

### How it's shown (paste in handoff.md)
- `docs/adr/0000-template.md` exists with every required heading (Status, Date, Context, Decision, Alternatives, Consequences, Reviewers), in that order, and nothing else prescriptive (a skeleton other ADRs copy).
- `docs/adr/0001-tech-stack.md`, `docs/adr/0002-ports-and-adapters.md`, `docs/adr/0003-access-filter-by-construction.md` each use every template heading, are each Accepted, and each cite the build-plan section and decision-log entry they record (no new decision text).
- A tiny heading check (optional per the task, included here because it is cheap): `docs/adr/check-headings.py`, run as `python3 docs/adr/check-headings.py` — fails if any `docs/adr/NNNN-*.md` (excluding the template) is missing one of the template's headings, and prints the file(s) and missing heading(s) on failure. Paste its clean output in the handoff.
- PR merges: this is literally the acceptance text, so the handoff also pastes the merged PR number/link once the lead merges it.

## Process (say so in the handoff)
This is a plan → architect-draft → build task, not a plain build task:
1. The **architect** (read-only) is invoked first and drafts the full text of all three ADRs (and reviews the template shape) in its reply — it does not write any files.
2. A **builder** (tdd-guide, since this is still "coding" discipline: write the failing check first) takes the architect's drafted text verbatim and writes `docs/adr/0000-template.md`, the three ADR files, and `docs/adr/check-headings.py`.
3. Reviewers (`architect`, `security-reviewer`, `typescript-reviewer`) then review the merged-looking diff as normal; `architect` here is confirming its own draft was transcribed faithfully, not re-deciding anything.

No new decisions are made in this task. Each ADR records a decision the spec or the decision log already made; where the build plan's prose differs from what was actually built (ports), the ADR says so and explains why, but does not re-open the choice.

## Design

### Numbering and filenames
`docs/adr/0000-template.md` (the template itself, not a decision), `0001-tech-stack.md`, `0002-ports-and-adapters.md`, `0003-access-filter-by-construction.md`. Four-digit, zero-padded, matching the template's own filename pattern.

### Template (`0000-template.md`) headings, in order
`# ADR-NNNN: <title>` then:
- **Status** — Proposed / Accepted / Superseded by ADR-NNNN (all three real ADRs here are **Accepted**, since each records a decision already made and acted on).
- **Date** — ISO date the decision was made (not the date this file is written), matching the decision-log entry.
- **Context** — the problem/constraint the spec or a task posed.
- **Decision** — what was decided, in plain words.
- **Alternatives** — what else was considered and rejected, and why.
- **Consequences** — what this makes easy, what it makes hard, what changing it later costs (the build plan's "only by ADR" / "reversible by ADR" language).
- **Reviewers** — who reviewed this ADR (filled in per-ADR when review completes; the template shows the placeholder `architect, security-reviewer, typescript-reviewer`).

### ADR-0001: Tech stack
- **Context:** build plan "Tech stack (fixed)" table (`docs/edmate-harness-build-plan.md` lines 47–73): one language end to end, boring dependencies, Docker Compose on one VM; rule 2 says changing it needs an ADR.
- **Decision:** the full stack table as written — TypeScript/Node 22 LTS everywhere, pnpm + Turborepo, Next.js, Tailwind/shadcn/next-intl, Zod at every boundary, Postgres 16 + pgvector/Drizzle, Redis/BullMQ, S3-compatible storage, Vercel AI SDK behind a `gateway` port, Auth.js, a `Payments` port per market, locale packs, mathjs, Vitest/Playwright/eval runner, Docker Compose deploy, MIT licence. Records the 17 Oct 2026 "Tech stack · decided by Claude (lead)" log entry explicitly: no Rust; TypeScript throughout; revisit only for one hot spot behind an existing port, with its own ADR.
- **Alternatives:** Rust backend with a TypeScript front end; Rust for the harness only (both from the decision log entry).
- **Consequences:** one language, one set of shared Zod contracts, faster agent/contributor ramp-up; turns are I/O-bound (model/DB/network) so a single language doesn't cost latency; a future hot spot can still move to Rust behind its port without an ADR covering the whole stack, only that component.
- **Status:** Accepted. **Date:** 17 Oct 2026.

### ADR-0002: Ports and adapters
- **Context:** build plan "Repo layout" (line 114) says `harness` *defines* ports; "Core contracts" (line 118) says these types live in `packages/contracts`. Task 0.3 built `packages/contracts/src/ports.ts` as type-only interfaces (`Guard`, `RetrievalIndex`, `EntitlementStore`, `ProfileStore`, `TranscriptStore`, `CorrectionStore`, `TeacherQuestionStore`, `UsageMeter`, `ModelGateway`, `Tool<I,O>`, `TraceSink`, `AlertSink`), confirmed by the file's own header comment and the decision log's "0.3 Ports live in contracts" entry (18 Oct 2026, risk: medium).
- **Decision:** port interfaces live in `packages/contracts/src/ports.ts`, type-only (no Zod schema, no fixtures — functions can't be Zod data). `db`, `gateway`, `ingest` and `worker` implement them by importing contracts; `harness` imports and uses them, it does not define them. **This differs from the Repo layout prose** ("`harness` defines ports"), and the ADR must say so plainly: the two spec sentences conflicted (ports as Core-contracts types vs. harness-defined), and contracts was chosen as the single source so that adapter packages (db, gateway, ingest) can implement a port without depending on — or creating an import cycle with — the harness package, and so the harness purity rule (only contracts, zod, mathjs, own files) stays satisfiable. `harness/testing` supplies in-memory implementations for tests, matching the build plan's "Determinism" note.
- **Alternatives:** define ports in `packages/harness` as the Repo layout literally says, with adapters depending on harness types (rejected: would force db/gateway/ingest to depend on harness, or need a separate ports-only subpackage, for no benefit over putting them where the other shared contracts already live).
- **Consequences:** adapters have one clean dependency (contracts) instead of two; the harness purity hook's allow-list (contracts, zod, mathjs, own modules) stays simple; the Repo-layout sentence is now documented as superseded in intent (not wording) by this ADR; a reader comparing the build plan to the code should check here first.
- **Status:** Accepted. **Date:** 18 Oct 2026.

### ADR-0003: Access filter by construction
- **Context:** build plan "Access filter (packages and entitlements)" (lines 312–324) and task 5.4's acceptance ("`probe` never returns text; no unfiltered search exists anywhere"); PRD's "locked means locked"; this is a risk-paths group of its own (`packages/harness/src/access/**` etc., reviewer `security-reviewer`).
- **Decision:** locked material is kept out of the model *by construction*, not by instruction, specifically:
  - entitlements are always computed server-side (source: subscription / teacher_preview / eval); a client-sent package id is never trusted.
  - `RetrievalIndex.search` requires `allowedModuleIds` in its type signature and its SQL filters `teacher_id = $1 AND module_id = ANY($2)` before ranking; there is no unfiltered search function anywhere in the codebase.
  - **The probe:** `RetrievalIndex.probe(q, { teacherId, moduleIds })` is a code-only existence check over locked modules; it returns only `{ hit: boolean; score: number }`, never chunk text. `decide` sets `locked` when `lockedHit` is true and allowed retrieval found nothing above threshold, otherwise the question goes to `ask_teacher`. This is how "locked" and "not covered" are told apart without locked text ever reaching a prompt.
  - **Public titles:** module and package *titles* are public (shown on the teacher's public page); only chunk *text* from locked modules is withheld from every model call, including guards (`lockedLeak` is an n-gram check in code, not a model call).
  - Skills are filtered the same way: the tool registry only offers tools whose `skill` is in the entitlement.
  - Caches are keyed by package version; entitlement changes (e.g. a payment webhook) take effect on the next turn because `entitle` reads fresh each turn.
  - **The leak definition** (verbatim from the build plan, point 8): a leak is any span of 8 or more tokens from a locked chunk, or any fact present only in locked chunks (judge-scored), appearing in a reply.
  - Proof obligations named in the spec: a property test (random entitlements → retrieved chunks ⊆ allowed modules) and a ≥200-case `locked` adversarial eval suite with zero leaks.
- **Alternatives:** trust the prompt/system instructions to withhold locked material (rejected — the PRD calls a safety/access incident with a minor's trust "existential"; instruction-only filtering is not provable and models can be jailbroken); filter only at the UI layer (rejected — leaves an unfiltered path reachable by any direct API/tool call).
- **Consequences:** retrieval, probing and tool access cannot leak locked text even if a prompt-pack bug or a jailbreak attempt asks for it; the cost is that "not covered" vs "locked" requires the extra probe step and an explicit `ask_teacher` branch, and every new retrieval or tool path must go through the same filtered functions (no shortcuts) or the "no unfiltered search" invariant breaks.
- **Status:** Accepted. **Date:** 18 Oct 2026 (task 5.4 builds this; this ADR records the design decided in the build plan review).

### The heading-check script
`docs/adr/check-headings.py`: no new dependencies (stdlib only — `pathlib`, `re`, `sys`). Reads every `docs/adr/[0-9][0-9][0-9][0-9]-*.md` except `0000-template.md`, requires each of `## Status`, `## Date`, `## Context`, `## Decision`, `## Alternatives`, `## Consequences`, `## Reviewers` to appear (as a line starting with `## `), in that order; exits 1 and lists file + missing/out-of-order heading(s) on failure, exits 0 silently on success. This is optional per the task; it is small enough (~30 lines) to include now so a later ADR can't silently drop a heading, and it needs no CI wiring yet (0.5 can add it to the pipeline if the lead decides to).

## Files

**Create**
- `docs/adr/0000-template.md`
- `docs/adr/0001-tech-stack.md`
- `docs/adr/0002-ports-and-adapters.md`
- `docs/adr/0003-access-filter-by-construction.md`
- `docs/adr/check-headings.py`
- `docs/tasks/0.4/handoff.md`

**Modify**
- `README.md` (one line, if it lists `docs/`: mention ADRs live in `docs/adr/`) — only if README already has a docs index; otherwise skip.
- `docs/board/tasks.yaml` (lead only, on completion)

**Out of bounds**
- `packages/contracts/**` (frozen; no contract edits — ADR-0002 only *documents* where ports live, it does not move or change `ports.ts`).
- `packages/harness/src/access/**`, `packages/harness/src/guardrails/**` (task 5.4 and later build the filter in code; this task only writes the ADR that records the design).
- `docs/edmate-harness-build-plan.md`, `docs/decisions/log.md` (log entry is added by the lead on merge, not by the builder).
- `.claude/**`, `.github/**` (no hook, CI or gate changes).

## Tests first (order)
1. Write `docs/adr/check-headings.py` against **no** ADR files yet (or against a deliberately broken fixture) and confirm it fails/reports correctly — this is the "test" for a docs task: a script that can fail.
2. Write `docs/adr/0000-template.md`; run the check against it conceptually (the template itself is excluded from the check, so this step is just a read-through against the task's required heading list: context, decision, alternatives, consequences, status, date, reviewers).
3. Write `0001-tech-stack.md`, run `check-headings.py`, fix any missing heading.
4. Write `0002-ports-and-adapters.md` (must explicitly name the Repo-layout vs. contracts conflict and the reason), run the check.
5. Write `0003-access-filter-by-construction.md` (must cover the probe, public titles, and quote the leak definition), run the check.
6. Run `python3 docs/adr/check-headings.py` clean; run `python3 .githooks/secret-scan.py --all` (docs-only, should already be clean).

## Risky paths touched (checked against risk-paths.txt)
- `docs/adr/0000-template.md`, `docs/adr/0001-tech-stack.md`, `docs/adr/0002-ports-and-adapters.md`, `docs/adr/0003-access-filter-by-construction.md`, `docs/adr/check-headings.py` — all under `docs/adr/**`, group "Contracts and architecture decisions and `docs/adr/**`" (rule 2). **Reviewers: architect, security-reviewer, typescript-reviewer.**
- `docs/tasks/0.4/**`, `README.md`: no match.
- No migrations. No safety-prefix paths (guardrails, prompt packs, skills, locales, safety/locked evals, alerts) and no access/payments/auth paths are touched — this task only *documents* access-filter-by-construction, it does not implement or change code under `packages/harness/src/access/**`.

**A risk: high decision entry is required** for this handoff (rule 2 / risk-paths.txt group 3: any `docs/adr/**` change).

## Planned `risk: high` decision (handoff `## Decisions`)
### <date> · 0.4 ADRs recorded · decided by team lead · risk: high
Decided: Three architecture decisions already made in the build plan and the decision log are now written down as ADRs — the tech stack (TypeScript throughout, no Rust), where port interfaces live (`packages/contracts/src/ports.ts`, type-only, differing from the Repo-layout prose that says harness defines them), and the access filter being built by construction (filtered search, the code-only probe, public titles, the 8-token leak definition). A template (`docs/adr/0000-template.md`) fixes the shape every future ADR must use.
Why: Rule 2 requires an ADR before contracts, stack or prompt-pack behaviour can change again; writing these three down now gives that rule something to point at, and the ports note resolves a reader-visible conflict between two parts of the spec.
Alternatives: Leave the decisions only in the build plan and decision log, with no `docs/adr/` folder yet.
Reversible: Only by a new ADR superseding one of these.

## Open questions (lead decides; none blocks the build)
- **Q1. ADR numbering gap.** The template is `0000`; should it count as "ADR-0000" in prose, or just "the template, not a decision"? *Recommend:* the template is explicitly not a decision (Status/Date/Reviewers headings exist only to be copied), so it is referred to as "the template," never "ADR-0000," to avoid a reader treating it as a real decision with no content.
- **Q2. Heading-check script scope.** The task says this check is optional. *Recommend:* include it now (it is ~30 lines, stdlib-only, catches a dropped heading before review) but do not wire it into CI yet — that is 0.5's call, not this task's.
- **Q3. ADR-0003's relationship to task 5.4.** 5.4 (M5) is the task that actually *builds* the filtered `search`/`probe`/registry; this ADR documents the design the build plan already specifies for it, dated 18 Oct 2026 (when the design was fixed in the plan), not a later "as-built" date. *Recommend:* keep as drafted; if 5.4's implementation ever needs to diverge from this ADR, that is itself a new ADR, not an edit to 0003.

## Lead answers (18 Oct 2026) — override the sections above

- **Workflow change (token budget):** the builder writes the ADR text directly from the build plan and decision log; `architect` does not pre-draft. `architect` still reviews every ADR (it is a required reviewer for docs/adr/**) and its findings are fixed before merge. Record this in the handoff decisions (risk: low).
- Open questions 1–3: accepted as recommended (template is not numbered as an ADR; heading check not wired into CI yet, 0.5 may add it; ADR-0003 dated 18 Oct 2026).
- Every claim in an ADR cites its source (build plan section or decision-log entry date and title). No new decisions.
