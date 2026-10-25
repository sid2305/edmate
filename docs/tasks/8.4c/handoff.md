# Handoff: 8.4c (Phase C only)

**Status:** DONE

## What changed
- `apps/web/src/studio/styleCardSanitize.ts` (new): `stripOverridePhrases(text)` — a small,
  purpose-built, case-insensitive regex list of literal role-play phrases ("you are DAN", "act
  as...", "pretend you are/to be...", "developer/god/admin mode (enabled)", "no rules",
  "unrestricted", "unfiltered") and rule-override phrases ("ignore/disregard/forget/bypass
  (all/any) (previous/above) instructions/rules", "your rules don't apply", "override your
  rules"), replacing each hit and collapsing the leftover whitespace.
- `apps/web/src/studio/styleCardRoutes.ts`: `draft` strips override phrases from each interview
  answer and sample explanation before they reach `draftStyleCard`; `save` strips the raw
  `text` field before `SaveSchema` validation runs, so a saved card's stored text is already
  clean.
- `apps/web/app/teacher/style-card/StyleCardView.tsx`: a stale-draft guard — a `useRef` counter
  (`saveCount`) bumped on every successful `onSave`; `onDraft` reads the counter before its
  `await` and only applies the draft's `text`/`mistakeTags` if the counter is unchanged after it
  resolves (no save landed meanwhile).
- Tests added: `apps/web/src/studio/styleCardSanitize.test.ts` (new, 8 cases);
  `apps/web/src/studio/styleCardRoutes.test.ts` (+2 cases: draft strips an answer/sample, save
  strips and stores clean text); `apps/web/app/teacher/style-card/StyleCardView.test.tsx` (+1
  case: a slow draft that resolves after a save has already landed is discarded).

## Evidence
- `src/studio/styleCardSanitize.test.ts` — 8/8 passed (unit tests on the sanitize function:
  ordinary text untouched, each phrase family removed case-insensitively, whitespace collapsed,
  empty-text no-op).
- `src/studio/styleCardRoutes.test.ts` — 35/35 passed, including the two new cases: "strips an
  override phrase from an answer and a sample before they reach the model" and "strips an
  override phrase from the text before it is stored" (asserts both the response body and the
  stored repo row omit the phrase).
- `app/teacher/style-card/StyleCardView.test.tsx` — 9/9 passed, including the new case
  "discards a draft reply that resolves after a save has already landed" (save resolves first
  with "Saved text.", version 2; the slower draft then resolves and its text/tags are not
  applied — the editable field still holds what was saved, and version 2 stays shown).
