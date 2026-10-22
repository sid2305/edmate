# 8.7e review — APPROVE

Reviewers: typescript-reviewer (sonnet, also as code-reviewer), lead

The loader reads `repos.publish.publicScorecard` and passes the row through `toPublicScorecard`, whose zod schema strips the private fields (byOrigin, totals, timestamps); the test fixture includes them on purpose. A missing scorecard and a read failure render the same empty state, and the catch logs only the error name. Draft agents and unverified teachers are filtered inside the repository's joins. Only `agentIds[0]` is read, which matches the plan's MVP rule of one agent per teacher.

## Findings

- [LOW] [deferred 8.7l] apps/web/app/teachers/[slug]/page.tsx — the offers read and the scorecard read run one after the other though they are independent; one Promise.all saves a round trip.
- [LOW] [deferred 8.7l] apps/web/app/teachers/[slug]/page.test.tsx — the "draft agent" test mocks the same null reply as the first null test, so it adds no coverage of the repository's draft filter; merge or rename it.
