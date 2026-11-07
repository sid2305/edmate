# Handoff: 9.9e — live-demo precondition doc + drafted interim US/global privacy notices

Status: DONE.

## Files changed
- `content/legal/privacy-notice/US.md` — body rewritten exactly as the plan specified (front
  matter byte-identical: `version: draft-0`, `market: US`, `reviewedBy: pending`,
  `reviewedOn: "2026-10-20"`).
- `content/legal/privacy-notice/global.md` — same treatment (front matter byte-identical:
  `version: draft-0`, `market: global`, `reviewedBy: pending`, `reviewedOn: "2026-10-20"`).
- `docs/live-demo.md` — one new bullet in "1. What you need" naming the signed-privacy-notice
  precondition; one new entry in "7. Troubleshooting" for the exact log line and fix.
- `docs/tasks/9.9e/handoff.md` (this file).

Not touched: `apps/web/src/auth/age.ts`, `docker/compose.live.yaml`,
`content/legal/privacy-notice/IN.md`, `packages/content/src/privacyNotices.ts`, and all three test
files named in the plan (`realPrivacyNotices.test.ts`, `privacyNotices.test.ts`,
`validate.test.ts`).

## New bodies (pasted in full)

**`content/legal/privacy-notice/US.md`** (front matter unchanged above the `---`):

```
# Privacy notice (United States) — demo draft, pending sign-off

[PLACEHOLDER] This is a demo-only draft, not legal text. It is not Edmate's privacy notice and
must not be shown to real learners as one. It was drafted under board task 9.9e to unblock the
live product demo only; a named person must review and sign it (`reviewedBy`) before it may be
used even for that demo. The real notice for real US learners stays parked at board task 3.10c
(M13) for counsel to write (B-27) — signing this draft does not change that. Until `reviewedBy`
here is no longer "pending", `edmate content validate` fails on this file, same as before this
draft.

## Who this demo is for

This is an internal product demo, not a public pilot and not open to real students. There are no
real learners on it. Every account on it is created and used only by the Edmate team or by someone
they have personally invited to try it.

## What the demo stores, in plain language

- **Age screen.** Signing in asks which country you say you live in and the year you were born
  (never a full birth date). This is the locale pack's age check; nothing from that answer is kept
  beyond the birth year and the market it was answered against.
- **Account and chat data.** Your account, sign-in sessions, and your chat messages with a
  teacher's agent are stored in this demo's own Postgres database, on the one server running the
  demo. Nothing is sent to a third party except the AI model calls needed to generate a reply, and,
  when you sign in, the email carrying your sign-in link.
- **Uploaded material.** Anything a teacher uploads to build their agent (documents, slides, short
  recordings) is stored in this demo's own S3-compatible object storage, on that same server.
- **No selling of data.** Nothing collected here is sold, or shared for advertising, in this demo
  or otherwise.

## What this draft does not do

It does not state a retention period, a named privacy contact, or which specific law applies — the
real, counsel-reviewed notice (board task 3.10c) decides those. This draft exists only so a named
human can read the plain description above, judge whether it is accurate and fair for a demo with
no real learners, and sign it for that limited purpose.
```

**`content/legal/privacy-notice/global.md`** (front matter unchanged above the `---`):

```
# Privacy notice (default, every market without its own) — demo draft, pending sign-off

[PLACEHOLDER] This is a demo-only draft, not legal text. It is not Edmate's privacy notice and
must not be shown to real learners as one. It was drafted under board task 9.9e to unblock the
live product demo only; a named person must review and sign it (`reviewedBy`) before it may be
used even for that demo. A real, market-specific notice (counsel-reviewed where one is needed)
replaces this default for any market that gets its own pack — this draft does not decide that.
Until `reviewedBy` here is no longer "pending", `edmate content validate` fails on this file, same
as before this draft.

## Who this demo is for

This is an internal product demo, not a public pilot and not open to real students. There are no
real learners on it. Every account on it is created and used only by the Edmate team or by someone
they have personally invited to try it.

## What the demo stores, in plain language

- **Age screen.** Signing in asks which country you say you live in and the year you were born
  (never a full birth date). This is the locale pack's age check; nothing from that answer is kept
  beyond the birth year and the market it was answered against.
- **Account and chat data.** Your account, sign-in sessions, and your chat messages with a
  teacher's agent are stored in this demo's own Postgres database, on the one server running the
  demo. Nothing is sent to a third party except the AI model calls needed to generate a reply, and,
  when you sign in, the email carrying your sign-in link.
- **Uploaded material.** Anything a teacher uploads to build their agent (documents, slides, short
  recordings) is stored in this demo's own S3-compatible object storage, on that same server.
- **No selling of data.** Nothing collected here is sold, or shared for advertising, in this demo
  or otherwise.

## What this draft does not do

It does not state a retention period, a named privacy contact, or which specific law applies —
whoever writes the real notice for a given market decides those. This draft exists only so a named
human can read the plain description above, judge whether it is accurate and fair for a demo with
no real learners, and sign it for that limited purpose.
```

Both bodies were copied verbatim from the plan, so neither drops `[PLACEHOLDER]` nor the
`/not legal text/i` match that `realPrivacyNotices.test.ts` requires on every currently-unsigned
notice.

## `docs/live-demo.md` additions

New bullet added after the existing two in "1. What you need" (exact text from the plan):

