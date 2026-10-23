# Handoff 9.4c: 9.4b review follow-ups in renderReply.tsx

**Status:** DONE
**Branch:** `m13/9.4c-render-followups` (built on local `work-94c`)
**Worktree:** `.claude/worktrees/agent-ac513b61c02fa6461`

## Summary

All three 9.4b review findings closed in `apps/web/src/chat/renderReply.tsx`.

1. **`safeHref` returns the cleaned href.** It now returns `cleaned` (the href with control,
   format and whitespace characters stripped) instead of the original `href`. The scheme/protocol
   check already ran on `cleaned`, so this was already a re-check after cleaning; only the return
   value was wrong. `\p{Cf}`/`\p{Cc}` already covers every character the brief named (U+200B-200F,
   U+202A-U+202E, U+2066-U+2069, U+FEFF, U+00AD) — all are Unicode format/control characters.
   Tests: `safeHref returns the href with invisible and bidi characters removed, not the original
   (9.4c)` (ZWSP, RLO, BOM, soft hyphen all clean to `https://example.com`, and
   `java<ZWSP>script:` still refuses once cleaned); `a U+202E inside an href never reaches the
   rendered href (9.4c)`.
2. **`protectMath` stops treating a tight price range as maths.** The single-`$` alternative in
   `MATH` now requires the character right before the closing `$` to not be `-`. That is exactly
   what made `$5-$10` match as `"$5-$"` (content `5-`, last char before the close is `-`) while
   leaving every existing maths test (subscripts, display maths, brackets, one-character `$x$`,
   TeX with `<>`, etc.) matching exactly as before — verified with a node script comparing the old
   and new regex across all of them before editing the file. `costs $5 and $10` was already not
   matched by the old regex (the space right before the second `$` already failed the old `\S`
   requirement), so no change was needed there, but it's covered by a test to pin the behaviour.
   Tests: `protectMath leaves a price range as plain text (%s) (9.4c)` for `$5-$10`,
   `price is $5-$10 today`, `costs $5 and $10`.
   **Known limit documented** (brief step 2's fallback): an en dash (`$5–$10`, U+2013) is not
   excluded — only an ASCII hyphen is — so it is still read as maths. Test:
   `known limit: protectMath still reads a price range as maths when it uses an en dash (9.4c)`.
3. **Dropped the unreachable `\$\S\$` alternative.** A one-character span is the zero-length case
   of the kept alternative's `[^$\n]*?`, so `\$\S\$` could never match anything the kept
   alternative didn't already match (confirmed with the node script before and after dropping it).
   Test proving `$x$` is still maths: `protectMath still treats a one-character $x$ span as maths
   (9.4c: the unreachable \`\$\S\$\` alternative was dropped)`, plus the pre-existing
   `'a one-character span'` case in the `TeX with markdown-like characters stays literal` table
   (line ~218, unchanged, still green).

## Files

- `apps/web/src/chat/renderReply.tsx`: `safeHref` returns `cleaned`; `MATH` regex changed from
  `` \$(?=\S)[^$\n]*?\S\$|\$\S\$ `` to `` \$(?=\S)[^$\n]*?[^-$\n\s]\$ ``; comments added explaining
  both.
- `apps/web/src/chat/renderReply.test.tsx`: added 6 cases (see Summary); `no-raw-html.test.ts`
  untouched.

## Tests (acceptance evidence)

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → `Tasks: 10 successful, 10
  total`.
- `python3 .githooks/secret-scan.py --all` → clean, no findings.
- Existing `renderReply` and `no-raw-html` tests (including the one-character `$x$` span, display
  maths, TeX with `<>`, and all the safety/XSS cases from 9.4/9.4b) still pass unchanged.

## Decisions

### 22 Oct 2026 · 9.4c ran over budget · decided by lead · risk: low
- Decided: accept 110 tool calls against the lead briefs' 40 + 35. The fix round had to prove the percent-encoded bidi case through the real react-markdown renderer, which took more calls than the brief allowed.
- Why: the extra calls bought the HIGH fix and real-renderer tests; nothing was left unfinished.
- risk: low

### 22 Oct 2026 · 9.4c price-range exclusion rule · decided by builder · risk: low

- Decided: exclude a `$...$` span from `protectMath`'s maths treatment only when the character
  immediately before the closing `$` is an ASCII hyphen (`-`). This is a narrow, provable rule
  (verified against every existing maths test with a standalone regex comparison before editing)
  that fixes exactly the case the review named (`$5-$10`) without touching genuine TeX subtraction
  like `$a-b$` (which ends in `b`, not `-`) or any other existing case.
- Why: the brief allowed documenting a known limit if no clean rule exists; this one is clean for
  the ASCII-hyphen case the review described, so it's fixed rather than just documented.
- risk: low

### 22 Oct 2026 · 9.4c en-dash known limit · decided by builder · risk: low

- Decided: leave an en-dash price range (`$5–$10`, U+2013) unfixed and document it as a known
  limit with a named test, rather than widening the exclusion to every dash-like character.
- Why: a broader dash class risks excluding genuine maths that legitimately ends a span in a
  non-ASCII symbol, and the brief explicitly allows documenting a known limit when no clean rule
  exists. KaTeX (noted in 9.4b's handoff) removes `protectMath` entirely, so this limit is
  temporary.
- risk: low

## Fix round (22 Oct 2026)

Three findings closed, same file scope (`renderReply.tsx`, its test file, this handoff).

1. **HIGH (code-reviewer): `safeHref` now also strips percent-encoded invisible/bidi
   characters.** react-markdown/remark-gfm run every link destination through micromark's
   `normalizeUri` before `SafeLink`/`safeHref` ever sees it, which percent-encodes every
   non-ASCII character, so the first fix round's `\p{Cc}\p{Cf}` strip never saw the attack through
   the real pipeline (it only matched a literal, raw Unicode character). `safeHref` now also finds
   every run of one or more `%XX` groups, tries `decodeURIComponent` on the run (a malformed run
   throws and is left byte-for-byte alone), and drops the whole run if the decoded text contains a
   `\p{Cc}`/`\p{Cf}` character; every other run (a genuine non-ASCII path, e.g. `%C3%A9`) is kept
   exactly as it was — it is never decoded back to a raw character. The scheme/protocol check
   still runs on the fully cleaned string.
   Tests now go through the real component with `renderToStaticMarkup` (not just `safeHref()`
   directly), per the review: `a U+202E or U+200B inside an href, raw or percent-encoded, never
   reaches the rendered href (9.4c fix round)` (6 cases: raw RLO, raw ZWSP, and their %E2%80%AE /
   %E2%80%8B forms in both hex cases); `a normal non-ASCII percent-encoded path stays unchanged
   through the real pipeline (9.4c fix round)` (`/caf%C3%A9` unchanged); `a percent-encoded hidden
   scheme is still refused through the real pipeline (9.4c fix round)` (`java%E2%80%8Bscript:`
   still has no `href`). The old `safeHref returns the href with invisible and bidi characters
   removed...` and `a U+202E inside an href never reaches the rendered href (9.4c)` tests (which
   called `safeHref()` directly with a raw character, a shape that never occurs through the real
   caller) are kept — they still prove the direct-call path — but are no longer the only coverage.
2. **LOW (typescript-reviewer): known limit for a maths span ending in a hyphen.** Added
   `known limit: protectMath no longer reads a genuine maths span ending in a hyphen as maths`,
   pinning `$a_1-$` and `$-$` next to the existing en-dash known-limit test.
3. **LOW (security-reviewer): moved the "costs $5 and $10" case out of the new-behaviour table.**
   It passes on the old regex too (the space before the second `$` already failed the old `\S`
   requirement), so it doesn't prove this task's fix. Moved to its own test,
   `protectMath leaves two separate amounts joined by "and" as plain text (unchanged: already true
   on the old regex)`, with a comment explaining it's a regression pin, not proof of the new rule.
   The `it.each` table now only holds the two cases (`$5-$10`, `price is $5-$10 today`) that fail
   without the fix.

Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` → `Tasks: 10 successful,
10 total`. `python3 .githooks/secret-scan.py --all` → clean.

Tool calls used: 110 (harness count: builder 48 + fixer 62; the agents reported 19 + about 30)
