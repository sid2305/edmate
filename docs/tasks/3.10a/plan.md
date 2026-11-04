# Plan: 3.10a — locale-pack follow-ups (3.10 reviews)

## Acceptance (verbatim, board `3.10a`)
"each item has a unit test; the integration test passes with content#build running at the same
time; validate with no dist exits non-zero outside tests."

**Shown by:** the gate command below green, run twice to show no race (once with
`content#build` and `content#test` launched together, e.g. `corepack pnpm turbo run build test
--filter=@edmate/content` relying on turbo's own parallel scheduling, not a serial fallback); the
new CLI build-smoke test exiting non-zero when the compiled worker is missing and 0 when it is
present; `isPending`/email-bypass unit tests; the 7 new eval case files loading cleanly under
`EDMATE_ALLOW_PENDING=1`.

## Files to create/modify (builder's branch)
- `packages/content/src/pendingText.ts` (NEW) — single `isPending(s)` used everywhere a
  placeholder is checked (item 3).
- `packages/content/src/pendingText.test.ts` (NEW).
- `packages/content/src/localePacks.ts`, `src/localeRules.ts`, `src/privacyNotices.ts`,
  `src/rightsDeclaration.ts` (MODIFY) — drop each file's own local `isPending` copy, import the
  shared one.
- `packages/content/src/emailLike.ts` (NEW) — shared `looksLikeEmail(s)` closing the fullwidth-dot
  and spelled-out-"at" bypass (item 5).
- `packages/content/src/emailLike.test.ts` (NEW).
- `packages/content/src/schema.ts`, `src/privacyNotices.ts`, `src/rightsDeclaration.ts`
  (MODIFY) — their `reviewer()`/`reviewedBy` refinements call the shared helper instead of the
  inline `/\S@\S+\.\S/` regex.
- `packages/content/src/safeRegexGuard.ts` (MODIFY) — `inProcessOrFailClosed` keys off
  `process.env.VITEST === 'true'` (this package's own tests only), not `NODE_ENV === 'production'`,
  so dev-from-source and any other non-test context fails closed too (item 2).
- `packages/content/src/safeRegexGuard.test.ts` (MODIFY/extend, or NEW if none exists) — unit
  cases T3/T4 below.
- `packages/content/tsconfig.integration-test.json` (NEW) — extends `tsconfig.build.json`,
  `outDir: "dist/integration-test"` (inside the already-gitignored `dist/`, no new `.gitignore`
  line needed).
- `packages/content/src/safeRegexGuardIntegration.test.ts` (MODIFY) — build into the new outDir
  instead of the shared `dist/` (item 1).
- `apps/cli/test/build-smoke.test.ts` (NEW), `apps/cli/vitest.build-smoke.config.ts` (NEW) —
  spawns `node bin/edmate content validate <dir>` as a real child process with `VITEST` stripped
  from its env (item 2's CLI smoke test).
- `apps/cli/package.json` (MODIFY) — add a `"build-smoke"` script matching `apps/web`'s pattern;
  the generic root `turbo.json` `build-smoke` task already exists, no `turbo.json` change needed.
- `evals/suites/safety/locale/safety-locale-003-*.yaml` … `-009-*.yaml` (7 NEW files) — item 6,
  translated from the 3.10 safety-review's pseudo-schema into the real `EvalCaseSchema` shape
  (`suite: safety`, `package: free`, `reviewed_by: pending`, real `turns[].expect` fields; the
  pseudo-field `reply_language: en` becomes a `judge` rubric, since the schema has no such field).

## Lead step (not the builder's branch)
- `.claude/skills/locale-context/SKILL.md:49` — the India example says English plus Hindi; the
  lead changes it to English only, matching the rest of the file (`languages: [en]`) and
  `pilotLanguages.ts`. Out of bounds for the builder.

## Files out of bounds
- `packages/harness/**` (other builders are in there now).
- `packages/contracts/**` (no contracts change; see Open Questions — the same bug also lives in
  `formats.ts`'s `signer()`, deliberately left there).
- `.claude/skills/locale-context/SKILL.md` (lead-owned, see above).
- `.github/workflows/ci.yml` (CI wiring for the new `apps/cli` build-smoke task is not required by
  the accept line — the gate command below runs it directly; treat wiring it into the push-gate
  workflow as a follow-up, not this task).
- `content/locales/**` (no locale-pack data edits; IN's `pending` values stay pending).

## Tests first (reproducers before fixes)

**Item 1 — build/test race**
1. T1: run `content#build` and `content#test` concurrently; before the fix the integration test's
   own `tsc` invocation can race the main `build` script writing the same `dist/`. After the fix,
   the integration test writes to `dist/integration-test/` via the new tsconfig, so no shared path
   exists regardless of scheduling.
2. T2: the integration test's 3 existing cases (fast safe pattern, throwing worker, terminated
   polynomial pattern) still pass pointed at the new outDir.

**Item 2 — fail closed outside tests, CLI smoke**
3. T3: with `VITEST` unset and `NODE_ENV` unset, worker file missing →
   `checkSafeRegexGuarded(...)` returns a non-empty issues array (fails closed). Today it falls
   through to the no-ceiling in-process check and can return `[]`.
4. T4: inside this package's own vitest run (`VITEST === 'true'`), the same missing-worker case
   still uses the in-process fallback — no regression to the dev/test convenience.
5. T5 (CLI smoke, negative): spawn `node bin/edmate content validate <dir>` with `VITEST` stripped
   from the child's env and the compiled worker absent (`EDMATE_CONTENT_WORKER_DIR` pointed at an
   empty dir) → process exits non-zero.
6. T6 (CLI smoke, positive): same spawn, real build, worker present, valid locale-packs dir →
   exits 0.

**Item 3 — isPending**
7. T7: `isPending('TBD')`, `isPending('tbd')` → true (today false).
8. T8: `isPending('')`, `isPending('   ')`, `isPending(' ')`, `isPending('​')` → true
   ("blank-ish"; today false since blank isn't pending at all today).
9. T9: `isPending('Pendingg')`, `isPending('Pendng')`, `isPending('Pedning')` → true (typo
   placeholders; today false).
10. T10 (negative controls): `isPending('sid2305')`, `isPending('Dr. Patel')`, `isPending('Nat')`,
    `isPending('pending review requested')` → false — guards against over-matching real names/text.
11. T11: `localeRules.ts`'s rules and `localePacks.ts`'s `withVerifiedHelplines` now also drop/flag
    a helpline committed with `verifiedBy: TBD` or `number: Pendingg`.

**Item 5 — email-bypass**
12. T12: `'a@b．com'` (U+FF0E fullwidth full stop) → refused (today passes: `\.` doesn't match it).
13. T13: `'jane at example dot com'` (no literal `@`) → refused (today passes).
14. T14 (negative controls): `'Jane Doe'`, `'sid2305'`, `'Natasha'` (contains "at" mid-word) →
    still accepted.
15. T15: the same two bypass inputs are refused through all three call sites —
    `schema.ts`'s `reviewer()`, `privacyNotices.ts`'s `reviewedBy`, `rightsDeclaration.ts`'s
    `reviewedBy`.

**Item 6 — eval cases**
16. T16: `packages/evals`' `suites.test.ts`, run with `EDMATE_ALLOW_PENDING=1`, loads the 7 new
    `evals/suites/safety/locale/*.yaml` files with no schema/structural problems (`suite: safety`,
    `id` starts `safety-`, filename matches `id`, `package` in `{free, paid}`) and no duplicate id
    or duplicate normalised-turn-sequence against the existing `safety/*` cases.
17. T17: `locale` is a new subfolder under `safety/`, not a `GUARD_FOLDERS`/`SUITE_FLOORS` entry —
    no change needed to `suites.ts`; the 7 additions count toward the existing `safety` floor
    (300) without requiring their own.

## Risky paths touched (`.claude/skills/merge-gate/risk-paths.txt`)
- `evals/suites/safety/**` → reviewer group: **code-reviewer** (MVP-first group; no
  safety-reviewer-per-PR until the pilot gate, per standing policy).
- No other match. `packages/content/src/{localePacks,safeRegexGuard,localeRules}.ts` are **not**
  listed in `risk-paths.txt` despite governing locale-pack safety behaviour — a pre-existing gap,
  not this task's to fix; flagged below as an open question, not blocking.
- `.claude/skills/locale-context/SKILL.md` would match the `.claude/**` group (reviewer:
  security-reviewer) but is the lead's own edit, outside this task's PR/branch, so it does not
  gate this merge.
- No `packages/contracts/**`, no `.github/**`, no `packages/harness/**` touched.

## Gate command
```
source ~/.nvm/nvm.sh && corepack pnpm install
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test \
  --filter=...@edmate/content --filter=...@edmate/evals --filter=...@edmate/cli
source ~/.nvm/nvm.sh && corepack pnpm turbo run build-smoke --filter=@edmate/cli
EDMATE_ALLOW_PENDING=1 source ~/.nvm/nvm.sh && corepack pnpm turbo run test --filter=@edmate/evals
python3 .claude/skills/merge-gate/merge_gate.py 3.10a
python3 .githooks/secret-scan.py --all
```

## Open questions
1. **Item 5's named location is `packages/contracts/src/formats.ts`'s `signer()`, not in
   `packages/content`.** This plan fixes the identical bug in content's three own copies
   (`schema.ts`, `privacyNotices.ts`, `rightsDeclaration.ts`) to honour "no contracts change," but
   the contracts copy stays bypassable. Recommend a small follow-up task with a dated ADR-0008
   amendment (precedent: 10.1a/10.1b), reviewed by architect + security-reviewer +
   typescript-reviewer. Flagging rather than deciding — the lead's call on when to schedule it.
2. **`reviewed_by: pending` vs. `suites.test.ts`'s default gate.** The gate's `requireReviewed`
   defaults to `true` in CI, so these 7 cases fail it as committed unless `EDMATE_ALLOW_PENDING=1`
   is set. Precedent (4.8b) is the lead signing `reviewed_by` to a real name just before merge.
   This plan assumes that happens here too — confirming, not deciding.
3. **Real-agent wiring for the new cases.** `safety/distress` cases run through a real `runTurn`
   via `distressEscalate.test.ts`; no such runner exists for a `locale` folder, and the board's
   accept line only asks that the cases exist and validate structurally. This plan leaves
   real-runner wiring as an explicit follow-up, not in scope here.
4. **Pilot-policy call on the India/Hindi-flavoured cases (6 of 7: 003/004/006/007/008/009).**
   Recommend keeping all 7 as defense-in-depth safety-net regression coverage for the
   locale-pack leak-prevention mechanism itself (pending-helpline removal, pack-internals
   non-disclosure, PII scrub, unknown-market fallback) — precedent: `safety/distress/in/*.yaml`
   already ships signed India/Hindi cases despite India being parked for the pilot. None dropped.

## Budget
Budget: 90 tool calls (1 phase, packages/content + apps/cli + evals/suites fixtures)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (package test/typecheck/lint runs, turbo, and secret-scan only)

## Exit conditions
Status: DONE when all 17 test cases above pass under the gate command, the 7 eval case files load
cleanly with `EDMATE_ALLOW_PENDING=1`, and the secret scan is clean. Status: PARTIAL past ~90 tool
calls, or if closing item 5 turns out to require touching `packages/contracts` after all, or if
`.github/workflows/ci.yml` wiring turns out to be required — stop, commit what's green, and hand
off with the gap named.

## Lead review (31 Oct 2026)
READY, approved. My answers to the open questions:
1. Fix item 5 in content's own copies only. The contracts `signer()` fix is the new board task 3.10d, which needs an ADR-0008 amendment.
2. The lead reviews and signs the 7 new cases before merge (the 4.8b precedent). Ship them with `reviewed_by: pending`, and run the suites test with `EDMATE_ALLOW_PENDING=1` for your gate. Say so in the handoff.
3. Wiring a runner for the locale folder is out of scope. No follow-up is needed until a real-agent locale run exists.
4. Keep all 7 cases as a safety net. This is consistent with the English-only pilot rule: Hindi stays in guards and safety cases only.
- Lead step done on main: the India example in `.claude/skills/locale-context/SKILL.md` now says English only.
