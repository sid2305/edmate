# 5.8e plan — 5.8a review follow-ups: persona-file naming in the banner, prompt-pack source in
the banner, `/leave` matches on the first word, a shared semver helper, a shared isSignedOff helper

Status: READY

## Acceptance (verbatim from the board)

> A broken persona file names itself in the CLI banner, the banner shows the prompt-pack source,
> and `/leave now` leaves the role-play.

How it will be shown:
- `apps/cli/src/commands/chat/world.test.ts`: `loadChatPersonas('/no/such/dir')` (and a case with a
  real directory holding one bad persona file) returns `{ personas: undefined, source: 'none',
  reason: <message naming the bad file> }` — `readPersonaLibrary`'s own thrown `Error` already
  lists every bad file by name; the fix stops discarding that message.
- `apps/cli/src/commands/chat.test.ts`: a case with `personasSource: 'none', personasReason:
  '<dir>: ...'` shows that reason in the startup banner (not just "did not load"); a case with
  `promptPackSource: 'fixture'` shows "fixture fallback" in the banner, and the default (real) case
  shows "signed set".
- `apps/cli/src/commands/chat.test.ts`'s existing `chatTurnInput` suite: a new case,
  `chatTurnInput(ROLEPLAY, '/leave now', IDS, now)`, returns `{ state: { mode: 'normal' }, notice:
  'left the role-play; back to normal chat' }` (today it is sent as a role-play answer instead).
- `packages/content/src/personaTemplates.test.ts`'s existing `comparePersonaVersions` suite and
  `packages/content/src/agePolicy.test.ts`'s existing `complianceSigned` suite pass unchanged
  (same exported names, same behaviour) after both move onto the two new shared helpers below —
  proving the move changed no prompt-pack or persona *behaviour*.

## Context (read before building)

Source findings: `docs/tasks/5.8a/review.md`, all five deferred to 5.8e:
1. [MEDIUM] `apps/cli/src/commands/chat/world.ts` — `loadChatPersonas` swallows the load error, no
   file name or reason in the banner. **Build**, Design #1.
2. [LOW] `apps/cli/src/commands/chat/world.ts` — the fixture-set fallback is silent; the banner
   should show the prompt-pack source. **Build**, Design #2.
