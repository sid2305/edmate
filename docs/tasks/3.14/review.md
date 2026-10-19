# 3.14 review — APPROVE
Reviewers: typescript-reviewer (sonnet; also covered silent failures)

What the reviewer confirmed:
- the Lua script is a single atomic EVAL, and its boundary matches the in-memory sliding window exactly;
- ZSET members are unique per take, so same-millisecond takes don't collide;
- PEXPIRE bounds memory, and `now` is injected;
- the types fit the harness TurnCounter/TurnLimits with no cast;
- there's no dependency cycle;
- Redis errors propagate, and policies.ts fails closed to `rate_limited`;
- CI runs the Redis int tests: a Redis service with TEST_REDIS_URL passed through turbo, and the suite throws rather than skips when CI=true.

queue 40 tests pass with turnLimits.ts at 100%; dependents pass.

## Findings
- [LOW] [wontfix] packages/queue/src/turnLimits.ts:56 — one documented cast to define the dynamic Lua command (ioredis has no typed generics). See the 3.14 decision.
