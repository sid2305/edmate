# 9.4 review — APPROVE
Reviewers: security-reviewer (opus), code-reviewer (sonnet), typescript-reviewer (sonnet)

security-reviewer passed Phase A (at d4af5a6) with no CRITICAL or HIGH findings: clearance `agent`
on both routes, no IDOR (ids come from the session and the URL; the body schema refuses them),
and the reply is held until checked. code-reviewer and typescript-reviewer approved the whole
branch at abb85ed. typescript-reviewer re-ran typecheck, lint and test (34/34, 592 passed). The
bundled-prices fix (6bcc985) was verified with `next build --webpack` and the relocated
build-smoke run. Phase D's 10 Playwright cases pass locally.

## Findings
- [MEDIUM] [fixed] apps/web/src/turn/routes.ts:99 — `req.json()` read an unbounded body; now 413 above 64 KB on both declared and read bytes (security-reviewer).
- [MEDIUM] [fixed] apps/web/src/turn/runtime.ts:53 — EDMATE_MARKET silently defaulted to `global`, which picks the distress helplines; in production it now fails closed with 503 (security-reviewer).
- [MEDIUM] [fixed] packages/gateway/src/pricing/load.ts:64 — the runtime read of prices.yaml failed under webpack bundling, so every session start answered 503 in a production build; it is now a generated, statically imported module with a drift test (found by the Phase D builder).
- [LOW] [deferred 9.4a] apps/web/src/turn/routes.ts:187 — no rate limit on session starts (security-reviewer).
- [LOW] [deferred 9.4a] apps/web/src/turn/runtime.ts:53 — one configured market per server; read the student's market from identity per turn (security-reviewer, handoff decision).
- [LOW] [deferred 9.4a] apps/web/src/chat/liveChats.ts — /home links come from EDMATE_CHAT_AGENTS until a scoped student-subscription lookup exists in packages/db (handoff decision).
