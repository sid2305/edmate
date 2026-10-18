# 3.4 handoff: `buildContext`

**Status:** DONE
**Branch:** `m3/3.4-build-context`
**Worktree:** `.claude/worktrees/agent-ae3a8de5692ce86d4`

## Acceptance evidence

| Item | Evidence |
|---|---|
| Gates (root, all packages, after merging origin/main at `e9430f9`) | `corepack pnpm turbo run typecheck lint test` → `Tasks: 40 successful, 40 total` |
| harness test | `Tests 2000 passed (2000)` (1904 before 3.4; 2.5 merged in adds 9) · `All files 99.36 / 97.19 / 100 / 100` · `helpState.ts`, `buildContext.ts`, `historyTrim.ts` 100 / 100 / 100 / 100 (pedagogy's 100% threshold holds) |
| Secret scan | `python3 .githooks/secret-scan.py --all` → exit 0 |
| Purity | harness lint (purity rule) passes; new files import only `@edmate/contracts`, `zod` and sibling modules; no `Date`/`Math.random` |
| History trim, deterministic | `historyTrim.test.ts`: budget table (empty; under; exactly at; over drops oldest first; contiguous newest run, no gaps; zero/negative budget); a newest message over budget is kept, cut to its last `budget` units without splitting a surrogate pair; same input twice → identical output, input not mutated; 10k messages stay within budget |
| Last summary | `buildContext.test.ts`: `profile` equals what `ProfileStore.get(studentId, entitlement.teacherId)` returned, `lastSummary` included; absent when the profile has none; another student's/teacher's profile rejects (runner fallback) |
| Access-filtered retrieval | `buildContext.test.ts`: every search is `{ q, scope: { teacherId, allowedModuleIds }, k: 5 }`; bare "42" query is `42\n<latest agent question>` and retrieves; with `retrievalWorld()` (allowed, locked, other-teacher chunks) only allowed chunks return and `OUT_OF_SCOPE_TEXT` never appears in the result; an index that returns a locked or other-teacher chunk is refused (`RetrievalScopeError`, ids only in the message); at most `RETRIEVAL_K` chunks kept. `memoryRetrieval.test.ts`: `// @ts-expect-error` proves `search` needs a scope; the fake rejects a malformed scope and never returns out-of-scope chunks. `retrievalQuery.test.ts`: query building and caps |
| Locked probe | probe called with `{ teacherId, moduleIds: lockedModuleIds }`; `lockedHit` = the probe's `hit`; skipped (and `false`) when `lockedModuleIds` is empty; a rogue probe returning `{ hit: 'yes', text }` gives `lockedHit: false` and the text goes nowhere |
| Style card / persona | no style-card load; `BuiltContext` keys are exactly profile, history, retrieved, lockedHit, helpRung, helpState; `persona` undefined, also for a `mock_interview` skill action |
| Help state | `helpState.test.ts`: `SessionHelpSchema` `{ v: 1, rung, ...HelpState }`; `parseSessionHelp` round-trips a valid blob and defaults on 17 invalid shapes (undefined, null, `{}`, wrong version, rung out of range/fractional/string, bad fields, unknown key, throwing getter); `serializeSessionHelp` round-trips, copies, refuses invalid state and anything over `LIMITS.helpStateMaxJsonLength`. `buildContext.test.ts`: raw help state on `Entitled` → `helpRung` + `helpState`; missing/empty/malformed → rung 0 + `INITIAL_HELP_STATE`. `entitle.test.ts`: the session's raw help state from `TurnConfigStore.load` passes through unchanged |
| Never exceeds model context | 40 × 5,000-char messages plus 5 chunks of 5–9k chars: history + chunk text ≤ `MAX_CONTEXT_CHARS` (32,000), latest message kept, a too-big chunk skipped while a smaller later one fits; a single message of 64k chars is cut to `HISTORY_MAX_CHARS` |
| Runner integration | `runner.test.ts` "runTurn with the real buildContext (3.4)": a full turn reaches decide with a `TurnContextSchema`-valid context (profile, history, retrieval, `helpRung` 2 from the stored state); the answer key and locked text appear in none of TurnContext, events or trace, and TurnContext has no `helpState` key; a widening index and a slow store (timeout) both fall back and the turn still completes |

## Changes

- `pipeline/steps/buildContext.ts`: the real step. Phase 1 loads profile and 40 messages concurrently; then (if not cancelled) trims history to 16,000 chars, builds the query, and runs `search` (scope = teacher + allowed modules, k 5) and `probe` (locked modules, skipped when none or when the query is empty) concurrently; re-checks every chunk's scope; fits chunks into the remaining budget; parses the help state.
- `pipeline/steps/historyTrim.ts`, `retrievalQuery.ts`: pure helpers.
- `pedagogy/helpState.ts`: `SessionHelpSchema`, `parseSessionHelp`, `serializeSessionHelp` (for 3.8), exported from `pedagogy/index.ts`.
- `pipeline/types.ts` / `results.ts`: `Entitled.helpState?: unknown` (raw, `z.unknown().optional()`); `BuiltContext.helpState: HelpState` (`HelpStateSchema`).
- `pipeline/steps/entitle.ts`: passes `loaded.helpState` from the same ownership-checked `TurnConfigStore.load` call onto `Entitled` (no extra query; `access/**` untouched).
- `pipeline/runner.ts` `assemble()`: deletes `helpState` before parsing `TurnContextSchema` (strict object; keeps the answer key out of TurnContext).
- `pipeline/policies.ts` `fallbackContext` and `testing/testSteps.ts` happy stub: `helpState: copyHelp(INITIAL_HELP_STATE)`.
- `testing/memoryRetrieval.ts` (+ test): in-memory `RetrievalIndex` with call logs, word-overlap ranking, optional fixed probe result; `retrievalWorld()` and `OUT_OF_SCOPE_TEXT`; exported from `testing/index.ts`.
- `runner.test.ts`: `buildContext` removed from the "every stub throws" list; new integration cases. `README.md`: a buildContext section.

## Deviations

- The plan's "a single message longer than the budget is kept" is kept, but cut to its last `HISTORY_MAX_CHARS` units, so the context limit always holds.
- The plan's "rung clamped to 0–4" is replaced by ADR-0005's rule: an out-of-range rung fails the parse and the whole state defaults to rung 0.
- `entitle.ts` and `types.ts` were touched (one pass-through line, one optional field) because the help state has to travel from `TurnConfigStore.load` to `buildContext`; 2.5 merged in without conflicts.
- `prettier --check .` flags `.github/workflows/ci.yml`, which is the same on main; not touched here.

## Notes for 3.6 / 3.8

- The runner does not pass the parsed `helpState` to `decide` yet: `assemble()` drops it. 3.6 should thread `bc.value.helpState` (or the fallback's) into `decide`, and 3.8 should save `next` with `serializeSessionHelp` through `SessionStateStore`.
- `CommitRecord.entitled` now carries the raw help state (server-side only); commit must not copy it into messages or anything client-facing.

## Decisions

### 18 Oct 2026 · 3.4 Context budget in characters: 32,000 total, 16,000 for history · decided by builder (tdd-guide), lead answer Q3 · risk: low
Decided: history text plus retrieved chunk text stays within 32,000 UTF-16 units; history gets up to 16,000 and retrieval the rest; 40 messages fetched; chunks that don't fit are skipped in rank order.
Why: harness purity rules out a tokenizer; about 8k tokens leaves room for the system prompt, style card and reply.
Alternatives: a token estimate (chars / 4); a fixed chunk count with no size check.
Reversible: yes (constants in `buildContext.ts`; recalibrate at 7.6).

### 18 Oct 2026 · 3.4 A newest message over the history budget is cut, not dropped · decided by builder (tdd-guide) · risk: low
Decided: if the latest message alone exceeds the history budget it is kept, cut to its last `HISTORY_MAX_CHARS` units (never splitting a surrogate pair).
Why: the plan wants the latest message always kept and the acceptance says the context never exceeds the limit; cutting satisfies both.
Alternatives: keep it whole (can break the limit); drop it.
Reversible: yes.

### 18 Oct 2026 · 3.4 A chunk outside the scope fails the step instead of being filtered out · decided by builder (tdd-guide) · risk: medium
Decided: `buildContext` re-checks every chunk from `search`; one from another teacher or a non-allowed module throws `RetrievalScopeError` (ids only), so the runner uses the ask_teacher fallback context and the trace shows `fallback`.
Why: a widening index is a bug that must be visible (ADR-0003); dropping chunks silently would hide it. Matches the runner's own TurnContext refine behaviour.
Alternatives: drop the stray chunks and keep the rest.
Reversible: yes.

### 18 Oct 2026 · 3.4 Retrieval query: the input text plus the latest agent message, each capped at 1,000 chars · decided by builder (tdd-guide), per 3.5 plan Q2 · risk: low
Decided: the query is the input text (head, 1,000 chars) and the latest `agent` message (tail, 1,000 chars) joined by a newline; teacher messages are ignored; an empty query skips both search and probe.
Why: a bare answer like "42" needs the active problem to retrieve; caps keep one long message from bloating the query.
Alternatives: the last N messages; only the input.
Reversible: yes.

### 18 Oct 2026 · 3.4 The raw help state travels on `Entitled`, set by entitle from the same load · decided by builder (tdd-guide) · risk: medium
Decided: `entitle` copies `helpState` from the `TurnConfigStore.load` result it already ownership-checked onto `Entitled.helpState` (optional, unvalidated); `buildContext` parses it; the runner's `assemble()` deletes it before building TurnContext. `checkTurnConfig` (`access/**`) is unchanged.
Why: ADR-0005 says no extra query; keeping `access/**` out of this task avoids a risky-path change for a pass-through. Deleting the key before the strict TurnContext parse keeps the answer key out of the model context, events and traces.
Alternatives: pass it through `checkTurnConfig`'s `TurnConfig` (touches `access/**`); call `load` again in buildContext (an extra query).
Reversible: yes (harness-internal types).

### 18 Oct 2026 · 3.4 `serializeSessionHelp` refuses an invalid or oversized state · decided by builder (tdd-guide) · risk: low
Decided: `serializeSessionHelp` validates with `SessionHelpSchema` and throws when `JSON.stringify` is over `LIMITS.helpStateMaxJsonLength`.
Why: 3.8 then never builds a value the store would refuse; the store still enforces the cap itself (ADR-0005).
Alternatives: leave all checks to `SessionStateStore`.
Reversible: yes.
