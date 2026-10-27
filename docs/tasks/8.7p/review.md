# 8.7p review — APPROVE

Reviewers: security-reviewer, code-reviewer, typescript-reviewer

## Findings
- [HIGH] [fixed] packages/db/src/repositories/redact-json.ts — redactString clipped each PHONE_CANDIDATE match against every exempt span, which is quadratic on crafted input; now sorted and merged spans with forward-only pointers, plus an adversarial timing test (security-reviewer)
- [MEDIUM] [deferred 8.7q] packages/db/src/repositories/audit.ts — storable() redacts before the size cap, so an oversized payload is redacted in full before it is refused (security-reviewer)
