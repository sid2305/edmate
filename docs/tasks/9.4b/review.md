# 9.4b review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet)

Both reviewers approve. Neither found anything CRITICAL or HIGH. They confirmed:
- the allowlist (`allowedElements` + `unwrapDisallowed`) keeps headings, images, svg, script, iframe and form out;
- no raw-HTML plugin is installed;
- task-list checkboxes render as text;
- links are http/https/mailto only;
- `singleTilde: false` is in place;
- the dependency pins are exact;
- `no-raw-html.test.ts` is untouched;
- the regexes have no catastrophic backtracking.

## Findings

- [MEDIUM] [deferred 9.4c] apps/web/src/chat/renderReply.tsx:52 — `safeHref` checks the cleaned href but returns the original. So invisible or bidi characters (U+200B, U+202E) stay in the rendered `href` and can make the shown URL misleading. Fix: return `cleaned`.
- [LOW] [deferred 9.4c] apps/web/src/chat/renderReply.tsx:77 — `protectMath` reads `$5-$10` (no space before the second `$`) as maths and escapes the markdown inside it. Undocumented known limit.
- [LOW] [deferred 9.4c] apps/web/src/chat/renderReply.tsx:77 — the `\$\S\$` alternative in `MATH` can never match, because the first `$…$` alternative already covers it. Drop it.
