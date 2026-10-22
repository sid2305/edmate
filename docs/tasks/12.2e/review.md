# 12.2e review — APPROVE
Reviewers: security-reviewer, code-reviewer, typescript-reviewer

security-reviewer (sonnet), code-reviewer (sonnet) and typescript-reviewer (opus) reviewed the /staff/reports page. requireRole(['staff']) runs before any read, no reporter identity is shown, client bodies match 12.2d's strict schemas, and the three destructive actions need a confirm click. No CRITICAL or HIGH. The plan asked for renderReply, which the page uses; the security reviewer's point that staff should not see live links in adversarial text is a hardening item. All MEDIUM and LOW findings go to 12.2g, which stays in M12 so it runs next.

## Findings
- [MEDIUM] [deferred 12.2g] apps/web/app/staff/reports/report-row.tsx:72 — reported text renders through renderReply, so markdown links are live anchors in front of staff; render as plain text and test with an embedded link.
- [MEDIUM] [deferred 12.2g] apps/web/app/staff/reports/view.tsx:94 — a poll that resolves after an action can bring back a dismissed report or lifted takedown; use a generation ref.
- [MEDIUM] [deferred 12.2g] apps/web/app/staff/reports/view.tsx:51 — every 400 says "Check the note" though the page sends no note; say it was already actioned, and hide the agent takedown button when one is active.
- [MEDIUM] [deferred 12.2g] apps/web/app/staff/reports/view.tsx:258 — takedown rows show only kind and teacher, and Lift has no confirm; show target, category and date and an aria-label per Lift.
- [LOW] [deferred 12.2g] apps/web/app/staff/reports/view.test.tsx:260 — no test fails if clearInterval or the no-overlap guard is removed.
- [LOW] [deferred 12.2g] apps/web/app/staff/reports/view.tsx:109 — a rejecting loader becomes an unhandled rejection.
- [LOW] [deferred 12.2g] apps/web/app/staff/reports/view.tsx:203 — the count shows in the fallback view and lacks an ICU plural.
- [LOW] [deferred 12.2g] apps/web/messages/en.json:783 — "can't be undone from here" is shown for takedowns that can be lifted.
- [LOW] [deferred 12.2g] apps/web/app/staff/reports/view.tsx:173 — `report.agentId as string` cast.
- [LOW] [deferred 12.2g] apps/web/app/staff/reports/report-row.tsx:27 — a third copy of the category list.
- [LOW] [deferred 12.2g] apps/web/app/staff/reports/view.tsx:101 — a successful poll clears an action's error.
- [LOW] [deferred 12.2g] apps/web/app/staff/reports/report-row.tsx:68 — createdAt shown as a raw ISO string.
