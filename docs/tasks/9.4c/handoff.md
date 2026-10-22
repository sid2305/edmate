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

## Tool calls used: 19
