# 8.7p plan (lead-written)

Status: READY

## Goal
Two review follow-ups in `packages/db/src/repositories/redact-json.ts` (and its test file
`packages/db/test/redact-json.test.ts`), both deferred from 8.7m and 8.7o. No contracts change,
no migration.

1. **Phone candidate crosses an exempt span's boundary (8.7m typescript-reviewer MEDIUM).**
   `PHONE_CANDIDATE`'s lookbehind only excludes a start preceded by `[\p{N}_.+-]`; a start
   preceded by a letter is allowed (that is the 8.7m fix). So inside a `rp_<hex40>` id, a UUID, or
   a bare hex digest whose text has a run like `<letter><digit>+` right before a trailing space,
   `PHONE_CANDIDATE` can start **inside** the exempt span (on that trailing digit run), then its
   middle class `[\d\s().-]` happily eats the space and keeps going straight into a real phone
   number that follows. The combined match is not *fully* contained in any exempt span (it starts
   inside one and ends past it), so today's `coveredBy` check (`start >= s0 && end <= s1`) says
   "not covered" and the whole thing — the id's tail **and** the phone — gets replaced by one
   `REDACTED`. The id survives today only when something non-digit/space (a word like `call`, or a
   `_`/digit/`.`/`+`/`-` right before the match start) breaks the run; a bare single space does
   not.
2. **Low surrogate stepped over without checking for a high surrogate (8.7o typescript-reviewer
   LOW, triaged by the lead on 26 Oct 2026).** In `redactEmails`'s left-walk over the local part,
   when the character at `charStart` is a low surrogate (`0xdc00`–`0xdfff`) and `charStart > pos`,
   the code steps `charStart` one further left *unconditionally* and reads
   `s.codePointAt(charStart)` there — without first checking that the unit at `charStart - 1` is
   actually a high surrogate (`0xd800`–`0xdbff`). On a **lone** low surrogate (no real pair), this
   reads and tests whatever ordinary character sits one position earlier instead of the lone
   surrogate itself (whose Unicode category is `Cs`, not `\p{L}`/`\p{N}`, so it should stop the
   walk right there). If that earlier character happens to pass `EMAIL_LOCAL_CHAR`, the walk keeps
   going past it, silently swallowing the lone low surrogate into the local part and extending the
   match (and the redaction) further left than the old regex ever would — over-redaction, not a
   leak, but wrong.

## Steps (tests first, one red case per item)

### Item 1 — stop a phone candidate at an exempt span's boundary

1. Add a failing test (or three — one per exempt-span kind) in
   `packages/db/test/redact-json.test.ts`, each asserting the id/UUID/digest text survives intact
   and the phone number right after it (separated by one space, nothing else) is redacted:
   - A `rp_<hex40>`-shaped id ending in a `<letter><digit>+` run right before the space, e.g.
     `rp_${'a'.repeat(39)}1` (39 `a`s then one digit — the digit is what lets a candidate start).
   - A UUID whose last hex group has the same `<letter><digit>+` shape right before its end, e.g.
     `12345678-1234-4234-8234-a23456789012`.
   - A bare hex digest (32+ chars) with the same shape, e.g. `${'a'.repeat(31)}2`.
   Each followed by `' 555-010-0199'`; expect the id/UUID/digest text unchanged and
   `${REDACTED}` in place of the phone only (accept line's own example:
   `"rp_<hex40> 555-010-0199"` keeps the id and redacts the phone).
   Confirm these fail on the current code (the whole id-tail + phone collapses into one
   `REDACTED`) before touching `redact-json.ts`.
2. Add a property/fuzz test in the same style as the existing `rp_`/UUID property tests: generate
   many random combinations of (a fake prefixed id, a crafted UUID, or a hex digest) + `' '` +
   a phone-shaped run, and assert, for each: the output still contains the original id/UUID/digest
   string unchanged, and the output does **not** contain the phone's raw digits anywhere (the
   phone is still redacted — this is the "no phone run survives" half of the accept line). Keep
   this seeded (mulberry32 or similar), not `Math.random`.
