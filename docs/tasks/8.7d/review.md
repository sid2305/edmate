# 8.7d review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), silent-failure-hunter (sonnet), lead

## Findings

- [MEDIUM] [deferred 8.7l] apps/web/src/studio/publish.ts — when enqueue fails and the recovery finishRun(error) also fails, the run stays queued and the publish page shows "running" until the stale rule ends it (up to about 2 h 15 min). The handoff logs this double failure as an accepted risk: low; the follow-up has GET report an error for a queued run with no worker ack, or a sweep end it.
- [MEDIUM] [deferred 8.7l] apps/web/src/studio/publishClient.ts — failure() casts the error body with `as` instead of a zod schema; every field is typeof-narrowed first, so no unsafe read today.
- [LOW] [deferred 8.7l] apps/web/src/studio/publishClient.ts — fetch calls have no timeout, so a hung request stalls polling with no error shown.
- [LOW] [deferred 8.7l] apps/web/src/studio/publish.ts — start() awaits independent reads one after another; batch them with Promise.all.
- [LOW] [wontfix] apps/web/app/teacher/publish/PublishView.tsx — the `(v as K)` cast in pick() follows an `.includes()` check; it is the standard narrowing idiom, not a type gap.

Verified: the teacher id comes only from the session; the POST body is a strict empty object; the body cap fails closed; error mapping never exposes raw error text or ids; every response is no-store; polling has one in-flight guard and stops on a terminal status and on unmount; client payloads go through safeParse.
