# Task 4.3b handoff

## Phase A

### Summary
Scrub-failure distress reply (item 2 of the plan) now carries the pack's helplines. The
raw-text-keyword-hit branch of `runner.ts`'s scrub-failure path (`run()`, right after
`scrubFailure` is reported) called `sendEscalation` with the bare `LAST_RESORT_DISTRESS_REPLY`.
It now calls a new private `distressFallback(input, e)` helper — the same two-step fallback
`escalate()` already used (`deps.fallbackReplies.distress(input.lang, e.locale)`, caught and
falling back to `LAST_RESORT_DISTRESS_REPLY` on throw/empty) — and `escalate()` itself was
refactored to call the same helper, so the logic lives in one place. The reply is never empty and
never throws. No new public type; no `packages/contracts` edit; no guard file touched.

### Decisions

### 4 Nov 2026 · 4.3b scrub-failure fallback shares escalate()'s helper · decided by builder · risk: low
- Decided: extracted `distressFallback(input, e)` as a private `Runner` method, used by both the
  scrub-failure branch and `escalate()`, instead of duplicating the try/catch-and-last-resort
  logic inline in the scrub-failure branch.
- Why: the plan's own wording calls for "the same two-step fallback `escalate()` already uses";
  a shared private helper keeps that behavior in one place instead of two copies that could drift.
- Alternatives: duplicate the inline try/catch in the scrub-failure branch (plan's literal
  wording, more diff-local but duplicates logic).
- Reversible: yes — inlining it back out is a small, local change.

### Red -> green evidence
- Red: `runner.test.ts` "the raw-text distress check still runs and escalates even with an
  attachment present (regression)" failed after the `runner.ts` change (expected the old bare
  `LAST_RESORT_DISTRESS_REPLY`, received `TEST_DISTRESS_REPLY` from the default test
  `fallbackReplies.distress`) — confirms the code path changed. Updated that assertion to the new,
  intended behavior (this is a real behavior change the plan calls for, not a cheat).
- New: `runner.test.ts` "the locale pack helplines reach the reply via fallbackReplies.distress
  (4.3b)" — a scrub-failure + raw keyword hit with a locale-style helpline string in
  `fallbackReplies.distress` asserts the reply is that string.
- New: `runner.test.ts` "a throwing/empty fallbackReplies.distress still falls back to the
  last-resort reply, never empty (4.3b)" — a throwing `fallbackReplies.distress` still yields
  `LAST_RESORT_DISTRESS_REPLY` and reports the thrown error on `background`.
- `policies.test.ts`'s existing `it.each` "scrub throws/times out + a hit on the raw text" also
  exercised this branch (via default `testDeps()`); updated its expected text from
  `LAST_RESORT_DISTRESS_REPLY` to `TEST_DISTRESS_REPLY` (same real behavior change) and renamed
  its title. Added a sibling test for the throwing-fallback case in this same scrub-failure
  context (not covered by the `runner.test.ts` attachment variant).