3. Fix in `redact-json.ts`. Suggested approach (the builder may pick another and must explain it
   in the handoff): stop computing a single boolean "is this whole match covered" and instead clip
   the candidate's start/end inward past any exempt span it overlaps, before deciding whether the
   *remaining* text is a phone number:
   - Replace the `afterEmail.replace(PHONE_CANDIDATE, callback)` call with a manual scan
     (`PHONE_CANDIDATE.exec` in a loop, same idiom as `redactEmails`), so each match's bounds can
     be adjusted before the digit-count/`NOT_A_PHONE` check runs.
   - For each raw match `[start, end)`: if `start` falls inside an exempt span `[s0, s1)`, move
     `start` to `s1`; if `end - 1` falls inside an exempt span `[s0, s1)`, move `end` to `s0`;
     repeat until neither moves (handles adjacent/overlapping spans; the loop is bounded by the
     small number of exempt spans near one match, not by string length, so this does not reopen
     the quadratic-EMAIL class of bug — see "Keep it linear" below). If `start >= end` after
     clipping, the match was entirely inside exempt spans (today's "fully covered" case): leave
     the text untouched, same as now.
   - Otherwise redact `[start, end)` as before, re-running the existing digit-count and
     `NOT_A_PHONE` checks on the **clipped** text (not the raw match), so a clipped remainder that
     is too short or looks like a date/decimal still survives, same safety margin as today.
   - `coveredBy` becomes unnecessary (or is replaced by this clip step); remove it if unused, and
     update the comment above `redactString`/`PHONE_CANDIDATE` describing the new clip-at-boundary
     behaviour (today's comment only describes full containment).
   - Re-check (and update comments if needed) the already-locked tests that `redactString`'s exempt
     spans still catch: fully-covered matches (the 8.7h UUID-shaped-digits-look-like-a-phone case),
     the no-separator glued-UUID-and-phone case, and the no-separator glued-letter-onto-UUID case —
     none of these should change, because none of them has an exempt span that only partially
     overlaps a `PHONE_CANDIDATE` match (confirmed while planning: a `HEX_DIGEST` or `PREFIXED_ID`
     span always needs a character — an a–f letter, or `_` — that is outside `PHONE_CANDIDATE`'s
     own character class, so those two span kinds can only ever touch a phone match at an edge,
     never sit fully inside one; a `UUID` span built entirely from digits and dashes technically
     could sit fully inside a longer digit/dash run with no letter anywhere, but that is exactly
     today's pre-existing "fully covered" case already handled). If the builder finds a case this
     reasoning missed, note it in the handoff rather than silently changing scope.

### Item 2 — check for a high surrogate before stepping back over a low one

4. Add a failing test in the `redactEmails linear time (8.7o)` describe block (same style as its
   two existing surrogate tests — the astral-pair one and the lone-surrogate-at-string-start one),
   covering the branch neither of those two reaches: a **lone** low surrogate *inside* a local-part
   run, with `charStart > pos` true (so the existing start-of-string guard does not short-circuit
   first). Example: `s = 'z\udc00x@a.bc'` — walking left from `@`, `'x'` is consumed first, then
   the lone `'\udc00'` is hit with `charStart (1) > pos (0)` true; on the current code this steps
   back one more to `'z'` (position 0), tests `'z'`, and (wrongly) includes positions `[0, 3)` in
   the local part. The correct result (matching the old regex) only ever includes `'x'`: assert
   `redactEmails(s)` equals `s.replace(OLD_EMAIL, REDACTED)` (the differential pattern already used
   elsewhere in this block), and confirm it fails on the current code before fixing.
5. Fix: before stepping `charStart` back an extra position, also require that
   `s.charCodeAt(charStart - 1)` is a high surrogate (`>= 0xd800 && <= 0xdbff`); only then is this a
   real surrogate pair worth stepping over as one unit. Keep the existing `charStart > pos` guard
   (unchanged — still needed for the string-start case). When the extra check fails, `charStart`
   stays where it is (pointing at the lone low surrogate); `codePointAt` there returns the lone
   surrogate as its own code point, `EMAIL_LOCAL_CHAR.test` correctly rejects it (category `Cs`),
   and the walk stops in the right place.
6. Add an unpaired-surrogate case to the differential fuzz alphabet: add a lone low surrogate
   (`'\udc00'`) and a lone high surrogate (`'\ud800'`) to the `ALPHABET` string used by
   `randomString` (the 50,000-draw seeded fuzz), so future regressions in this area have a chance
   of being caught by the existing fuzz, not only by the hand-written case above. Re-run that fuzz
   test and confirm it still passes (lone surrogates are valid, if unusual, JS string content; they
   must not throw).
7. Re-run the two existing surrogate tests (astral pair; lone low surrogate at string start) to
   confirm the new high-surrogate check does not change their outcome (traced by hand while
   planning: the astral-pair test's preceding unit really is a high surrogate, so the extra check
   passes and behaviour is unchanged; the string-start test already short-circuits on
   `charStart > pos` before reaching the new check).

## Keep it linear
No change to any regex pattern (`EMAIL_LOCAL_CHAR`, `EMAIL_DOMAIN`, `PHONE_CANDIDATE`, `UUID`,
`PREFIXED_ID`, `HEX_DIGEST`) — only the surrounding scan logic. The item-1 clip loop walks a small,
local list of exempt spans per `PHONE_CANDIDATE` match, not the whole string, so it stays in the
same complexity class as today's `coveredBy` (`spans.some(...)` per match); it must not become a
nested scan over the full string per match. The item-2 fix adds one more condition to an existing
`if`, no new loop. Re-run the existing 8.7o timing tests (`redactEmails linear time` describe
block, six cases at 200k–300k characters, 1000 ms bound) unmodified and confirm they still pass.

## Risky paths
`packages/db/src/repositories/**` (reviewers: security-reviewer, per
`.claude/skills/merge-gate/risk-paths.txt`). The lead also runs typescript-reviewer, per this
task's own line. (Note for the lead: 8.7m and 8.7o on this same file both also ran code-reviewer;
consider doing the same here for consistency, though the task text only names the two above.)

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db`
- `corepack pnpm exec prettier --check packages/db/src/repositories/redact-json.ts packages/db/test/redact-json.test.ts`
- `python3 .githooks/secret-scan.py --all` (fake addresses/phones only, e.g. example.com/.org,
  555-01xx-style numbers, as the existing tests already do)
- `redact-json.ts` must stay at 100% statements/branches/functions/lines (both new branches —
  item 1's clip-vs-no-clip, item 2's real-pair-vs-not — need a test each; items 4 and the astral
  test together cover item 2's branch, per the trace in step 7).

## Open questions
None. Both items are deferred MEDIUM/LOW findings with an already-agreed fix direction from the
8.7m and 8.7o reviews; no spec conflict.

## Budget
Budget: 30 tool calls (1 phase, packages/db)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (typecheck/lint/test for @edmate/db, prettier --check, secret
scan only — no other shell commands needed for this task)

## Exit conditions
Status: DONE once both red tests are shown failing pre-fix, both fixes land, the three gate
commands are green, and `redact-json.ts` coverage stays at 100%. Status: PARTIAL if the builder
finds a real counter-example to the "exempt spans only touch a phone match at an edge, never sit
fully inside one" reasoning in step 3 that needs a design change, or passes roughly 30 tool calls
with either item still red.