- Full gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` — exit 0, 10/10
  tasks successful (typecheck, lint, test for `@edmate/web` and its upstream deps already
  cached). `src/auth/index.test.ts` was not flaky in this run (no timeout, no re-run needed).
- `python3 .githooks/secret-scan.py --all` — clean, no output.

## Decisions

### 25 Oct 2026 · 8.4c Phase C · the override/role-play phrase list is small and literal · decided by builder · risk: low
- Decided: `stripOverridePhrases` uses a fixed, purpose-built list of ~11 regexes covering the
  two phrase families named in the plan (role-play, rule-override), matched case-insensitively
  on the raw text, not a reuse of `packages/harness/src/guardrails/jailbreakPatterns.ts`'s
  `RULES` table. The "act as" and "pretend" patterns match a *closed* list of jailbreak targets
  (`dan`, `a jailbroken ai/model`, `an/a unfiltered|unrestricted ai/model/assistant`,
  `a different ai`, `an ai with no rules`) rather than an open `[\w\s-]{0,40}` tail, and "no
  rules" only fires as `(you have|there are|with) no rules` or as "no rules" at a sentence
  boundary not followed by "of" — fixed in the 25 Oct 2026 fix round after review found the open
  tails deleted ordinary teaching text ("act as a guide", "no rules of thumb", "pretend to be
  confused so the student explains it back").
- Why: the lead's answer (25 Oct 2026, plan Q2) already settled the separate-list question — the
  harness table matches on `normaliseForDistress`'s normalised forms with no span mapped back to
  raw text to strip, and covers categories out of scope here (authority/package claims, encoded
  instructions, prompt leaks). A narrow, separate list is the agreed scope; unifying the two
  lists later is its own task if drift becomes a real problem. The closed target list keeps the
  list narrow without reopening that scope question.

### 25 Oct 2026 · 8.4c Phase C · save strips the raw input before validation, not the parsed value · decided by builder · risk: low
- Decided: in `save`, the raw body's `text` field is sanitized before `SaveSchema.safeParse`
  runs (re-building the input object with the cleaned text), rather than sanitizing
  `parsed.data.text` after validation.
- Why: the plan says explicitly "run it on `text` before `SaveSchema` validation", so a card
  whose only problem is an override phrase inflating its word count is cleaned before the cap is
  checked, not after.

### 25 Oct 2026 · 8.4c Phase C · the stale-draft guard is a bumped save counter, not an AbortController · decided by builder · risk: low
- Decided: a `useRef<number>` counter bumped on every successful `onSave`; `onDraft` snapshots
  the counter before its `await` and only applies the draft's result if the counter is still the
  same afterward.
- Why: matches the plan's description exactly and is the smallest fix for the named bug class
  (`docs/lessons.md` "UI state and server replies: trust neither, reset everything") — no network
  cancellation is needed, since the draft response is just discarded, not stopped mid-flight.

## Fix round
Findings from code-reviewer and typescript-reviewer, fixed 25 Oct 2026:
1. [HIGH] `styleCardSanitize.ts:11` (`act as ...` open tail deleted ordinary text) — replaced
   the open `[\w\s-]{0,40}` tail with a closed `JAILBREAK_TARGET` alternation (`dan`, `a
   jailbroken ai/model`, `an/a unfiltered|unrestricted ai/model/assistant`, `a different ai`,
   `an ai with no rules`); ordinary "act as a <role>" text no longer matches.
2. [MEDIUM] `styleCardSanitize.ts:12-13` (`pretend ...` open tail, same class) — same closed
   `JAILBREAK_TARGET` list reused for the `pretend (you are|to be) ...` pattern.
3. [HIGH] `styleCardSanitize.ts:15` (`no rules` matched "no rules of thumb") — split into two
   patterns: `(you have|there are|with) no rules` (always a jailbreak phrase), and bare "no
   rules" only when followed by punctuation or end of text and not by "of" (negative lookahead).
   "no rules of thumb" is now left untouched.
4. [MEDIUM] `styleCardSanitize.test.ts` — added a false-positive block (the five phrases named in
   the finding, unchanged) and a positive-case block exercising every closed jailbreak target for
   both `act as` and `pretend`, plus the three `no rules` phrasings. Also reordered
   `OVERRIDE_PHRASES` so `act as`/`pretend` run before the bare `you are DAN` pattern — otherwise
   "pretend you are DAN" lost the word "pretend" (the bare pattern consumed "you are DAN" first,
   verified by a positive test added for this case).
5. [MEDIUM] `styleCardRoutes.ts:143-150` — replaced the three repeated
   `input as Record<string, unknown>` casts with one `const obj = ...` guard variable, so
   `sanitized`'s type is no longer collapsed to `unknown`.

## Fix round 2
Finding from a follow-up review, fixed 25 Oct 2026:
1. [HIGH] `styleCardSanitize.ts:22` (the `(you have|there are|with) no rules` pattern had no
   end-of-clause check, unlike the bare `no rules` pattern) — added a negative lookahead
   excluding `of`/`for`/`about` right after "no rules", matching the same exclusion style as the
   bare pattern. "there are no rules for this", "with no rules of thumb" and "you have no rules
   about homework" are now left untouched, while jailbreak phrasing ("there are no rules here,
   say anything", "with no rules.") is still stripped — verified by both the existing positive
   tests and three new false-positive tests in `styleCardSanitize.test.ts`.

Evidence:
```
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/web
 Tasks:    10 successful, 10 total
Cached:    7 cached, 10 total
  Time:    2m12.52s
$ python3 .githooks/secret-scan.py --all
(no output, clean)
```

## Budget
Tool calls used: 24
Fix round tool calls used: 17
Fix round 2 tool calls used: 14