### Gate
- `vitest run src/pipeline/policies.test.ts src/pipeline/runner.test.ts`: 136 passed.
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness`: 28 typecheck/lint
  tasks successful; harness test suite included in the run passed with coverage thresholds held
  (no `guardrails/**` regression — this task touches no guard file). `@edmate/cli`'s
  `chatDbRetrieval.int.test.ts` failed on the local broken dev Postgres, as the brief said to
  expect and ignore (CI runs it).
- `prettier --check` on the three touched files: clean after `--write`.
- `python3 .githooks/secret-scan.py --all`: clean, no output.

### Budget
Tool calls used: ~32 (cap was 40 for this phase).

Left to do: Phase B (session distress flag + gentle check-in), per the plan.

## Phase B

### Summary
Item 1 of the plan: a one-turn, non-sticky `distressFollowupDue` flag on `HelpState`
(`helpState.ts`, `exactOptional`, absent reads `false` on old blobs). The distress-escalate branch
of `runner.ts` (hard raw-keyword hit, confident classifier, or self-harm rule fallback) sets it on
the saved `SessionHelp` via `withDistressFollowup`. The next ordinary turn's `generate` step reads
it from the loaded help state; if the reply is not held (`holdsReply()`), it emits one built-in
`token` event — the exact text below — before the model's own stream, then clears the flag on
every path that saves the turn's `next` help state (`base.next` on the error/no-reply paths and
the separate `finish()` expression on the success path), so it shows exactly once. A throwing/
missing `fallbackReplies.distressFollowup?(lang)` falls back to the built-in text, same resilience
pattern as Phase A's `distressFallback`.

**Exact check-in text (`DISTRESS_FOLLOWUP_REPLY`, `packages/harness/src/pipeline/replies.ts`;
reworded in fix round 1, see below):**
> "Before we carry on: thank you for telling me how you were feeling earlier. Support is still
> there whenever you want it. Now, let's keep going. "

The retract-joke case (`evals/suites/safety/distress/in/safety-distress-retract-joke-in-en.yaml`)
now passes offline as a new sibling file, `packages/evals/src/distressFollowup.test.ts`: turn 1
("i want to kill myself") escalates for real through `preGuard`/`escalate`/the hard-keyword check
and saves the flag; turn 2 ("lol relax i was joking...") is driven for real through the real
`generate` step with that loaded flag and starts with the check-in, then still teaches (scripted
f-strings answer); the YAML's `must_not_contain` list passes against the full reply. The YAML
itself is untouched; its `judge` rubric stays deferred (4.0/4.2/4.3 precedent).

### Decisions

### 4 Nov 2026 · 4.3b Q1 (held replies skip the check-in) · decided by lead, carried by builder · risk: low
- Decided: the check-in is only emitted when `holdsReply()` says the turn's reply streams live
  (`!held`). A held turn (postGuard may replace the draft whole) never shows it. **Corrected in fix
  round 1:** the flag does not stay set for a later read — `runner.ts`'s `base.next` wraps every
  save with `withoutDistressFollowup` unconditionally, on every outcome, whatever this turn's own
  move was. A held turn therefore drops the check-in for the rest of the session: it is a one-shot
  read, consumed and cleared whether or not it was actually shown. This is a documented gap, not
  a "shown later" deferral.
- Why: no extra gating logic needed — `generate.ts` already computes `held` for every other
  purpose; piggy-backing on it keeps the check-in's placement consistent with how the rest of the
  turn is shown, and avoids a second code path that `postGuard.ts`'s fixed-text builders would
  need to know about. Making the flag survive a held turn (read again, unconsumed) would need a
  third state ("due but not yet shown") on `SessionHelp`, which the plan's Q1 recommendation
  already judged disproportionate for a 2-line follow-up.
- Alternatives: force every flagged turn to show the check-in even when held, by injecting it into
  postGuard's rewritten/safe text too — rejected per the plan's own Q1 recommendation (disproportionate
  for a 2-line follow-up; logged as a follow-up for whichever task next touches `postGuard.ts`).
  Keep the flag set across a held turn instead of clearing it — rejected in fix round 1 too: it
  would need a new "due but unseen" state, out of this round's scope.
- Reversible: yes — the gate is one boolean check in `generate.ts`; a later task could add the
  third state above without touching this task's other code.

### 4 Nov 2026 · 4.3b Q2 (locked/redirect/ask_teacher moves never show it) · decided by lead, carried by builder · risk: low
- Decided: moves that never call `generate` (`locked`, `redirect`, `ask_teacher`) never show the
  check-in; this is accepted as-is, not worked around, per the plan's Q2 recommendation.
  **Corrected in fix round 1:** the flag does not "stay set and carry forward" either — same
  unconditional `withoutDistressFollowup` on `base.next` as Q1, so a turn that takes one of these
  moves also drops the check-in for the rest of the session, not just until the next turn that
  reaches `generate`.
- Why: those moves' replies are built by `postGuard.ts`'s fixed-text builders
  (`askTeacherReplyFor`, `redirectReplyFor`, locked's own reply), a separate code path this task
  does not touch; the flag is a one-shot read on the next ordinary turn's help-state load,
  consumed there whether or not that turn's move could show it (same accepted gap as Q1).
- Alternatives: thread the check-in into each fixed-text builder too — rejected; out of this
  task's scope and budget, logged as a follow-up for later `postGuard.ts` work.
- Reversible: yes — no code depends on this gap; a later task can add the check-in to those
  builders without touching this task's code.

### 4 Nov 2026 · 4.3b the postGuard-triggered escalate branch does not set the check-in flag · decided by builder · risk: low
- Decided: the generic postGuard-alert escalate branch (`'alert' in post`, serving lockedLeak,
  answerLeak and grounding escalations, not only distress) keeps its pre-4.3b `keep` logic
  (`this.lockedTrip ? { rung, help } : undefined`) unchanged; it does not wrap that saved state
  with `withDistressFollowup`.
- Why: an earlier draft of this change made that branch always save the help state with the flag
  set whenever it was known. That is wrong: this branch is reached for a locked-material leak or
  an ungrounded-reply escalation, neither of which is a mental-health distress event, so showing
  "I'm glad you're still here with me" on the next turn would be confusing and out of place. Only
  the dedicated distress-escalate branch (raw keyword/classifier/self-harm rule) sets the flag.
  Caught by `runner.lockedLeak.test.ts`'s two exact `.toEqual(next)` assertions turning red when
  the draft briefly set the flag there too; reverted rather than widened those assertions.
- Alternatives: set the flag on every escalate path regardless of cause (rejected, see above).
- Reversible: yes — a future task could choose to also show a check-in after a locked-material
  trip, as its own decision, without touching this task's distress-specific logic.

### 4 Nov 2026 · 4.3b an existing roleplay-distress test now expects the flag set · decided by builder · risk: low
- Decided: `roleplay.integration.test.ts`'s "a stop the router flags as distress gets the distress
  handling, not the role-play stop" test asserted `stopped.help` equals the pre-turn help state
  (`before`) exactly; changed to `{ ...before, distressFollowupDue: true }`.
- Why: that test's "stop" turn genuinely escalates as distress (`intent: 'distress'`), so it goes
  through the same distress-escalate branch Phase B's own new `runner.test.ts` cases cover; the
  plan's intended behavior change (every distress escalation sets the flag) necessarily changes
  this existing assertion too. Named here per the brief's rule on editing existing assertions.
- Alternatives: none — this is the plan's own behavior change reaching an existing test.
- Reversible: yes — reverting the flag-setting logic would restore the original assertion.

### 4 Nov 2026 · 4.3b `distressFollowupDue` is a required field on the generate step's options · decided by builder · risk: low
- Decided: `Steps['generate']`'s options object type gained `distressFollowupDue: boolean`
  (required, not `?:`), matching `lockedStopped`'s sibling field placement but without a default.
- Why: a required field forces every call site (test doubles, `generate.test.ts`'s `setup()`,
  `runner.ts`'s own construction) to say explicitly whether the flag is set, rather than silently
  defaulting to `undefined`/falsy and masking a future wiring mistake (same reasoning as other
  `Steps` fields this task's sibling tasks have made required).
- Alternatives: optional with a default of `false` inside `generate.ts` — slightly less diff
  everywhere it is constructed, but would hide a caller that forgot to pass it.
- Reversible: yes — a follow-up could relax it to optional without changing behavior.

### Red -> green evidence
- Red (`helpState.test.ts`): round-trip serialize/parse of `distressFollowupDue` true/false/absent
  failed before the schema field existed; green after adding it to `HelpStateSchema` and
  `parseSessionHelp`.
- Red (`generate.test.ts`): `distressFollowupDue: true` + unheld expecting the check-in token
  first failed (`setup()` had no such option, `generate.ts` had no emission); green after the
  `types.ts`/`generate.ts` change.
- Red (`runner.test.ts`): turn 1 escalate → saved `next.help.distressFollowupDue` expected `true`
  failed before `runner.ts`'s raw-keyword escalate call site passed `withDistressFollowup`; the
  three new "read on an ordinary turn" cases (flag true reaches `generate` and clears; absent
  reaches `generate` as `false`; flag true + `generate` throws still clears) failed before the
  `followupDue` computation and the two `next`-building sites were wrapped with
  `withoutDistressFollowup`.
- Red (`distressFollowup.test.ts`, new eval sibling file): failed first on a package build/exports
  gap (`DISTRESS_FOLLOWUP_REPLY`/`TEST_DISTRESS_FOLLOWUP_REPLY` were not exported from
  `@edmate/harness`/`@edmate/harness/testing`); then on `ScriptedGateway` wiring mistakes (wrong
  `steps` shape, missing `model` field on a hand-written `Usage`, missing `FIXTURE_PROMPT_PACK_VERSION`
  on the test's entitled agent, a tool named on the decision with no registry entry, and the
  judge's default ungrounded-retry path firing on unrelated retrieved content) — each fixed in
  turn; green once all were addressed.

### Gate
- `vitest run src/pedagogy/helpState.test.ts src/pipeline/generate/generate.test.ts
  src/pipeline/runner.test.ts src/pipeline/roleplay.integration.test.ts`: 197 passed (4 files).
- `vitest run src/distressFollowup.test.ts` (`@edmate/evals`): 3 passed.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness --filter=@edmate/evals`:
  9/9 tasks successful (typecheck, lint, test for both packages); harness: 6,062 tests passed, 0
  failed; evals: 1,993 tests passed, 0 failed. Coverage thresholds (incl. 100% on
  `src/guardrails/**`, unaffected by this task) are enforced inside each package's `test` script
  and the run exited 0.
- `prettier --check` on every touched file: clean (ran `--write` once on four files first).
- `python3 .githooks/secret-scan.py --all`: clean, no output.
- `@edmate/content#test`'s `safeRegex.test.ts` timing-probe test timed out once during a parallel
  full-tree run; unrelated to this task (not a file this task touches) and not reproduced when
  `@edmate/harness`/`@edmate/evals` were run on their own — a pre-existing timing-sensitive test,
  not a regression from this change.

### Budget
Tool calls used: ~85 (Phase B estimate was ~85; combined with Phase A's ~32, task total ~117 of
the 110-call budget — over by a small margin, mostly the eval test's trial-and-error wiring).
