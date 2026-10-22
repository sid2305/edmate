# 12.2c review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet), lead

The code-reviewer ran the web route, ReportButton and ChatView tests in a throwaway clone (all green) and checked the security points:
- The request body is a strict `{agentId, messageId, category}`. The student id comes only from the signed-in principal.
- A cross-session or cross-student report, an agent that isn't live, and a message that isn't a reply all return the same 404, so the route doesn't reveal which messages exist.
- Repository errors map to fixed codes with no raw text, and CSRF goes through the existing `withRole` guard.
- The client's category list matches the server's.

The typescript-reviewer found that the report state lived in the button instance. When the reply moved from the current turn into the thread, the button lost its "busy" or "Thanks" state, and the student could file the same report again. A fresh fixer moved that state into ChatView, keyed by messageId. Its new test fails without the fix and passes with it. The typescript-reviewer then checked the fix and approved it.

## Findings
- [HIGH] [fixed] apps/web/src/chat/ChatView.tsx — report state followed the component instance, not the messageId, so a reply moving into the thread lost "busy"/"Thanks" and could be reported twice; state is now lifted into ChatView by messageId, with a red-then-green test.
- [LOW] [fixed] apps/web/src/chat/ReportButton.tsx — `sessionId as string` replaced by a typed local bound after the null check.