```
- A **signed privacy notice** for whichever market a demo student picks at the age gate (`US`, or
  `global` for "somewhere else") — `content/legal/privacy-notice/US.md` and `global.md` must have
  `reviewedBy` set to a real name, not `pending`. `docker/compose.live.yaml` sets
  `AGE_NOTICE_ALLOW_UNSIGNED: 'false'`, so a signed-in student's age-check step fails in production
  until this is true. `content/legal/privacy-notice/US.md` and `global.md` carry a drafted,
  demo-honest body (board task 9.9e) ready for a named human to review and sign; nobody else may
  set `reviewedBy`. If it is still `pending`, read the draft, and if it is accurate for this demo,
  change that file's `reviewedBy` (and, if not already done, confirm `[PLACEHOLDER]` reads as
  intended) before running step 3 below.
```

New entry added under "New on the live stack" in "7. Troubleshooting" (exact text from the plan):

```
- **The `web` service logs `privacy notice for "<market>" is not signed; refusing in production`,
  and the student's age-check step fails**: that market's notice (`content/legal/privacy-notice/
  <market>.md`, or `global.md` for "somewhere else") still has `reviewedBy: pending`. This is not a
  bug — `apps/web/src/auth/age.ts` refuses to serve an unsigned notice in production on purpose.
  Fix: a named human reads the drafted body (board task 9.9e) and, if it's accurate for this demo,
  sets that file's `reviewedBy` to their own name or handle; the age-check step then works on the
  next sign-in. Do not set `AGE_NOTICE_ALLOW_UNSIGNED` to unblock this instead — that flag stays
  `false` on purpose (see `docker/compose.live.yaml`'s own comment).
```

Both insertions use "whichever market the signed-in student picks at the age gate" framing rather
than the board task's own `EDMATE_MARKET` shorthand, per the plan's note that `EDMATE_MARKET`
(`apps/web/src/turn/previewMarket.ts`) only selects the teacher studio's own test-chat preview
market, not a student's market at the age gate.

## How verified

```
export PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH"
corepack pnpm turbo run typecheck lint test --filter=@edmate/content... --filter=@edmate/web...
```
Result: **34 successful, 34 total** (31 cached, rest fresh). No failures.

Also ran the content package directly to confirm the three real-file test suites named in the
plan:
```
corepack pnpm --filter @edmate/content test -- --run
```
Result: **Test Files 27 passed (27)**, **Tests 567 passed (567)** — includes
`realPrivacyNotices.test.ts` (its `describe.each` over unsigned notices, which both `US.md` and
`global.md` still are), `privacyNotices.test.ts` (synthetic fixtures, unaffected), and
`validate.test.ts` (synthetic fixtures, unaffected). `privacyNotices.ts` itself still shows
100/100/100/100 line/branch/function/stmt-relevant coverage in the run.

Secret scan:
```
python3 .githooks/secret-scan.py --all
```
Result: clean, no output, exit 0.

"Once signed" half of the acceptance (inspection only, per the plan — not run): when a human later
changes `reviewedBy` from `pending` to a real name and removes `[PLACEHOLDER]` from either body,
nothing else in either file needs to change — `reviewedOn` is already a valid ISO date and
`market` already matches the file name, so `PrivacyNoticeFrontMatterSchema`/
`checkPrivacyNotices` keep passing, and the notice simply drops out of
`realPrivacyNotices.test.ts`'s `filter(n => !noticeSigned(n))` block, so none of that block's
assertions apply to it anymore.

## Decisions

### 6 Nov 2026 · 9.9e drafted interim US/global notice bodies verbatim from the plan, reviewedBy left pending · decided by builder · risk: high
Decided: Replaced the body text of `content/legal/privacy-notice/US.md` and `global.md` with the
demo-honest draft text the plan specified word for word; left `reviewedBy: pending` and
`[PLACEHOLDER]` in place so the notices stay correctly unsigned.
Why: The task is to unblock a future human sign-off, not to perform it — same pattern as 1.7h/B-67
(a named human signs later, out of band). Writing any name into `reviewedBy` would be the human's
own act, and this task only drafts content for that future sign-off.
Alternatives: Leave the old one-paragraph placeholder body as-is and only add the live-demo.md note
(rejected: the old body doesn't name who the demo is for or what data it stores, so the future
human sign-off would have nothing demo-specific to actually judge against).
Reversible: Yes, content-only; `content/legal/**` is a risk path per
`.claude/skills/merge-gate/risk-paths.txt` (reviewer group: `code-reviewer`, which runs on every
PR), hence `risk: high` here per that file's own comment.

### 6 Nov 2026 · 9.9e live-demo.md phrases the precondition around the student's age-gate market, not EDMATE_MARKET · decided by builder · risk: low
Decided: Both new `docs/live-demo.md` insertions describe the precondition as "whichever market a
demo student picks at the age gate", not "a signed notice for EDMATE_MARKET" (the board task's own
one-line shorthand).
Why: `EDMATE_MARKET` only selects the teacher studio's own test-chat preview market
(`apps/web/src/turn/previewMarket.ts`); it never picks a student's market at the age gate. Using
the shorthand in the doc would mislead whoever runs the live demo about which env var or UI step
actually controls the precondition.
Alternatives: Use the board task's shorthand verbatim (rejected: factually wrong about what
`EDMATE_MARKET` does).
Reversible: Yes, doc wording only.

## Open questions

None. Required reviewer for this PR per the plan: **code-reviewer** (the only reviewer required for
`content/legal/**` until the pilot gate, per `.claude/skills/merge-gate/risk-paths.txt`'s own
comment on that group).

Tool calls used: 17 (within the plan's 20-call budget; well under the 25-call PARTIAL threshold).