3. [LOW] `packages/content/src/promptPacks.ts` — set ranking borrows `comparePersonaVersions`
   from `personaTemplates.ts`; move it to a shared semver helper. **Build** (small mechanical
   move: one pure, already-isolated function; no caller's observable behaviour changes), Design
   #3.
4. [LOW] `packages/content/src/promptPacks.ts` / `personaTemplates.ts` / `agePolicy.ts` — the
   `pending` sign-off check is repeated three times; share one `isSignedOff` helper. **Build**
   (small mechanical move: the three checks are already byte-for-byte the same rule, just one
   handles an optional field the other two can never receive — see Design #4), Design #5.
5. [LOW] `apps/cli/src/commands/chat.ts` — `/leave` matches only the exact line, so `/leave now`
   is sent as a role-play answer. **Build**, Design #6.

Current shapes read for this plan: `apps/cli/src/commands/chat/world.ts` (+ `.test.ts`),
`apps/cli/src/commands/chat/deps.ts` (+ `.test.ts`), `apps/cli/src/commands/chat.ts` (+
`.test.ts`), `packages/content/src/promptPacks.ts` (+ `.test.ts`),
`packages/content/src/personaTemplates.ts` (+ `.test.ts`), `packages/content/src/agePolicy.ts`
(+ `.test.ts`), `packages/content/src/index.ts`.

Relevant lesson (`docs/lessons.md`, "A check that silently skips looks like a pass"): a swallowed
error that leaves no trace is exactly `loadChatPersonas`'s current bug — the fix keeps the detail
instead of discarding it, the same shape of fix as that lesson's merge-gate parser.

**Not touched** (scope discipline, same pending-pending-check duplication but not named by this
board item or the 5.8a review): `packages/content/src/privacyNotices.ts`'s `noticeSigned` and
`packages/content/src/rightsDeclaration.ts`'s `rightsDeclarationSigned` carry the same "pending"
rule a fourth and fifth time. Left alone here; a future board item can fold them into the same
`isSignedOff` helper.

**13.skillpresent Phase A (PR #276)** touches `packages/harness/src/pipeline/**` only; this plan
touches `apps/cli/src/commands/chat/**` and `packages/content/src/**` — no file overlap.

## Design (one sentence each)

1. **Persona load failure names itself**: `loadChatPersonas` returns `reason?: string` alongside
   `source: 'none'`, set from `e instanceof Error ? e.message : String(e)` in the catch —
   `readPersonaLibrary`'s thrown message already lists every bad file by name, so no new error
   text is invented.
2. **Prompt-pack source threads through**: `buildChatDeps` (`deps.ts`) keeps
   `loadChatPromptPacks()`'s `source` (today discarded) on `ChatSetup.promptPackSource: 'real' |
   'fixture'`.
3. **Shared semver helper**: new `packages/content/src/semver.ts` exports `compareSemver` (moved
   verbatim from `personaTemplates.ts`'s `comparePersonaVersions`/`compareIdentifier`).
   `personaTemplates.ts` keeps its public name by re-exporting: `export { compareSemver as
   comparePersonaVersions } from './semver.js';` (its own test and `index.ts`'s barrel export need
   no change). `promptPacks.ts` imports `compareSemver` from `./semver.js` directly instead of
   `comparePersonaVersions` from `./personaTemplates.js` (one less cross-file dependency between
   the two pedagogy-review files).
4. **`isSignedOff` covers all three call sites' existing checks exactly**: `signed` in
   `promptPacks.ts` and `isSigned` in `personaTemplates.ts` both take a required `string` and will
   never see `undefined` (their schemas require `reviewed_by`/`reviewedBy`); `complianceSigned` in
   `agePolicy.ts` takes `LocalePack['reviewedBy']`, which is optional. One helper signature,
   `(value: string | undefined) => boolean`, covers both without changing any of the three
   results.
5. **Shared `isSignedOff` helper**: new `packages/content/src/signOff.ts` exports `isSignedOff
   (value: string | undefined): boolean { return value !== undefined && value.trim().toLowerCase()
   !== 'pending'; }`. `agePolicy.ts`'s exported `complianceSigned` becomes a one-line wrapper
   (`(pack) => isSignedOff(pack.reviewedBy)`) — same exported name, same test. `personaTemplates.
   ts`'s local (unexported) `isSigned` and `promptPacks.ts`'s local (unexported) `signed` call
   `isSignedOff` directly instead of repeating the rule; neither is part of either file's public
   API, so no test changes beyond behaviour staying identical.
6. **`/leave` matches on the first word**: `chat.ts`'s turn-mapping already splits `line` into
   `[command, ...rest]` for `/roleplay`; the `/leave` check moves from `line === '/leave'` to
   `command === '/leave'` (trailing words, e.g. "now", are accepted and ignored — no usage-string
   validation is added, since the board's accept line only asks that `/leave now` leaves the
   role-play, not that extra arguments are rejected).

## Files to create / modify (one phase)

### `apps/cli` (not risky by path)
1. `apps/cli/src/commands/chat/world.ts` — `loadChatPersonas` adds `reason` (Design #1).
2. `apps/cli/src/commands/chat/deps.ts` — `ChatSetup` gains `promptPackSource` and
   `personasReason?`; `buildChatDeps` keeps both instead of discarding them (Design #1, #2).
3. `apps/cli/src/commands/chat.ts` — banner prints the prompt-pack source line and, when
   `personasSource === 'none'`, the `personasReason` detail; `/leave` matches on `command`
   (Design #2, #6).

### `packages/content` (risky: `promptPacks.ts`, `personaTemplates.ts` — see below)
4. `packages/content/src/semver.ts` (**new**) — `compareSemver` (Design #3).
5. `packages/content/src/signOff.ts` (**new**) — `isSignedOff` (Design #5).
6. `packages/content/src/personaTemplates.ts` — re-exports `comparePersonaVersions` from
   `semver.ts`; local `isSigned` calls `isSignedOff` (Design #3, #5).
7. `packages/content/src/promptPacks.ts` — imports `compareSemver` from `semver.ts` instead of
   `comparePersonaVersions` from `personaTemplates.ts`; local `signed` calls `isSignedOff`
   (Design #3, #5).
8. `packages/content/src/agePolicy.ts` — `complianceSigned` calls `isSignedOff` (Design #5).

### Tests (tests first)
9. `apps/cli/src/commands/chat/world.test.ts` — update the existing "gives no personas" case to
   assert `reason` names `/no/such/dir`; one new case with a temp directory holding one bad
   persona file, asserting `reason` names that file.
10. `apps/cli/src/commands/chat/deps.test.ts` — one new assertion that `setup.promptPackSource`
    is `'real'` for the default build (alongside the existing `personasSource` assertion).
11. `apps/cli/src/commands/chat.test.ts` — the existing "role-play is unavailable" case gets a
    sibling that also sets `personasReason` and asserts the banner contains it; one new case for
    `promptPackSource: 'fixture'` asserting the banner says "fixture fallback" (vs. "signed set"
    in the existing default-build banner check, if there is one — else add one); one new
    `chatTurnInput` case for `/leave now` (Design #6, acceptance line 3).
12. `packages/content/src/personaTemplates.test.ts`, `promptPacks.test.ts`, `agePolicy.test.ts` —
    run unchanged as regression proof that the helper moves changed no behaviour; add no new
    cases unless coverage drops on the new `semver.ts`/`signOff.ts` files (each is fully exercised
    through its three existing callers' existing tests).
13. Run: `corepack pnpm turbo run typecheck lint test --filter=@edmate/cli... --filter=@edmate/
    content...`; secret scan.

## Files out of bounds

`packages/content/src/privacyNotices.ts`, `packages/content/src/rightsDeclaration.ts` (same
pending-check pattern, not named by this board item — see Context). `packages/harness/**`
(no harness change; the fallback/source logic is composition-root-only). `packages/harness/src/
pipeline/**` (13.skillpresent Phase A, open PR #276). `packages/contracts/**` (no schema change,
no ADR). Any prompt-pack or persona-template *content* file, and any change to which set/version
is picked, which pack is signed, or how a role-play behaves (that is prompt-pack *behaviour* and
needs an ADR — this plan only moves two pure helper functions to new files with identical
bodies).

## Risky paths touched (checked against risk-paths.txt)

- `packages/content/src/promptPacks.ts`, `packages/content/src/personaTemplates.ts` — named
  explicitly under "Teaching policy, prompt-pack parsing..." group: required reviewer
  `code-reviewer` (MVP-first note at the top of `risk-paths.txt`: `safety-reviewer` is deferred to
  13.3). Recommended as well: `typescript-reviewer` (two new shared-helper files touching three
  existing modules' imports).
- `packages/content/src/agePolicy.ts`, `semver.ts` (new), `signOff.ts` (new) — not matched by any
  risk-paths.txt glob (only `promptPacks.ts` and `personaTemplates.ts` are named by path in that
  group, not the rest of `packages/content/src/**`); reviewed anyway since they sit next to the
  risky pair, no reviewer required by the gate.
- `apps/cli/src/commands/chat/**` — not in risk-paths.txt.
- No `packages/contracts/**`, `docs/adr/**`, `.claude/**`, migration or locale-pack-content change.
- This task's handoff logs a `risk: high` decision (below) for the two risky-path files.

## Decisions to log (handoff `## Decisions`, risk: high)

1. "`comparePersonaVersions` (semver precedence) and the three `pending` sign-off checks in
   `promptPacks.ts`, `personaTemplates.ts` and `agePolicy.ts` move to two new shared files
   (`semver.ts`, `signOff.ts`) with byte-identical logic — no prompt-pack or persona-template
   *behaviour* changes (which set or version is picked, which pack counts as signed). Both moves
   keep every existing exported name (`comparePersonaVersions`, `complianceSigned`) so no caller
   or test outside this task changes."

## Open questions

None — both helper moves are small mechanical extractions with no behaviour change (see Design
#3–#5), and the three banner/`/leave` fixes are exactly what the accept line asks for.

## Budget

Budget: 40 tool calls (1 phase, apps/cli + packages/content)

One Sonnet builder, one branch, one PR (`m13/5.8e-chat-banner-and-leave-fix`).

## Allowed tools

Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test for `@edmate/cli` and
`@edmate/content`, the secret scan, git add/commit/push on the task branch only).

## Exit conditions

- `Status: DONE`: the tests above exist and pass (tests first), both packages' typecheck, lint
  and test are green, secret scan clean, handoff written with `Tool calls used:` and the
  `risk: high` decision.
- Stop at `Status: PARTIAL` past ~40 calls, or if a helper move turns out to change any existing
  test's expected value (that would mean the three checks were not actually identical — stop and
  name the difference rather than changing behaviour to make tests pass).
