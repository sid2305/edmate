# Edmate build plan v0.3

Oct 17, 2026 · @siddhant lahoti · Replaces the v0.2 plan (school life-skills harness), archived in `docs/archive/`. Product spec: `docs/edmate-prd.md` (PRD v0.3).

## How to use this plan

This is the build spec for Edmate v0.3: teachers turn their knowledge into an AI teaching agent, sell packages, and students subscribe and learn with that agent every day. An agent team can execute it end to end: 14 milestones, 96 tasks, each with dependencies and acceptance criteria.

**For the team lead (main Claude session):**

1. Read this whole plan once, then the PRD sections *Packages and access*, *The teacher's agent*, *Functional requirements* and *Trust, safety and privacy*.
2. Treat **Tech stack** and **Core contracts** as fixed. Changing either needs an ADR in `docs/adr/` approved by a human.
3. Schedule tasks from **Milestones and tasks** in dependency order (the board, `docs/board/tasks.yaml`, tracks this); tasks with no shared dependency and no shared package can run in parallel on separate branches.
4. A task is done only when it meets its acceptance criteria, the **Definition of done**, and the merge gate.
5. Anything under **Open decisions** is a human call: stop and ask, don't guess.

**Build priority:** the harness first, as before. M0–M7 build and prove the teacher's agent, including the access filter, through a CLI and tests. The web surfaces (teacher studio, student app) start after the **harness exit gate**; payments (M10) can start once the data model exists.

## Scope and non-goals

**In scope (MVP):**

- The teacher's agent: turn pipeline, entitlement check, access-filtered retrieval, teaching policy and help ladder, skills, guardrails, learner memory, tracing.
- Knowledge ingestion: documents, slides, links and video files with transcription; course outline drafting; teacher style card; teacher corrections.
- Packages and entitlements: knowledge and skills per package, help limits, daily usage limits, live classes, prices, trials.
- Quality gate: platform and per-agent eval suites run before publish and after every change.
- Model gateway with Edmate-held provider keys, routing, metering and cost caps.
- Teacher studio, student app (phone and laptop), marketplace pages, payments and payouts, live classes by external link, weekly insights, trust and safety console.
- Country-neutral by design: currency, language, helplines, payments, tax and privacy rules come from **locale packs**; the pilot launches in one market.
- Docker Compose deployment for a pilot on one VM in the pilot market's region.

**Non-goals for this build:**

- Under-18 learners (PRD: proposed 18+ MVP), parent accounts.
- Native mobile apps, WhatsApp, built-in video calling.
- Hindi voice, reviews, coupons and bundles, teacher API and MCP (P1/P2).
- Simulations engine and code runner (P1).
- Fine-tuning or hosting our own models; AI-writing detection.
- School, classroom and facilitator features from v0.2.

## Tech stack (fixed)

One language (TypeScript) end to end, boring dependencies, everything in Docker Compose on one VM.

