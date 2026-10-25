# 5.8e handoff — persona-file naming in the banner, prompt-pack source in the banner, `/leave`
matches on the first word, a shared semver helper, a shared isSignedOff helper

**Status:** DONE

## What changed

### `apps/cli`
- `apps/cli/src/commands/chat/world.ts` — `loadChatPersonas` now returns `reason?: string` on
  failure, taken from the caught `Error`'s own message (which already names every bad file).
- `apps/cli/src/commands/chat/deps.ts` — `ChatSetup` gains `promptPackSource: 'real' | 'fixture'`
  and `personasReason?: string`; `buildChatDeps` keeps both instead of discarding them.
- `apps/cli/src/commands/chat.ts` — the startup banner now prints the prompt-pack source line
  ("signed set" or "fixture fallback") and, when `personasSource === 'none'`, the `personasReason`
  detail; `/leave` now matches on the split `command` (first word) instead of the whole line, so
  `/leave now` leaves the role-play.

### `packages/content`
- `packages/content/src/semver.ts` (**new**) — `compareSemver`, moved verbatim from
  `personaTemplates.ts`'s `comparePersonaVersions`/`compareIdentifier`.
- `packages/content/src/signOff.ts` (**new**) — `isSignedOff(value: string | undefined): boolean`.
- `packages/content/src/personaTemplates.ts` — re-exports `comparePersonaVersions` from
  `semver.ts` (same public name), uses `compareSemver` internally in `selectPersonaLibrary`, and
  `isSigned` now calls `isSignedOff`.
- `packages/content/src/promptPacks.ts` — imports `compareSemver` from `semver.ts` instead of
  `comparePersonaVersions` from `personaTemplates.ts`; local `signed` now calls `isSignedOff`.
- `packages/content/src/agePolicy.ts` — `complianceSigned` is now a one-line wrapper over
  `isSignedOff(pack.reviewedBy)`.
- `packages/content/src/index.ts` — unchanged (still re-exports `comparePersonaVersions` from
  `personaTemplates.js`, which itself now re-exports from `semver.js`).

### Tests
- `apps/cli/src/commands/chat/world.test.ts` — updated the "gives no personas" case to assert
  `reason` names `/no/such/dir`; added a case with a temp directory holding one bad persona file,
  asserting `reason` names that file.
- `apps/cli/src/commands/chat/deps.test.ts` — added an assertion that `setup.promptPackSource` is
  `'real'` for the default build, alongside the existing `personasSource` assertion.
- `apps/cli/src/commands/chat.test.ts` — added a sibling to the existing "role-play is
  unavailable" case that also sets `personasReason` and asserts the banner contains it; added a
  `describe` block asserting the banner says "signed set" for the default build and "fixture
  fallback" for `promptPackSource: 'fixture'`; added a `chatTurnInput` case for `/leave now`.
- `packages/content/src/personaTemplates.test.ts`, `promptPacks.test.ts`, `agePolicy.test.ts` —
  ran unchanged, no new cases needed (coverage on `semver.ts`/`signOff.ts` stayed at 100% through
  their existing callers' existing tests).

## Evidence

- `apps/cli/src/commands/chat/world.test.ts`: `loadChatPersonas('/no/such/dir')` returns
  `{ personas: undefined, source: 'none', reason: <names /no/such/dir> }`; a temp-dir case with
  one bad persona file returns a `reason` naming that file. PASS (`loadChatPersonas (5.8a)`, 2
  tests).
- `apps/cli/src/commands/chat.test.ts`: a case with `personasSource: 'none', personasReason: '...'`
  shows that reason in the banner; a case with `promptPackSource: 'fixture'` shows "fixture
  fallback"; the default build shows "signed set". PASS (3 tests in the new/updated describe
  blocks).
- `apps/cli/src/commands/chat.test.ts`'s `chatTurnInput` suite: `chatTurnInput(ROLEPLAY, '/leave
  now', IDS, now)` returns `{ state: { mode: 'normal' }, notice: 'left the role-play; back to
  normal chat' }`. PASS.
- `packages/content/src/personaTemplates.test.ts`'s `comparePersonaVersions` suite and
  `packages/content/src/agePolicy.test.ts`'s `complianceSigned` suite pass unchanged (43 and 12
  tests respectively) — the helper moves changed no behaviour.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/content... --filter=@edmate/cli
  --force`: `Tasks: 20 successful, 20 total`. `@edmate/content:test`: `537 passed (537)`,
  coverage `99.39% stmts / 95.82% branch / 100% funcs / 99.88% lines`. `@edmate/cli:test`: `153
  passed (153)`, coverage `95.13% stmts / 86.94% branch / 95.32% funcs / 96.34% lines`.
- `python3 .githooks/secret-scan.py --all`: no output, exit 0 (clean).

## Decisions

### 25 Oct 2026 · 5.8e persona/prompt-pack helper moves · decided by builder · risk: high
- Decided: `comparePersonaVersions` (semver precedence) and the three `pending` sign-off checks in
  `promptPacks.ts`, `personaTemplates.ts` and `agePolicy.ts` move to two new shared files
  (`semver.ts`, `signOff.ts`) with byte-identical logic — no prompt-pack or persona-template
  *behaviour* changes (which set or version is picked, which pack counts as signed). Both moves
  keep every existing exported name (`comparePersonaVersions`, `complianceSigned`), so no caller
  or test outside this task changes.
- Why: the plan's Design #3–#5 named this as a small, mechanical extraction of already-isolated
  pure functions with no behaviour change; the existing `comparePersonaVersions` and
  `complianceSigned` test suites pass unchanged, confirming no drift.

### 25 Oct 2026 · 5.8e `/leave` first-word match · decided by builder · risk: low
- Decided: `/leave` now matches on the split `command` (first word of the line), the same pattern
  `chat.ts` already used for `/roleplay`, instead of requiring an exact `line === '/leave'` match.
- Why: the board acceptance line asks only that `/leave now` leaves the role-play, not that extra
  arguments after `/leave` are validated or rejected — so no usage-string validation was added
  (Design #6, plan line 97-98).

### 25 Oct 2026 · 5.8e persona-load failure reason · decided by builder · risk: low
- Decided: `loadChatPersonas`'s `reason` is taken verbatim from `e instanceof Error ? e.message :
  String(e)`, the same message `readPersonaLibrary` already throws (which lists every bad file by
  name) — no new error text was invented.
- Why: Design #1 calls for reusing the existing thrown message rather than writing a new one, and
  this matches `docs/lessons.md`'s "A check that silently skips looks like a pass" lesson: the fix
  keeps the detail instead of discarding it.

## Budget

Tool calls used: 26
