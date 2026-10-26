# 8.7m review — APPROVE

Reviewers: code-reviewer, typescript-reviewer, security-reviewer

## Findings
- [CRITICAL] [fixed] packages/db/src/repositories/redact-json.ts — with letters no longer blocking PHONE_CANDIDATE, digit runs inside `rp_<hex40>` report ids (stored in audit JSON) were redacted, corrupting about 3.65% of ids; prefixed-id and hex-digest spans are now exempt (security-reviewer, typescript-reviewer)
- [HIGH] [fixed] packages/db/src/repositories/redact-json.ts — HEX_DIGEST also exempted pure-digit runs of 32+ characters, which main redacts; it now requires an a–f letter (typescript-reviewer)
- [MEDIUM] [fixed] packages/db/test/redact-json.test.ts — no test recorded the accepted over-redaction of a letter glued onto a UUID (typescript-reviewer)
- [MEDIUM] [deferred 8.7p] packages/db/src/repositories/redact-json.ts — an id or hex digest followed by one space and a phone number is redacted together with the phone, losing the id's tail; no personal data leaks (typescript-reviewer)
- [LOW] [fixed] packages/db/test/redact-json.test.ts — the glued UUID-and-phone test passes on pre-8.7m code too; a comment now says it guards the fail-closed invariant (typescript-reviewer)
- [LOW] [deferred 8.7o] packages/db/src/repositories/redact-json.ts — pre-existing: the EMAIL regex is quadratic on adversarial input (about 8 s at 120k characters) (security-reviewer)
