# 11.1b review — APPROVE

Reviewers: typescript-reviewer (sonnet), code-reviewer (sonnet), lead

Both reviewers approved with no CRITICAL, HIGH or MEDIUM findings. The code-reviewer re-ran the web gate on a fresh clone (34/34 green). The teacher id always comes from the session principal, never the request body; `/api/studio/**` already requires the teacher role; links are https only and at most 2048 characters at the route, ahead of the repo's own check; the strict body schema refuses extra fields; the body size is capped before parsing; logs carry only the error name. The file list matches plan Phase B, with no auth or nav edits. The LOWs go to 11.1d.

## Findings
- [LOW] [deferred 11.1d] apps/web/app/teacher/live-classes/LiveClassesView.tsx:150 — every class's join link reads "Join link"; a screen-reader user can't tell them apart. Add an aria-label with the class title.
- [LOW] [deferred 11.1d] apps/web/src/studio/liveClasses/routes.test.ts — no test at the exact 2048-character boundary (only well over it).
- [LOW] [wontfix] apps/web/src/studio/liveClasses/routes.ts:52 — the https check is case-sensitive (`HTTPS://` is refused). Browsers send a lowercase scheme, and refusing is the safe side.