| Concern | Choice | Notes |
| --- | --- | --- |
| Language / runtime | TypeScript (strict), Node.js 22 LTS | `noUncheckedIndexedAccess` on |
| Monorepo | pnpm workspaces + Turborepo | Run as `corepack pnpm`; one lockfile |
| Web app | Next.js (App Router, current major), React Server Components | Student app, teacher studio, staff console in one app; mobile-first (360 px up) |
| UI | Tailwind CSS + shadcn/ui; next-intl (English now, Hindi strings from P1) | |
| Validation | Zod at every external boundary (API, webhooks, uploads, model JSON output) | Types inferred from schemas |
| Database | PostgreSQL 16 + pgvector; Drizzle ORM + drizzle-kit | Every teacher-owned row carries `teacher_id`; student data scoped by `student_id` |
| Queue / cache | Redis + BullMQ | Ingestion, transcription, insights, evals, payouts reconciliation, retention |
| Object storage | S3-compatible (MinIO locally; a bucket in the pilot market's region) | Uploads and transcripts; signed URLs only |
| Model access | Vercel AI SDK provider packages behind our own `gateway` interface | Edmate-held keys: Google, OpenAI, Anthropic, OpenRouter, OpenAI-compatible |
| Transcription | Provider speech-to-text behind a `Transcriber` port | See Open decisions |
| Auth | Auth.js: Google sign-in; phone OTP via an SMS provider | Roles: student, teacher, staff |
| Payments | A provider per market behind one `Payments` port (e.g. UPI AutoPay in India; a merchant of record that handles VAT/sales tax elsewhere); subscriptions and teacher payouts | See Open decisions |
| Locale packs | `content/locales/<market>.yaml`: languages, currency format, helplines, compliance, payment methods, PII patterns | See `locale-context` skill |
| Secrets | Provider keys and payment secrets from the environment / secret manager; never in the DB, logs or repo | Secret scan at edit, commit and CI |
| Streaming | Server-Sent Events from route handlers | Token stream + structured events |
| Calculator | mathjs, sandboxed | Numeric checks in feedback and grounding |
| Tests | Vitest, Playwright, eval runner (own package) | Model and payment calls mocked in unit tests |
| Observability | Turn traces in Postgres; Pino logs; optional OpenTelemetry | |
| Deploy | Docker Compose: web, worker, postgres, redis, minio, caddy | |
| Licence | Code MIT; teachers own their content | Decided 16 Oct 2026 |

## Repo layout

The harness stays a framework-free package that the web app and worker call; it never imports Next.js, the database, payment or provider SDKs, only the ports it is given.

```text
edmate/
  apps/
    web/                 Next.js: student app, teacher studio, staff console, API route handlers, webhooks
    worker/              BullMQ workers: ingestion, transcription, insights, evals, payouts, retention
    cli/                 `edmate` CLI: chat with an agent on a package, ingest a folder, run evals
  packages/
    contracts/           Zod schemas + TS types shared by all (Core contracts)
    harness/             Turn pipeline and teaching engine
      src/pipeline/      ordered steps, step runner, timeouts
      src/access/        entitlement resolution, allowed modules and skills (the access filter)
      src/pedagogy/      modes, help ladder, prompt-pack loader, style card
      src/skills/        practice, feedback, mock interview, revision, study plan
      src/roleplay/      persona engine for interview and viva skills
      src/tools/         tool registry + built-in tools
      src/guardrails/    pre/post guards
      src/memory/        learner profile updates
    gateway/             model gateway: provider adapters, routing, metering, caps
    ingest/              parsers, chunker, transcription adapter, outline drafter
    payments/            payment provider adapter, subscription state machine, ledger
    db/                  Drizzle schema, migrations, repositories (implement harness ports)
    evals/               eval runner, judges, reporters, per-agent suite generator
    ui/                  shared React components (chat, package cards, skill screens)
    config/              tsconfig, eslint, prettier presets
  content/
    prompt-packs/        platform system prompts per mode and skill, versioned (e.g. coach@1.0.0.md)
    skills/              skill definitions and persona templates (mock interview, viva)
    locales/             locale packs, one per market (human-verified helplines and compliance)
    demo-teacher/        an open-licensed sample course used in tests and the demo
  evals/
    suites/              leak/, locked/, safety/, accuracy/, persona/, pedagogy/, advice/ (YAML cases)
    fixtures/            recorded model responses for offline CI
  docs/adr/              architecture decision records
  docker/                compose.yaml, Caddyfile, env.example
```

**Ports and adapters:** `harness` defines ports (`EntitlementStore`, `ProfileStore`, `TranscriptStore`, `RetrievalIndex`, `CorrectionStore`, `UsageMeter`, `TraceSink`, `AlertSink`, `ModelGateway`); `db`, `gateway`, `ingest` and `worker` provide adapters. Tests use in-memory adapters from `harness/testing`.

## Core contracts

These types live in `packages/contracts` as Zod schemas. Task 0.3 creates them; changing one afterwards needs an ADR.

```ts
// ---- Teacher side ----
type Skill = 'explain' | 'coach' | 'practice' | 'feedback' | 'mock_interview' | 'revision' | 'study_plan' | 'project_coach';
type Lang = string;                 // BCP 47 primary tag, e.g. 'en', 'hi'; allowed set comes from locale packs
interface Money { amountMinor: number; currency: string }   // ISO 4217; formatted by the locale pack

interface AgentConfig {
  id: string; version: number; teacherId: string; courseId: string;
  styleCardId: string;              // teacher's voice, from the style interview
  promptPack: string;               // e.g. 'coach@1.0.0'
  languages: Lang[];
  regulatedSubject?: 'investing' | 'health' | 'law';
  modelPolicy: ModelPolicy;
}

interface PackageConfig {
  id: string; version: number; teacherId: string; agentId: string; name: string;
  moduleIds: string[];              // knowledge the agent may use
  skills: Skill[];                  // what the agent may do
  helpCeiling: 1 | 2 | 3 | 4;
  finalAnswers: 'never' | 'after_attempt' | 'allowed';
  dailyMessageLimit: number;
  liveClassesPerMonth: number;
  pricePerMonth: Money;             // amountMinor 0 = free package
  trialDays?: number;
  lockedReply: 'name_package' | 'generic';
}

// ---- Student side ----
interface Entitlement {             // derived server-side from the subscription; never from the client
  studentId: string; teacherId: string; market: string;   // ISO 3166 code of the student's locale pack
  packageId: string; packageVersion: number;
  status: 'trial' | 'active' | 'grace' | 'ended';
  periodEnd: string;
  allowedModuleIds: string[]; skills: Skill[];
}

// ---- A turn ----
interface TurnInput {
  agentId: string; sessionId: string; studentId: string;   // pseudonymous ids only
  kind: 'message' | 'hint_request' | 'check_answer' | 'skill_action';
  text?: string; skill?: Skill; attachments?: Attachment[];
  lang: Lang; clientTs: string;
}

type Intent = 'on_task' | 'answer_seeking' | 'off_topic' | 'distress' | 'misuse' | 'meta' | 'locked_request';

interface Chunk {
  id: string; teacherId: string; documentId: string; moduleId: string;
  text: string; source: { title: string; locator: string };   // page, slide or timestamp
}

interface TurnContext {
  agent: AgentConfig; pkg: PackageConfig; entitlement: Entitlement; profile: LearnerProfile; locale: LocalePack;
  history: Message[]; retrieved: Chunk[]; persona?: Persona;
  helpRung: 0 | 1 | 2 | 3 | 4; intent: Intent;
}

interface PedagogyDecision {
  move: 'ask' | 'hint' | 'worked_example' | 'explain' | 'solution' | 'redirect' | 'check' | 'locked' | 'not_covered';
  rung: 0 | 1 | 2 | 3 | 4;
  mustNotReveal: string[];
  systemPrompt: string; tools: ToolName[];
}

type TurnEvent =
  | { type: 'token'; text: string }
  | { type: 'sources'; items: { title: string; locator: string }[] }
  | { type: 'hint_rung'; rung: number }
  | { type: 'locked'; packageName?: string }
  | { type: 'safety'; level: 'info' | 'alert' }
  | { type: 'replace'; text: string }
  | { type: 'done'; messageId: string; usage: Usage }
  | { type: 'error'; code: ErrorCode; retryable: boolean };

// ---- Ports ----
interface RetrievalIndex {
  // The filter is required: there is no way to search a teacher's material without it.
  search(q: string, scope: { teacherId: string; allowedModuleIds: string[] }, k: number): Promise<Chunk[]>;
}
interface EntitlementStore { resolve(studentId: string, teacherId: string, at: string): Promise<Entitlement | null> }
interface ModelGateway {
  stream(req: ModelRequest): AsyncIterable<ModelChunk>;
  generateObject<T>(req: ModelRequest, schema: ZodType<T>): Promise<T>;
  embed(texts: string[]): Promise<number[][]>;
}
interface ModelPolicy { tiers: Record<'small' | 'main', { provider: string; model: string }> }
interface Tool<I, O> {
  name: ToolName; skill: Skill;      // the registry only offers tools whose skill is in the entitlement
  description: string; input: ZodType<I>; output: ZodType<O>;
  run(input: I, ctx: TurnContext): Promise<O>;
}
interface Guard {
  name: string; stage: 'pre' | 'post';
  check(x: { input?: TurnInput; draft?: string; ctx: TurnContext }): Promise<GuardResult>;
}
type GuardResult = { ok: true } | { ok: false; action: 'block' | 'rewrite' | 'escalate'; reason: string };
interface LearnerProfile {          // one per (student, teacher)
  studentId: string; teacherId: string; lang: Lang;
  mastery: Record<string, { p: number; n: number; updatedAt: string }>;   // topic id -> P(known)
  mistakes: { tag: string; count: number; lastSeen: string }[];
}
interface LocalePack {
  market: string; languages: Lang[]; currency: { code: string; format: string };
  helplines: { name: string; number: string; kind: string }[];
  compliance: { privacyLaw: string; minAge: number; dataRegion: string; grievance: string };
  regulatedDisclaimers: Partial<Record<'investing' | 'health' | 'law', string>>; piiPatterns: string[];
}
interface TraceSink { record(t: TurnTrace): Promise<void> }
interface AlertSink { raise(a: SafetyAlert): Promise<void> }
```

## Turn pipeline spec

Every student turn runs eleven steps in order inside `harness/pipeline`; each step is a pure function of `(input, ctx) → ctx` plus side effects through ports, with its own timeout. Total budget 20 s; first token within 2 s p95.

| # | Step | Does | Model tier | Timeout | On failure |
| --- | --- | --- | --- | --- | --- |
| 1 | `admit` | Auth, rate limit (10 turns/min/student) | — | 50 ms | `error` event; no model call |
| 2 | `entitle` | Resolve the entitlement server-side; refuse if none or ended; check the package's daily message limit | — | 50 ms | Fail closed: `error: no_access` or `limit_reached` |
| 3 | `preGuard` | PII scrub, moderation, jailbreak patterns | small | 1.5 s | Fail closed: safe message |
| 4 | `route` | Intent, including `locked_request` | small | 1.5 s | Default `on_task`; distress keywords still escalate |
| 5 | `escalate` | If distress: caring reply + helplines, `SafetyAlert` to the trust team, end turn | — | 200 ms | Alert retried until delivered |
| 6 | `buildContext` | Profile, trimmed history, **access-filtered retrieval**, style card, persona | — | 800 ms | Proceed without retrieval → `not_covered` path |
| 7 | `decide` | Teaching policy picks move, rung, `mustNotReveal`, prompt, and tools allowed by the entitlement | — (rules) | 50 ms | Fall back to `ask` |
| 8 | `generate` | Stream from main model, tool calls (max 3 rounds), cite sources | main | 15 s | One retry on fallback model; then apologetic error |
| 9 | `postGuard` | Answer leak, locked leak, grounding, advice, persona boundary, tone | small | 2 s | `rewrite` once; else safe reply |
| 10 | `meter` | Usage ledger row with teacher, package, student, tokens, cost (USD micro-units) | — | async | Queue; never blocks |
| 11 | `commit` | Persist message, update learner memory, write `TurnTrace` | — | async | Queue; never blocks |

**Streaming with post-guards:** sentence-sized chunks pass a cheap incremental leak check (answer and locked n-grams) before sending; the final post-guard runs on the whole reply before `done`; a failure sends `replace`.

**Cost controls:** small tier for steps 3, 4 and 9; prompt caching on system prompts and style cards; history summarised after 20 turns; daily message limit per package; monthly cost alarm per teacher.

**Determinism:** every step accepts an injected clock, id generator and gateway; `harness/testing` ships a scripted gateway that replays fixtures.

## Access filter (packages and entitlements)

Locked material must never reach the model; this is built in, not instructed. ADR-0003 records it.

1. **Entitlements are computed server-side** from the subscription (status, package version, period end). A package id sent by the client is never trusted.
2. **Retrieval is filtered in the query.** `RetrievalIndex.search` requires `allowedModuleIds`; the SQL applies `teacher_id = $1 AND module_id = ANY($2)` before ranking. There is no unfiltered search function in any package.
3. **Skills are filtered in the registry.** The orchestrator only receives tools whose `skill` is in the entitlement; the prompt lists only those skills.
4. **Caches are keyed by package version.** A cached context or prompt for one package is never reused for another.
5. **Locked requests get the teacher's chosen reply** (`lockedReply`), via the `locked` move and event.
6. **Defence in depth:** the `lockedLeak` post-guard checks the reply for n-gram overlap with the teacher's locked modules.
7. **Changes take effect on the next turn:** payment webhooks update the subscription; `entitle` reads it fresh each turn.
8. **Tests:** a property test (random entitlements → retrieved chunks ⊆ allowed modules); a locked-content eval suite of at least 200 adversarial cases with a target of zero leaks; per-agent locked cases generated at publish.

## Teaching engine

Teaching behaviour is decided by code and content, not left to the model: `decide` picks the move with rules; the prompt pack and style card tell the model how to carry it out.

### Help ladder (per package ceiling)

| From rung | Trigger | To rung | Move |
| --- | --- | --- | --- |
| 0 | New problem | 0 | `ask` |
| n | `hint_request`, intent `answer_seeking`, or 2 turns with no progress | min(n+1, helpCeiling) | 1 nudge · 2 conceptual hint · 3 worked example of a similar problem · 4 solution |
| any | Student shows a correct step | same | `ask` next step, specific praise |
| 3 → 4 | Only if `finalAnswers` is `allowed`, or `after_attempt` and an attempt is logged | 4 | `solution`, then a `check` |
| any | Problem solved | 0 | `check` (one transfer question) |

### Skills and modes

| Skill | Default move | Rules |
| --- | --- | --- |
| `explain` | `explain` then `check` | ≤ 150 words unless asked; cites sources; ends with one comprehension question |
| `coach` | `ask` | One question per reply; never states the answer below rung 4 |
| `practice` | `check` | Items from the teacher's bank, or generated to the topic and level; answer keys stay server-side |
| `feedback` | rubric feedback | Never rewrites the student's work for them; points to the rubric line |
| `mock_interview` | in-persona | Persona template + teacher's notes; `/pause` steps out for coaching; ends after N questions with a debrief |
| `revision` | summary | Notes and flashcards only from allowed modules, with sources |
| `study_plan` | plan | Weekly goals over allowed modules; adjusts to progress |
| `project_coach` | `ask` for evidence | Never produces the deliverable |

### Staying true to the teacher

- **Style card:** a ≤ 300-word summary of the teacher's examples, strictness, common warnings and phrasing, built from the style interview and sample explanations; the teacher can edit it.
- **Not covered:** if retrieval returns nothing above threshold, the move is `not_covered`: say so, offer to add the question to the next live class.
- **Corrections:** a teacher's correction is stored as a high-priority "teacher note" chunk in its module and as a permanent eval case.
- **Prompt packs:** composition order = safety preamble → mode/skill pack → style card → locale pack (language, formats, helplines) → decision block (`move`, `rung`, "do not say" list) → retrieved material with sources → learner summary. Any pack change bumps its semver and must pass the pedagogy, leak and locked suites.

## Knowledge ingestion and teacher studio pipeline

1. **Upload:** files go to object storage via signed URLs; each document records the teacher's rights declaration.
2. **Parse:** PDF, DOCX, slides, Markdown and web pages to text with locators (page, slide, heading). Video files go to the `Transcriber`, producing timestamped text.
3. **Outline:** the small model drafts modules → topics with links to source chunks (`generateObject`); the teacher edits; edits are versioned.
4. **Chunk and embed:** chunks are tagged teacher → course → module; embeddings plus full-text index; hybrid ranking.
5. **Style card:** a guided interview (about 10 questions) and 3 sample explanations → style card draft → teacher edits.
6. **Test and correct:** the teacher chats as a student on any package; corrections flow into chunks and evals.
7. **Publish:** the quality gate runs; pass → the agent and profile page go live.

Document states: `uploaded → parsed → transcribed → chunked → embedded → ready | failed`, shown live in the studio. Deleting a document removes its chunks from retrieval within 1 minute.

## Payments and subscriptions

- **Subscription states:** `trial → active → past_due (grace 3 days) → ended`, plus `paused`. One active package per (student, teacher); several teachers allowed.
- **Plan changes:** upgrade applies now (prorated); downgrade and cancel at period end; pause stops renewal and access.
- **Webhooks:** signature-verified, idempotent (event id stored), order-independent; they update subscriptions, and entitlements follow.
- **Ledger:** double-entry; every payment, refund, Edmate share and payout is a balanced entry; daily reconciliation against the provider.
- **Payouts:** on a schedule to the teacher's verified account; statements per period.
- **Providers per market:** each launch market picks a provider behind the `Payments` port (e.g. UPI AutoPay in India; a merchant of record that collects VAT/sales tax for global sales).
- **Invoices and tax:** per market (e.g. GST invoices in India); payout tax confirmed with an accountant in each market before launch.

## Model gateway

- **Keys:** Edmate-held provider keys from the environment / secret manager, only on provider tiers that do not train on inputs. Never logged, stored in the DB, or returned by any API.
- **Adapters:** Google, OpenAI, Anthropic, OpenRouter, OpenAI-compatible; each declares capabilities (`tools`, `json`, `embeddings`, `vision`, `maxContext`).
- **Routing:** `small` and `main` tiers; per-agent override; fallback model on 5xx, timeout or rate limit; models that fail the safety, leak or locked suites cannot be selected.
- **Metering:** every call writes a `usage_ledger` row (`teacher_id, package_id, student_id, model, tier, tokens, cost_micro_usd, turn_id`); `prices.yaml` holds USD per 1M tokens; dashboards convert to the package's currency to show cost per active student against price.

## Guardrails and safety

Guards are small, independent `Guard` objects: cheap rules first, then a small-model classifier only when rules are inconclusive. They fail closed.

| Guard | Stage | Method | Action on fail |
| --- | --- | --- | --- |
| `piiScrub` | pre | Generic patterns (phone, email, card, OTP-like numbers) plus the locale pack's patterns (e.g. Aadhaar-like, PAN); the student's own name | `rewrite` input before any model call |
| `distressDetect` | pre | Keywords per supported language (incl. romanised Hindi), then a classifier | `escalate`: caring template + helplines from the student's locale pack + alert to the trust team |
| `moderationIn` | pre | Provider moderation where available; else classifier with a fixed taxonomy | `block` with redirect; log `safety_event` |
| `jailbreak` | pre | Patterns + classifier for prompt injection, including "pretend I'm on another package" | `block`; strikes per student |
| `answerLeak` | post | Numbers and words vs `mustNotReveal`; fuzzy match; judge for paraphrase | `rewrite` once, then safe hint |
| `lockedLeak` | post | n-gram overlap with the teacher's locked modules for this student | `rewrite` without it |
| `grounding` | post | Claims checked against retrieved material; numbers recomputed | `rewrite` with corrections or `not_covered` |
| `adviceGuard` | post | Regulated subjects: personal investment, medical or legal advice | `rewrite` to concept-level teaching + disclaimer |
| `personaBoundary` | post | Persona `must_not` list for interview and viva skills | `rewrite` in persona |
| `tone` | post | No companion behaviour; never claims to be human or the teacher | `rewrite` |

**Alerts:** `SafetyAlert` → worker → trust team inbox and email, retried until acknowledged; unacknowledged after 15 min escalates to the on-call lead.

## Learner memory and progress

- **Topic map:** from the teacher's course outline (modules → topics → skills); validated for unknown ids and cycles.
- **Mastery:** Bayesian Knowledge Tracing per (student, teacher, topic), defaults `pInit 0.2, pLearn 0.15, pSlip 0.1, pGuess 0.2`, updated only from scored evidence (checks, practice items, rubric feedback).
- **Mistakes:** tags from the teacher's list of common mistakes, plus auto-proposed tags the teacher approves; never a tag outside the list.
- **Session summary:** ≤ 60 words at session end, used as context next time.
- **Student control:** view, reset and export what the agent remembers; every change audited.

## Data model

Postgres with Drizzle. Teacher-owned rows carry `teacher_id`; student rows carry `student_id`; repositories require the right scope. Student display names never go to models.

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | id, email?, phone?, name, locale, market, role, age_confirmed_at | Students, teachers, staff |
| `teacher_profiles` | user_id, slug, subject, bio, photo, languages, verification_status, payout_account_ref | Public profile |
| `consents` | user_id, kind, version, ts | Privacy notice, age, rights declarations |
| `courses` / `modules` / `topics` | teacher_id, ids, titles, order, outline_version | From the outline |
| `documents` / `chunks` | teacher_id, module_id, source, locator, text, embedding, tsvector, rights_declared_at | pgvector + full text |
| `style_cards` | teacher_id, version, text | Teacher's voice |
| `agents` / `agent_versions` | teacher_id, config JSON (AgentConfig), status (draft/live/suspended) | Immutable versions |
| `packages` / `package_versions` | teacher_id, config JSON (PackageConfig) | Immutable versions |
| `subscriptions` | student_id, teacher_id, package_version_id, status, period_end, provider_ref | One active per student × teacher |
| `payments` / `ledger_entries` / `payouts` / `invoices` | amount_minor + currency, provider refs, market | Double-entry ledger, one currency per entry |
| `webhook_events` | provider_event_id (unique), payload hash, processed_at | Idempotency |
| `sessions` / `messages` | student_id, teacher_id, agent_version, help_state, summary; message content | Retention job applies |
| `turn_traces` | session_id, steps JSON, model, tokens, cost_micro_usd | No keys, no names |
| `usage_ledger` | teacher_id, package_id, student_id, model, tier, tokens, cost_micro_usd | Caps and dashboards |
| `evidence_events` / `learner_profiles` | student_id, teacher_id, topic, correct, source | Mastery |
| `corrections` | teacher_id, question, bad_answer, corrected_answer, module_id | Also eval cases |
| `eval_runs` / `eval_results` | agent_version, suite, model, pass_rate | Quality gate |
| `live_classes` / `class_questions` | teacher_id, package ids, starts_at, link; questions | |
| `insights` | teacher_id, week, payload JSON | Aggregated, anonymised |
| `reports` / `takedowns` / `safety_events` | target, reason, status, staff actions | Trust console |
| `audit_log` | actor, action, target, before/after, ts | Config, staff and memory changes |

## API surface

Zod-validated route handlers under `apps/web/app/api`, plus SSE endpoints for turns.

| Method + path | Who | Purpose |
| --- | --- | --- |
| `GET /api/teachers` · `GET /api/teachers/:slug` | public | Discovery and teacher pages with packages |
| `POST /api/subscriptions` · `PATCH /api/subscriptions/:id` | student | Subscribe to a package; upgrade, downgrade, pause, cancel |
| `POST /api/sessions` · `POST /api/sessions/:id/turns` (SSE) | student | Start a session; send a `TurnInput`, stream `TurnEvent`s |
| `GET /api/me/progress` · `GET /api/me/export` · `DELETE /api/me` | student | Progress, export, delete |
| `POST /api/studio/uploads` · `GET /api/studio/documents` | teacher | Signed upload URLs; processing status |
| `GET/PUT /api/studio/outline` · `GET/PUT /api/studio/style-card` | teacher | Outline and style card |
| `POST /api/studio/test-chat` (SSE) · `POST /api/studio/corrections` | teacher | Test as a student on a package; correct answers |
| `GET/POST/PUT /api/studio/packages` | teacher | Package builder, with cost estimate |
| `POST /api/studio/publish` | teacher | Runs the quality gate, then publishes |
| `GET /api/studio/insights` · `GET /api/studio/earnings` | teacher | Weekly insights, earnings |
| `GET/POST /api/studio/live-classes` | teacher | Schedule live classes |
| `POST /api/webhooks/payments` | provider | Signed payment webhooks |
| `GET/POST /api/staff/verifications` · `/reports` · `/takedowns` · `/alerts` | staff | Trust console |

**Errors:** `{ error: { code, message, retryable } }` with codes `unauthorized, forbidden, not_found, validation, no_access, limit_reached, rate_limited, provider_error, guard_blocked, payment_required`.

**CLI parity (`apps/cli`):** `edmate ingest <folder> --teacher demo`, `edmate chat --agent <id> --package <id>`, `edmate eval <suite> --agent <id>`, `edmate gate <agent>`.

## Evals and the quality gate

Evals gate merges in CI on recorded fixtures, and gate every agent before it is published and after every change to its material, packages or style card.

| Suite | Size at M7 | Checks | Merge gate (fixtures) | Publish / live gate |
| --- | --- | --- | --- | --- |
| `leak` | 150 | Answers withheld under pressure, role claims, Hinglish | 100% | ≥ 98% |
| `locked` | 200 | Extracting other packages' material and skills | 100% | **0 leaks** |
| `safety` | 300 | Distress, harmful requests, jailbreaks, PII | 100% | 100% distress; ≥ 99% rest |
| `accuracy` | per agent ≥ 50 | Answers vs the teacher's material and question bank | 100% on platform cases | ≥ 99% |
| `persona` | 100 | Mock interview and viva stay in role, respect `must_not` | 100% | ≥ 97% |
| `pedagogy` | 150 | One question at a time, hints before answers, sources cited | ≥ 95% | mean ≥ 4/5 |
| `advice` | 100 | No personal investment, medical or legal advice | 100% | ≥ 99% |

**Per-agent suites:** generated at publish from the teacher's question bank, every correction, and auto-drafted questions the teacher approves, plus locked cases built from the agent's own packages.

**Judges:** a fixed judge model on an Edmate key scores rubric cases; 10% are double-checked by humans each release; judge-human agreement ≥ 85%.

**Fixtures:** `edmate eval --record` captures live responses; CI replays them, so PRs need no provider keys.

## Web surfaces (minimal)

Mobile-first (360 px up), laptop-friendly; English UI in the MVP.

| Surface | Screens | Must have |
| --- | --- | --- |
| Student app | Sign-up · Discover · Teacher page · Package compare + checkout · Chat · Practice · Feedback · Mock interview · Progress · Plan · Live classes | Streaming chat with markdown, maths and code; sources; hint button with rung; locked notice; photo upload of written work |
| Teacher studio | Onboarding · Uploads · Outline · Style card · Test chat + corrections · Package builder · Publish + gate results · Profile · Insights · Earnings · Live classes | Live processing status; preview as a student per package; AI cost estimate per package |
| Staff console | Verifications · Reports · Takedowns · Regulated-subject review · Safety alerts · Audit | Every action audited |
| Public | Landing · Teacher pages · Privacy notice · Grievance officer · Terms | Server-rendered teacher pages for search |

## Milestones and tasks

96 tasks in 14 milestones. M0–M7 build and prove the agent; the **harness exit gate** must pass before M8 and M9 start. M10 (payments) can start once the data model exists. Task IDs are stable for branches (`m5/5.4-access-filter`) and PRs.

### M0 · Foundations (depends on: none)

- **0.1** Monorepo scaffold: pnpm, Turborepo, strict tsconfig, eslint, prettier, Vitest. *Accept:* `corepack pnpm build && corepack pnpm test && corepack pnpm lint` green on empty packages.
- **0.2** Docker Compose (postgres+pgvector, redis, minio, caddy, web, worker) and `env.example`. *Accept:* `docker compose up` serves `/api/health` = 200 and a test file round-trips through MinIO.
- **0.3** `packages/contracts`: every type in Core contracts as Zod. *Accept:* sample fixtures round-trip parse/serialize.
- **0.4** ADR template; ADR-0001 stack, ADR-0002 ports and adapters, ADR-0003 access filter by construction. *Accept:* files merged.
- **0.6** Dev container (`.devcontainer/`): Node 22 with corepack pnpm, Docker access for Compose, Claude Code, Python 3 with PyYAML, jq; `git config core.hooksPath .githooks` on create. *Accept:* the container builds; `corepack pnpm test` and `python3 .githooks/secret-scan.py --all` pass inside it; the same setup works on the devbox (`docs/setup/devbox.md`).
- **0.5** GitHub Actions: CI, secret scan, merge-gate check (verifies the `human-approved` label came from the owner), risk labeller; PR template. *Accept:* CI blocks a failing test; the merge-gate check fails a risky PR without the owner's label.

### M1 · Data, accounts and auth (depends on: M0)

- **1.1** Drizzle schema for every table in Data model; migrations. *Accept:* migrate up/down clean; teacher-owned tables indexed on `teacher_id`.
- **1.2** Repositories scoped by teacher and by student. *Accept:* cross-teacher and cross-student reads and writes fail closed in tests.
- **1.3** Auth.js Google sign-in; roles student, teacher, staff; RBAC middleware. *Accept:* role × route matrix tests pass.
- **1.4** Phone OTP sign-in via the SMS provider adapter. *Accept:* sandbox login works; OTP requests rate-limited per number and IP.
- **1.5** Seed: demo teacher with an open-licensed course, two packages, 20 students with mixed subscriptions. *Accept:* `corepack pnpm seed` idempotent.
- **1.6** Audit log helper. *Accept:* config, staff and memory changes write before/after rows.
- **1.7** Age and consent per locale pack (MVP 18+ everywhere): confirmation at sign-up, privacy notice, consent records. *Accept:* a user who does not confirm 18+ cannot create an account; consent versions stored.

### M2 · Model gateway (depends on: M0, 1.1)

- **2.1** Provider keys from the environment / secret manager. *Accept:* a log-scan test proves no key appears in logs, traces or API responses.
- **2.2** Adapters: Google, OpenAI, Anthropic, OpenRouter, OpenAI-compatible, with capabilities. *Accept:* shared adapter contract tests (stream, tool call, JSON, embed) pass on fixtures.
- **2.3** Router: tiers, per-agent override, fallback. *Accept:* a simulated 5xx fails over within one retry.
- **2.4** Metering: `usage_ledger` per call with teacher, package and student; `prices.yaml`. *Accept:* one ledger row per call; cost per active student report matches the rows.
- **2.5** Limits: package daily message limit, monthly cost alarm per teacher. *Accept:* the limit returns `limit_reached` with a friendly message; the alarm fires at the threshold.
- **2.6** Scripted gateway in `harness/testing`. *Accept:* replays fixtures deterministically.
- **2.7** Transcriber and embedding adapters. *Accept:* a 60-minute audio fixture transcribes through the scripted adapter; a live smoke test runs behind `--live`.

### M3 · Harness core (depends on: M0, 2.6)

- **3.1** Pipeline runner: eleven ordered steps, timeouts, injected clock and ids, trace capture. *Accept:* tests for each failure policy in the Turn pipeline table.
- **3.2** `admit` and `entitle`: rate limit, server-side entitlement, daily limit. *Accept:* each rejection returns its code; an ended subscription is refused; client-sent package ids are ignored.
- **3.3** `route`: intent classifier including `locked_request`. *Accept:* ≥ 90% accuracy on 200 labelled English, Hindi and Hinglish turns.
- **3.4** `buildContext`: history trim, summaries, access-filtered retrieval via the port, style card, persona. *Accept:* never exceeds model context; retrieval cannot be called without `allowedModuleIds` (type-checked).
- **3.5** Teaching policy: help ladder, skill rules, per-package limits, `locked` and `not_covered` moves. *Accept:* table-driven tests cover every transition.
- **3.6** Prompt-pack loader and composer with semver, style card and sources. *Accept:* snapshot tests of composed prompts per skill.
- **3.7** Orchestrator: streaming, tool calls (max 3 rounds), SSE events incl. `sources`, `locked` and `replace`. *Accept:* an integration test streams a full turn via the scripted gateway.
- **3.8** `meter` and `commit` via the worker queue. *Accept:* reply latency unaffected when the DB is slow (injected delay).
- **3.10** Locale packs: schema, loader and validation; a safe default pack; the first pack for the pilot market with human-verified helplines and compliance. *Accept:* `edmate content validate` fails on missing fields; an unknown market falls back to the default pack and still raises safety alerts.
- **3.9** CLI `edmate chat --agent --package`. *Accept:* a full session with the demo teacher runs in a terminal with a real key.

### M4 · Guardrails and safety (depends on: 3.1)

- **4.1** Guard framework and registry. *Accept:* guards run in declared order and fail closed.
- **4.2** `piiScrub`. *Accept:* 100% on the PII set.
- **4.3** `distressDetect`, escalate, alert worker with acknowledgement and 15-min escalation. *Accept:* 100% of distress cases escalate; alert delivered < 5 min in an integration test.
- **4.4** `moderationIn`, `jailbreak`, strikes. *Accept:* safety suite meets its gates.
- **4.5** `answerLeak` (incremental + final) and the rewrite loop. *Accept:* leak suite 100% on fixtures.
- **4.6** `lockedLeak` post-guard. *Accept:* locked suite 100% on fixtures.
- **4.7** `grounding` with calculator recompute and the `not_covered` path. *Accept:* accuracy suite gates; ≥ 95% of uncovered questions answered as not covered.
- **4.8** `adviceGuard` for regulated subjects. *Accept:* advice suite gates.
- **4.9** `personaBoundary` and `tone`. *Accept:* persona suite gates; no reply claims to be human or the teacher.

### M5 · Knowledge, access filter and skills (depends on: M3)

- **5.1** Document ingestion: PDF, DOCX, slides, Markdown, web links → text with locators. *Accept:* a 20-file fixture set parses; every chunk keeps its page, slide or heading.
- **5.2** Video ingestion: upload → transcription → timestamped chunks. *Accept:* the 60-minute fixture is searchable within the 15-minute budget.
- **5.3** Chunking, embeddings, full-text fallback, hybrid ranking; chunks tagged teacher → course → module. *Accept:* recall@5 ≥ 0.8 on the demo Q&A set, with and without embeddings.
- **5.4** Access filter: filtered `RetrievalIndex.search`, entitlement-filtered tool registry, package-versioned caches. *Accept:* property test (random entitlements → results ⊆ allowed modules); no unfiltered search exists anywhere.
- **5.5** Tool registry and sandboxed calculator. *Accept:* fuzz test shows no access outside declared scope.
- **5.6** Practice skill: item selection and generation by topic and level, scoring. *Accept:* items map to the outline's topics; answer keys never reach the client.
- **5.7** Feedback skill: rubric feedback on answers, essays and code (no execution). *Accept:* ≥ 70% agreement with the demo teacher's scores on 30 samples.
- **5.8** Role-play engine for mock interview and viva: persona templates, `/pause`, end conditions, debrief. *Accept:* persona suite on fixtures.
- **5.9** Revision and study-plan skills. *Accept:* notes cite sources; plans only cover allowed modules.

### M6 · Learner memory and progress (depends on: M3, 5.6)

- **6.1** Topic map from the course outline, with validation. *Accept:* unknown or cyclic references rejected.
- **6.2** Evidence events, BKT mastery per (student, teacher, topic), rebuild. *Accept:* matches hand-computed values to 3 decimals.
- **6.3** Mistake tagging from the teacher's list, plus proposed tags the teacher approves. *Accept:* never emits a tag outside the list.
- **6.4** Session summary and end-of-topic check. *Accept:* summary ≤ 60 words; the next session uses it.
- **6.5** Student view, reset and export of memory. *Accept:* reset clears the profile and writes an audit row.

### M7 · Evals and the quality gate (depends on: M3, M4, 5.4)

- **7.1** Eval runner: YAML multi-turn cases, judges, JSON + HTML reports, `--record` / replay. *Accept:* runs offline in CI.
- **7.2** Platform suites to target sizes, each case human-reviewed. *Accept:* counts per the Evals table; reviewer recorded per case.
- **7.3** Per-agent suite generator from the question bank, corrections, approved drafts and the agent's packages. *Accept:* the demo teacher gets ≥ 50 accuracy cases and ≥ 30 locked cases.
- **7.4** Quality gate: runs on publish and on every agent, package, material or style-card change; blocks publish on failure. *Accept:* a deliberately bad agent cannot publish.
- **7.5** CI merge gates on fixtures. *Accept:* a deliberately leaky prompt pack fails CI.
- **7.6** Live model runs and per-model pass rates. *Accept:* a report per configured model and suite.
- **7.7** Turn traces and health metrics. *Accept:* p50/p95 latency, error and guard rates computed from traces.

**Harness exit gate:** the demo teacher's agent, with a Free and a paid package, passes every suite live on at least two providers (one low-cost), with zero locked-content leaks; a recorded CLI demo shows explain → practice → feedback → mock interview → a locked request refused → upgrade → the same request answered.

### M8 · Teacher studio (depends on: GATE, 1.3, 5.1, 5.2)

- **8.1** Onboarding: profile, subject, bio, photo, identity verification and payout account hand-off. *Accept:* an unverified teacher cannot publish.
- **8.2** Upload centre with live processing status, delete and replace. *Accept:* status updates live; a deleted file leaves retrieval within 1 minute.
- **8.3** Outline editor with source links; reorder, rename, merge, split. *Accept:* outline for 20 files in < 10 minutes; edits versioned.
- **8.4** Style interview and style card editor. *Accept:* the teacher can preview and edit the card; the agent uses the new version on the next turn.
- **8.5** Test chat as a student per package; mark and correct answers. *Accept:* a correction changes the next answer and becomes an eval case.
- **8.6** Package builder: modules, skills, help limits, daily limit, live classes, price, trial, locked reply, AI cost estimate. *Accept:* two packages in < 15 minutes; estimate shown per package.
- **8.7** Publish flow with quality-gate results and the public profile page. *Accept:* failures show which cases failed; a pass publishes in < 1 minute.
- **8.8** Insights and earnings views. *Accept:* earnings match the ledger; insights show no individual student.

### M9 · Student app (depends on: GATE, 1.3, 1.7)

- **9.1** App shell, mobile-first layouts (360 px up), next-intl, auth. *Accept:* Lighthouse accessibility ≥ 95 at 360 px.
- **9.2** Discovery and teacher pages (server-rendered). *Accept:* search < 1 s on a 1,000-teacher seed.
- **9.3** Package compare, free package start, checkout. *Accept:* the package unlocks on the next message after payment.
- **9.4** Chat: SSE, markdown, maths and code, photo upload, sources, hint button with rung, locked notice. *Accept:* component tests + e2e.
- **9.5** Skill screens: practice, feedback submission, mock interview. *Accept:* e2e per skill.
- **9.6** Progress, plan changes (upgrade, downgrade, pause, cancel) and export. *Accept:* export is complete JSON plus notes PDF.
- **9.7** E2E: discover → free package → subscribe → learn → locked request → upgrade → unlocked. *Accept:* green in CI with scripted gateway and payment sandbox.

### M10 · Payments and payouts (depends on: M1, 2.4)

- **10.1** Payment provider adapter for the pilot market behind the `Payments` port (e.g. UPI AutoPay mandates and cards in India), teacher linked accounts. *Accept:* provider sandbox flows pass; a second provider can be added without changing callers.
- **10.2** Signed, idempotent, order-independent webhooks → subscriptions → entitlements. *Accept:* replayed and out-of-order webhooks end in the correct state.
- **10.3** Subscription state machine: trial, active, past due with grace, paused, ended; prorated upgrades. *Accept:* table-driven state tests.
- **10.4** Double-entry ledger, revenue share, daily reconciliation. *Accept:* reconciles with sandbox reports; every entry balances.
- **10.5** Teacher payouts and statements. *Accept:* payout amounts equal ledger balances.
- **10.6** Refunds and tax invoices per market (e.g. GST in India). *Accept:* one invoice per payment; a refund updates the ledger and the entitlement.

### M11 · Live classes and insights (depends on: 9.1, 8.1, M6)

- **11.1** Schedule live classes with an external link, attach to packages, invites and reminders (24 h and 1 h). *Accept:* only entitled students receive the link.
- **11.2** Pre-class question queue, fed by students and by the agent's "ask your teacher" handoffs. *Accept:* questions grouped by topic for the teacher.
- **11.3** Weekly insights worker: top questions, sticking topics, unhelpful answers; aggregated with a minimum group size of 5. *Accept:* generated Monday 07:00 IST; no student identifiable.
- **11.4** Live-class recording ingestion into the agent's knowledge (P1). *Accept:* searchable within 15 minutes.

### M12 · Trust and safety console (depends on: 1.6, 4.3)

- **12.1** Staff console with teacher verification queue. *Accept:* approve/reject audited; unverified teachers stay unpublished.
- **12.2** Report button, review queue and takedown of material or agents. *Accept:* a report reaches staff < 5 minutes; a takedown removes material from retrieval at once.
- **12.3** Rights declaration per upload, repeat-infringer handling, grievance contact per market (e.g. IT Rules 2021 in India). *Accept:* a declaration is stored per document; the page is public.
- **12.4** Regulated-subject review before publish. *Accept:* flagged agents cannot publish without staff approval.
- **12.5** Safety alert inbox with acknowledgement. *Accept:* unacknowledged alerts escalate after 15 minutes.

### M13 · Hardening and pilot (depends on: M8, M9, M10, M11, M12)

- **13.1** Accessibility: axe in CI and a manual WCAG 2.2 AA pass. *Accept:* no serious violations.
- **13.2** Load test: 500 concurrent students. *Accept:* first token p95 < 2 s with the scripted gateway.
- **13.3** Security review: teacher and student isolation, entitlement bypass attempts, webhooks, OWASP Top 10, dependency audit. *Accept:* no high findings open.
- **13.4** DPDP: per-user export and delete, retention jobs. *Accept:* jobs tested; export complete.
- **13.5** Cost dashboard: AI cost per active student per package against price. *Accept:* numbers match the usage ledger.
- **13.6** Deploy guide for the pilot market's region, backups and restore, pilot readiness checklist. *Accept:* fresh VM to running demo in < 30 minutes; checklist signed off by a human.

## Agent operating rules and definition of done

These rules let many agents work in parallel without breaking each other's work or the product's promises.

### Rules

1. **One task, one branch, one PR.** Branch `m<milestone>/<task-id>-<slug>`; PR title starts with the task ID.
2. **Contracts are frozen.** Never change `packages/contracts`, the Tech stack, or a prompt pack's behaviour without an ADR approved by a human.
3. **Harness stays pure.** `packages/harness` must not import Next.js, Drizzle, Redis, payment or provider SDKs; only ports. A hook and a lint rule enforce it.
4. **No real model or payment calls in unit or CI tests.** Use the scripted gateway, payment sandbox fixtures and recorded responses. Live calls only in `--live` runs with keys from the environment.
5. **Never log or persist secrets or raw student content** outside `messages`. No student names in prompts. The repo is public: never commit credentials, keys, real student data, teacher uploads or personal details; the secret scan blocks them at edit, commit and CI.
6. **Risky changes need a human; everything else the team lead merges.** A PR touching a path in `.claude/skills/merge-gate/risk-paths.txt` (guardrails, the access filter, payments and webhooks, prompt packs, persona templates, contracts, ADRs, keys, sign-in, data isolation, harness and CI config), or a migration that drops or deletes data, needs the human's `human-approved` label. All other PRs are merged by the team lead once the merge gate passes (rule 11).
7. **Platform content and eval cases are reviewed by people.** Agents may draft prompt packs, skill and persona templates, and eval cases; a named human signs off before merge (`reviewed_by`). Teachers own and review their own course material.
8. **Ask, don't guess.** If a spec is ambiguous or conflicts with another section, the team lead asks the human (or opens a `needs-human` issue) and the agent picks another task.
9. **Small PRs.** Aim for < 600 changed lines excluding fixtures.
10. **Keep the docs current.** Update the relevant README and the board when a task merges.
11. **Merge gate.** Before merging, the team lead checks: the required reviews ran; every CRITICAL and HIGH finding is fixed and re-verified; MEDIUM and LOW findings are fixed, deferred to a board task, or logged as won't-fix; CI and eval gates are green; `merge_gate.py` passes. GitHub Actions re-checks this on the PR.
12. **Log decisions.** Any decision the spec did not make goes in the task handoff's `## Decisions` section in plain words; the team lead copies it to `docs/decisions/log.md` on merge.

### Definition of done (every task)

- [ ] Acceptance criteria met and demonstrated in the PR description.
- [ ] Unit tests added; coverage of new code ≥ 80% (100% for `access/`, guard logic and the subscription state machine).
- [ ] Typecheck, lint, tests and relevant eval gates green in CI.
- [ ] No new `any`; all external inputs Zod-validated.
- [ ] User-facing strings through next-intl.
- [ ] Accessibility checked for any UI change (keyboard + axe), at 360 px and laptop width.
- [ ] Traces and errors emitted per Observability.
- [ ] Docs/ADR updated if behaviour or structure changed.
- [ ] Reviewed by the required agents; merge gate passed (rule 11); human approval where rule 6 or 7 applies.
- [ ] Decisions recorded in the handoff (rule 12), or `None`.

## Open decisions

Agents should not decide these; each blocks the tasks listed until a human answers. Decided items keep their date.

| Decision | Options | Recommendation | Blocks |
| --- | --- | --- | --- |
| Code licence | **Decided: MIT** (16 Oct 2026) | — | — |
| Repo host | **Decided: public GitHub repo; agents use a private GitHub App** (16 Oct 2026) | — | — |
| Minimum learner age | 18+ only · also 13–17 with parental consent | 18+ for the MVP | 1.7 |
| Pilot market | Where the 20 anchor teachers are (e.g. India, or global English) | Decide in the Validate phase | 3.10 (first pack), 10.1, 13.6 |
| Payment provider (pilot market) | India: Razorpay · Cashfree · Stripe India; global: a merchant of record (handles VAT/sales tax) | Subscriptions + split payouts to teachers; compare fees | 10.1, 8.1 |
| Revenue share and floor price | Edmate % of each subscription; minimum package price | Decide after cost data from 7.6 | 10.4, 8.6 |
| SMS / OTP provider | Indian SMS gateway · global provider · Firebase Auth | Any with Indian DLT-compliant delivery | 1.4 |
| Transcription | Provider speech-to-text (OpenAI, Google) · self-hosted Whisper | Provider API for the MVP | 2.7 |
| Moderation | Classifier only · self-hosted Llama Guard · provider moderation | Provider moderation where available, classifier otherwise | 4.4 |
| Judge model | Fixed judge on an Edmate key | One mid-tier model, pinned per release | 7.1 |
| Default model mix | Per tier, by cost and eval results | Decide after 7.6 | 8.6 |
| Teacher view of conversations | Aggregated insights only · students may opt in to share | Aggregated by default; opt-in sharing | 11.3 |
| Refund policy | Pro-rata · first 7 days full · none | First 7 days full refund | 10.6 |
| Hosting region | A cloud region in the pilot market | Follows the pilot market's data rules | 13.6 |
| Pilot subjects and anchor teachers | Coding · exam prep · languages · professional skills | Pick 1–2 subjects with 20 committed teachers | GATE (pilot readiness) |
