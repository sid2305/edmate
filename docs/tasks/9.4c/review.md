# 9.4c review — APPROVE

Reviewers: code-reviewer, typescript-reviewer, security-reviewer

The render follow-ups are sound. The code reviewer found one HIGH: react-markdown's normalizeUri percent-encodes bidi and control characters before safeHref sees them, so the raw-character check never fired on real replies. The fix round makes safeHref decode each %XX run and drop it when it decodes to a Cc/Cf character, and tests it through the real renderer. The code reviewer re-verified it against the real micromark normalizeUri (mixed case, split runs, double encoding, malformed UTF-8): fixed, no new issues.

## Findings
- [HIGH] [fixed] apps/web/src/chat/renderReply.tsx:45 — percent-encoded bidi/control characters bypassed safeHref because normalizeUri encodes them first; safeHref now decodes %XX runs and drops Cc/Cf, tested through renderToStaticMarkup
- [LOW] [fixed] apps/web/src/chat/renderReply.tsx:87 — the narrowed MATH rule stops `$-$` and `$a-$` being read as maths; now documented and pinned by known-limit tests
- [LOW] [fixed] apps/web/src/chat/renderReply.test.tsx:241 — "costs $5 and $10" passed on the old regex too; moved into its own unchanged-case test so the table only holds cases that fail without the fix
