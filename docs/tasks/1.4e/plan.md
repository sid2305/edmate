# Task 1.4e: 1.4d follow-ups

Plan by the lead (small task).

## Goal
Acceptance (verbatim): "web typecheck, lint and test green; redis-ready.ts documents or handles a differing timeoutMs; the sandbox magic-link script run is recorded in the handoff."

## Part 1: whenReady and a differing timeoutMs (builder)
`apps/web/src/auth/redis-ready.ts` keeps one in-flight "ready" promise per Redis instance. A second caller that arrives while the first is waiting gets the first caller's promise, so its own `timeoutMs` is ignored (1.4d review LOW).

Handle it, rather than only documenting it: each caller keeps its own deadline. The shared promise stays (one `ready` listener per instance, which was the point of 1.4d); each call races that promise against its own timer, which rejects with `RedisNotReadyError` after that caller's `timeoutMs` and is cleared when the shared promise settles. The shared promise's own timeout is the first caller's, as today. Make sure an un-awaited rejection of the shared promise can't become an unhandled rejection when every racing caller has already timed out (attach a no-op catch to the shared promise, or equivalent).

Files: `apps/web/src/auth/redis-ready.ts` and its test file (risky path group `apps/web/src/auth/**`: security-reviewer required).

Tests first:
- A second caller with a shorter `timeoutMs` than the first rejects at its own deadline, while the first is still waiting.
- A second caller with a longer `timeoutMs` still resolves if `ready` fires after the first caller's deadline but before its own. (If that is impossible with one shared promise whose timer is the first caller's, say so in the handoff and log a builder decision: the shared promise's timeout becomes the longest pending deadline, or the shared promise has no timeout of its own and only callers time out. Prefer the latter if it keeps the code simplest: the listener is removed when the last waiting caller has timed out.)
- Still one `ready` listener for N concurrent callers (the existing 1.4d test stays green).
- No unhandled rejection (vitest fails on them by default).
- `src/auth/**` keeps 100% statement coverage (CI enforces it).

## Part 2: sandbox magic-link run (human step, B-61)
The run needs the compose stack rebuilt on current code, which agents don't do. The builder doesn't run it. The lead records the result in the handoff after the human answers B-61; if the answer is "skip until deploy", the lead logs that decision instead.

## Gate
```
corepack pnpm turbo run typecheck lint test --filter=@edmate/web...
corepack pnpm --filter @edmate/web exec vitest run --coverage src/auth
corepack pnpm exec prettier --check <changed files>
python3 .githooks/secret-scan.py --all
```

## Reviewers
security-reviewer (required, `apps/web/src/auth/**`), typescript-reviewer, code-reviewer. The lead logs a risk: high merge decision.

## Budget
Budget: 30 tool calls (1 phase, @edmate/web, 2 files).

## Open questions
None.
