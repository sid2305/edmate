# 4.0 plan — seed eval suites: ≥ 30 human-reviewed cases per guard

## Acceptance (verbatim)
> cases validate; reviewer recorded per case.

**How it will be shown:** `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...` is green, including a new `packages/evals/src/suites.test.ts` that calls `loadCasesFromDir` on every real folder under `evals/suites/` (not the package's own synthetic fixtures), asserts every case parses against `EvalCaseSchema`, every case has `reviewed_by` that is not the literal string `pending`, and each of the 9 guard folders has ≥ 30 cases. The human review step is shown by `docs/tasks/4.0/review-sheet.md`: one row per guard (not per case) — case count, language split, two sample case ids, and a sign-off line the repo owner (siddhantlahoti) initials per guard, so they read a ~10-row sheet instead of 270+ files. `reviewed_by` in the YAML is filled from that sign-off before merge.

## What exists already (checked)
- `evals/suites/{accuracy,advice,leak,pedagogy,persona}/` have only a `.gitkeep`; **`locked/` and `safety/` don't exist yet.**
- `packages/evals` (3.12) is a library only — schema, loader, runner, recorder, judge — with no CLI and no wiring to the real `evals/suites/` directory. Nothing currently loads those folders.
- `content/locales/` is **empty**; task 3.10 (locale pack schema + the first verified pack) is still `todo`. The only "fictional, not routable" helpline is `packages/contracts/fixtures/valid/locale.ts`'s test fixture — not usable as a real distress-case helpline.
- The PRD already names a real helpline: "a caring reply with helplines from the student's market (for example Tele-MANAS 14416 in India)" (`docs/edmate-prd.md`, Wellbeing row). This is spec-given, not invented.
- Demo course (1.8): 5 modules (`values-variables`, `conditions`, `loops`, `functions`, `lists-dicts`); `free` package = first two modules only (`content/demo-teacher/packages/free.yaml`), so `loops`/`functions`/`lists-dicts` are the locked modules for a free-package student — the material for `locked` cases. `qa-recall.yaml` and the question banks give real, specific answers (e.g. "5/6"-style single values, not the archived course's "₹24,000") to use as realistic `mustNotReveal` targets for `leak` cases — the "24,000 / 24 hazaar / Devanagari digits / translation / base64 / role-play" line in `docs/tasks/3.6/safety-review.md` is a list of **test forms** to apply to the demo course's own numbers, not a literal number to reuse.
- Build plan's suite-folder list (§ Repo layout) is `leak/, locked/, safety/, accuracy/, persona/, pedagogy/, advice/` — 7 folders for 9 guards named in 4.0's title. `accuracy` and `grounding` are not the same scope: `accuracy` (per-agent ≥ 50, generated at publish from the question bank) is 5.10/7.2 work; `grounding` is guard 4.7's own seeded suite. See open question 1.

## Files to create (eval-author, then builder)
- `evals/suites/safety/pii/*.yaml` (≥ 30)
- `evals/suites/safety/distress/*.yaml` (≥ 30)
- `evals/suites/safety/moderation/*.yaml` (≥ 30)
- `evals/suites/safety/jailbreak/*.yaml` (≥ 30)
- `evals/suites/locked/*.yaml` (≥ 30)
- `evals/suites/leak/*.yaml` (≥ 30, into the existing empty folder)
- `evals/suites/advice/*.yaml` (≥ 30, into the existing empty folder)
- `evals/suites/persona/*.yaml` (≥ 30, into the existing empty folder)
- `evals/suites/grounding/*.yaml` (≥ 30, new folder — open question 1)
- `packages/evals/src/suites.test.ts` (builder only): generic, discovers `evals/suites/*/` by `readdirSync`, skips any directory with only `.gitkeep`, otherwise loads and validates it and asserts the ≥ 30 / `reviewed_by` rules above. One file, written once; every eval-author PR after it just adds YAML, no code change needed.
- `docs/tasks/4.0/review-sheet.md` (team lead, from eval-author's returns)
- `docs/decisions/log.md` — append entries for the two open questions below, once answered, at merge.

Every case file follows `eval-author.md`'s format: `reviewed_by: pending` until sign-off, `source` citing a build-plan line, PRD line or a `content/demo-teacher/` file, `package: free | full`, checks under `expect` (prefer `must_contain` / `must_not_contain` / `matches` / `must_cite_source`; `judge` only when a string check can't say it). Language mix per suite: ~50% English, 30% Hinglish/romanised Hindi, 20% Devanagari, per `locale-context`.

## Files out of bounds
- `packages/evals/src/{schema,loader,runner,recorder,judge,checks}.ts` — 3.12's frozen behaviour; no changes needed or allowed here.
- `packages/harness/src/guardrails/**` — guards 4.1–4.9 don't exist yet; this task only seeds cases they will later run against.
- `content/locales/**` — 3.10's job; no locale-pack file is written here, cases only cite the PRD's example helpline.
- `content/demo-teacher/**` — read-only source material for `source:` citations.

## Tests first
`packages/evals/src/suites.test.ts` is written first and is red (folders missing / `reviewed_by: pending` / under 30 per guard). Each eval-author sub-PR turns one block of it green by adding that guard's YAML. No fixtures are recorded and no guard code runs: 4.0's accept line is schema validation + reviewed sign-off only. Running cases against the real pipeline with record/replay fixtures is each guard task's own job (4.2–4.9, each "100% on fixtures"/"on the seeded … cases"), since most of those guards don't exist yet — this is the "which suites can run now" split the task asked about: **none run end-to-end in 4.0; all nine validate structurally in 4.0.**

## Risky paths touched (checked against risk-paths.txt)
- `evals/suites/safety/**` → reviewers: safety-reviewer (plus `docs/tasks/4.0/safety-review.md`, risk: high decision entry).
- `evals/suites/locked/**` → reviewers: safety-reviewer (same safety-review.md covers both, see sub-PR split).
- `evals/suites/{leak,advice,persona,grounding}/**`, `packages/evals/src/suites.test.ts`, the review sheet: not in risk-paths.txt — ordinary review.

## Sub-PRs
1. **4.0a (risky)** — `evals/suites/safety/{pii,distress,moderation,jailbreak}/` + `evals/suites/locked/`. eval-author on **opus** (safety/locked per the task). Needs safety-reviewer + `docs/tasks/4.0/safety-review.md` + a `risk: high` decision entry.
2. **4.0b (not risky)** — `packages/evals/src/suites.test.ts` (builder, sonnet) + `evals/suites/{leak,advice,persona,grounding}/` (eval-author, sonnet). Ordinary review (code-reviewer/typescript-reviewer for the test file).
Land 4.0b first so the validation harness exists before 4.0a's safety-critical content is reviewed against it.

## Open questions
1. **Where do grounding cases live?** Build plan's folder list has no `grounding/`. *Recommend:* add `evals/suites/grounding/` (1:1 with guard 4.7, distinct from the per-agent `accuracy` suite) and a one-line addition to build plan § Repo layout. Alternative: fold into `accuracy/`.
2. **Distress helpline source, with no locale pack yet (3.10 still `todo`).** *Recommend:* India-market distress cases cite `docs/edmate-prd.md`'s own example, Tele-MANAS 14416, as `source`; locale-agnostic cases use `locale-context`'s rule-4 fallback wording (local emergency services + a trusted person, no number) and still assert the alert is raised. Re-check these cases' wording once 3.10's real pack lands.
3. **Safety sub-suite depth** (`safety/pii/` etc. vs four flat top-level folders). *Recommend:* subfolders, so risk-paths.txt's one glob still covers all four and the guard-size table's single "safety: 300" row still maps to one suite.

## Decisions to log on merge
- `risk: high` entries for 4.0a (safety/locked content).
- The grounding-folder and distress-helpline-sourcing decisions above, once the team lead/human picks.

## Lead answers (18 Oct 2026)

- Q1: add `evals/suites/grounding/` (1:1 with guard 4.7).
- Q2: India-market distress cases cite the PRD's named example (Tele-MANAS, 14416); locale-agnostic cases use the generic fallback wording with no number. Mark every helpline expectation "re-verify when 3.10 lands" in the case notes.
- Q3: apply the leak forms to the demo course's own answers.
- Order: 4.0b first (suite test + leak/advice/persona/grounding), then 4.0a (safety/ + locked/, risky). Same branch per sub-PR: `m4/4.0b-suites`, `m4/4.0a-safety-suites`.
- Reviewer per case: `reviewed_by: pending` until the human signs the review sheet; the lead sets `sid2305` after sign-off.
