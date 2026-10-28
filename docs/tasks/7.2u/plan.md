# Plan: 7.2u — safety to 300, persona to 100, advice to 100 (7.2 Phases N, O and P)

Status: READY (written by the lead, 27 Oct 2026)

## Why now
B-41 (human, 22 Oct 2026): the remaining eval cases land before the pilot gate. This is the last suite group from the old 7.2f split, after 7.2s (pedagogy 150) and 7.2t (leak 150).

## Shared plan
`docs/tasks/7.2/plan.md` stays the plan of record. Read its "Pinned counts", "How CI and the merge gate treat new cases with no recorded fixture", Phases E, F and G (the mixes), "Phases H-P", "Tests first", "Risks" and "Lead answers". Each phase also reads the handoff of its MVP phase for the fixture shapes and lessons: Phase N `docs/tasks/7.2d/handoff.md`; Phases O and P `docs/tasks/7.2e/handoff.md`.

## Phases
Each phase is a fresh builder on the same branch, in this order (safety first: it matters most for the pilot gate). Each starts from the previous phase's handoff section. The lead runs code-reviewer after each phase.

### Phase N: safety to 300; about 110 calls
Count the safety cases the suite loader sees today (`SUITE_FLOORS.safety` is 258; the file count may differ) and add enough to reach 300 (about 42). Phase E's mix, scaled, with new wordings only:
- generic distress, US-framed: school, college applications, family, slang, delayed disclosure over several turns (about 12), in `safety/distress/generic`
- distress near-misses with US school idioms (about 7)
- jailbreak: many-shot, injection in pasted code or JSON, story framing, fake tool output, other forms not yet covered (about 9)
- moderation: weapons at school, vapes and drugs, paying someone to take an exam (about 7)
- PII: US phone shapes, email, test card, one-time code (about 7). No SSN case (that is task 1.7h).
Then the pins in `distressEscalate.test.ts`, `moderationJailbreak.test.ts` and `piiScrubPipeline.test.ts` (see 7.2d's "Pinned fixture/config edits"), and `SUITE_FLOORS.safety` at 300 in `suites.ts` and `suites.test.ts`. Nothing goes in `safety/distress/in` (India, parked for the US pilot).

### Phase O: persona 60 to 100; about 90 calls
Phase G's mix: role-play on both the viva and job-interview templates (about 18) and identity and boundary, US-framed (about 22), with forms Phase G did not use. Then the `EXPECTED` / `GOOD` / `BAD` entries in `rolePlayFixtures.test.ts` and `SUITE_FLOORS.persona` at 100.

### Phase P: advice 60 to 100; about 90 calls
Phase F's mix, US-framed: investing (10), tax (10), medical (10), legal (10), with angles Phase F did not use. Then the `SPECS` entries in `adviceFixtures.test.ts`, the pins and `SUITE_FLOORS.advice` at 100. Check that `SUITE_FLOORS` equals every target (leak 150, locked 200, safety 300, persona 100, pedagogy 150, advice 100).

## Rules for every case (7.2c, 7.2f, 7.2s and 7.2t lessons)
- English only, US-framed (English-only pilot). No new `-hi-latin`, `-deva` or Hinglish files; the existing ones stay unchanged.
- `reviewed_by: lead`, with the `source:` line the existing cases in that suite use.
- No helpline numbers, crisis-line names, contacts or real people's or schools' names in any case or expected text. Distress cases check the escalation behaviour, never a specific number.
- Before writing, script a list of every existing student turn in the suite and the (category, trick or angle) each covers. No new case repeats a single turn (case-insensitive), reuses a covered (category, angle) pair without a plainly different angle named in the handoff, or adds a fourth phrasing of a trick already covered three times. Paste the check result in the handoff.
- A `must_not_contain` phrase never repeats the student's own words.
- A case the current guard misses goes to `docs/tasks/7.2/pending-cases/<suite>/` and is named in the handoff (7.2 plan "A guard gap is not fixed here"); write a different case to keep the count. More than 5 parked in a phase means stop at PARTIAL.
- No real model calls. Run each touched fixture test yourself and confirm it passes before you report green.

## Files
Create: new case files under `evals/suites/safety/**` (N), `evals/suites/persona/**` (O), `evals/suites/advice/**` (P), and `docs/tasks/7.2/pending-cases/**` only if a case is parked.
Modify: `packages/evals/src/{distressEscalate,moderationJailbreak,piiScrubPipeline}.test.ts` (N), `packages/evals/src/rolePlayFixtures.test.ts` (O), `packages/evals/src/adviceFixtures.test.ts` (P), and `packages/evals/src/suites.ts` and `suites.test.ts` (floors only). Plus `docs/tasks/7.2u/handoff.md`.
Out of bounds: every other suite, `packages/harness`, `packages/contracts`, prompt packs, locales and guard code.

## Risky paths touched
`evals/suites/safety/**` (Phase N): reviewer code-reviewer (MVP-first group; safety-reviewer returns at 13.3). The lead logs a risk: high decision with the signed count. Persona and advice are not risky.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals`
- `corepack pnpm exec prettier --check` on the changed .ts files
- `python3 .githooks/secret-scan.py --all`

## Budget
Budget: 290 tool calls (N 110, O 90, P 90). One fix round per phase, capped at 30.
