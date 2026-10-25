**Status:** DONE

## What changed

`apps/web/src/chat/liveChats.ts` `homeLinks`: the two subscription reads
(`listLiveForStudent`, `listUnavailableForStudent`) now start together via one
`Promise.all`, right after `open()`, instead of `listUnavailableForStudent` being
issued after the owner-lookup pass that follows the live read. The single shared
`try/catch` and every output field are unchanged.

`apps/web/src/chat/liveChats.test.ts`: added
"starts the live and unavailable reads together, before either resolves" using
deferred promises for both reads and a shared `calls` array to assert call order
(`['live.start', 'unavailable.start']`) before either resolves, then resolves them
out of order (unavailable first) and checks the final `chats`/`unavailable` output
is correct. The existing failure-path tests for each read
("a failing live-list query gives no links...", "a failing unavailable-list query
gives no links at all...") already prove a failure in either still takes the one
shared catch; both still pass unchanged against the new parallel code.

## Evidence

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force`: exit 0,
  `Tasks: 10 successful, 10 total`. Test run: `Test Files 157 passed (157)`,
  `Tests 2483 passed (2483)` -- none skipped. `src/chat/liveChats.test.ts (24 tests)`
  all passing; `liveChats.ts` coverage 100/100/100/100.
- `python3 .githooks/secret-scan.py --all`: clean, no output.

## Decisions

None.

## Budget

Tool calls used: 21 (harness count; the agent reported 17)
