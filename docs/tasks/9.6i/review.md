# 9.6i review — APPROVE

Reviewers: security-reviewer (sonnet), lead

changePackage now uses the same liveTarget join as start (verified teacher, live version, live agent). It refuses a free target while the teacher's free tier is alarm-paused, which closes the paid-then-free bypass. A non-live version, a rejected teacher or a suspended agent stays not_found, so the alarm state can't be probed. The start route's findLive check only changes the 409 wording, reads the student's own scope, and gives a 500 on a read failure. change.ts logs only the error name on 500 paths. The plan page fails closed on a getById miss. The reviewer re-ran db and web typecheck, lint and test (34/34 green). Earlier accepted items (the alarm-marker window, the cancel-then-start trial reset, resume's tie-break, a paid start with no payment until M10) are unchanged.

## Findings
None.
