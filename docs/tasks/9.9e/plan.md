# Plan: 9.9e — live-demo precondition doc + drafted interim US/global privacy notices

## Acceptance (verbatim, from `docs/board/tasks.yaml`)

> docs/live-demo.md names the signed-notice precondition and the fix if it is missing; US.md and
> global.md carry a drafted, demo-honest notice body with reviewedBy still pending (the human signs
> it, same pattern as 1.7h/B-67); existing locale/legal content tests and `edmate content
> validate`-equivalent checks still pass for IN.md (untouched) and for the two drafted files once
> signed; no change to apps/web/src/auth/age.ts or docker/compose.live.yaml.

How this is shown: the builder's handoff pastes (a) the new section/step added to
`docs/live-demo.md`, (b) the full new bodies of `US.md` and `global.md`, and (c) the test run
proving `realPrivacyNotices.test.ts`, `privacyNotices.test.ts` and `validate.test.ts` still pass
unchanged (these three are the tests that read these files or their shapes — see "Tests" below).

## Background the builder needs (do not re-derive it)

- `apps/web/src/auth/age.ts`'s `loadAgeContent(...).notice(market)` throws
  `privacy notice for "${market}" is not signed; refusing in production` when `production` is true
  and `noticeSigned(n)` is false. `noticeSigned` (packages/content/src/privacyNotices.ts) is
  `!isPending(reviewedBy) && !body.includes('[PLACEHOLDER]')` — **both** conditions matter, but this
  task only touches the body; `reviewedBy` stays `pending` on purpose, so the notice stays correctly
  unsigned and the throw keeps firing until a human signs it. That is intentional, not a bug to fix
  here.
- `docker/compose.live.yaml` sets `AGE_NOTICE_ALLOW_UNSIGNED: 'false'` for `web` — out of bounds,
  unchanged.
- The student picks a market at the age gate (`AgeContent.markets`, built from the locale packs
  plus `global` for "somewhere else"). Today only `US.yaml` is a real signed locale pack, so a demo
  student's realistic choices are "US" or "somewhere else" (global) — hence both `US.md` and
  `global.md` need a drafted body, not just US.md. `IN.md` stays untouched (B-27: India is parked).
- `EDMATE_MARKET` (docker/env.example) only selects the **teacher studio's own test-chat preview**
  market (`apps/web/src/turn/previewMarket.ts`); it does not pick a student's market at the age
  gate. Don't let `docs/live-demo.md`'s wording imply otherwise — phrase the precondition as "the
  market the signed-in student picks at the age gate", not "EDMATE_MARKET's notice", even though the
  board task's own one-line title uses that shorthand.
- B-27 (`.claude/blockers.md`) parked the real US/India notices to counsel at board task 3.10c
  (M13). This task does not reopen that: it only drafts a demo-scoped interim body so the human can
  sign it for the demo now, same as 1.7h's human-signed SSN pattern (`docs/tasks/1.7h/handoff.md`):
  draft under a clearly-marked "pending human sign-off" framing, builder never writes `reviewedBy`
  as anything but `pending`, and the human later says "sign as sid2305" out of band (B-67 is the
  precedent) — that sign-off is explicitly **not** part of this task.
- Console already told the human about the gap directly and is not touching
  `AGE_NOTICE_ALLOW_UNSIGNED`; nothing in this plan changes that flag or `age.ts`.

## Files to create/modify

1. `content/legal/privacy-notice/US.md` — body rewritten (front matter unchanged: `version:
   draft-0`, `market: US`, `reviewedBy: pending`, `reviewedOn: "2026-10-20"` all stay exactly as
   they are).
2. `content/legal/privacy-notice/global.md` — same treatment (front matter unchanged: `version:
   draft-0`, `market: global`, `reviewedBy: pending`, `reviewedOn: "2026-10-20"`).
3. `docs/live-demo.md` — two additions, no removals:
   - In "1. What you need", a new bullet naming the precondition.
   - In "7. Troubleshooting", a new entry for the exact log line and the fix.

## Files out of bounds (do not touch)

- `apps/web/src/auth/age.ts` (the refuse-unsigned check and `noticeSigned`/`loadAgeContent` logic).
- `docker/compose.live.yaml` (`AGE_NOTICE_ALLOW_UNSIGNED` literal).
- `content/legal/privacy-notice/IN.md` (India stays parked, B-27).
- `content/legal/privacy-notice/README.md` or any schema file (`packages/content/src/privacyNotices.ts`) —
  no schema change needed; this is a body-text-only change.
- `packages/content/src/privacyNotices.test.ts`, `realPrivacyNotices.test.ts`, `validate.test.ts` —
  the plan requires these to pass unchanged, not to be edited. If the builder finds one would need
  editing to pass, that is a stop-and-report (see "Risky paths" / open questions), not something to
  patch around.

## Exact body text to write (so the builder makes no new content decisions)

Both new bodies **must** keep two things verbatim, because
`packages/content/src/realPrivacyNotices.test.ts`'s `describe.each([...notices.values()].filter(n
=> !noticeSigned(n)))` block runs against the real committed files and asserts, for every notice
that is still unsigned (both of these stay unsigned — `reviewedBy` stays `pending`):
- `n.body` contains the literal string `[PLACEHOLDER]` (`PLACEHOLDER_MARKER`)
- `n.body` matches `/not legal text/i`

Below is the body text for `US.md` (everything after the closing `---` of the front matter, which
is untouched). `global.md` is the same shape with "United States" → "every market without its own
pack", "US" → "global", and the age-screen bullet's locale-pack reference generalised — exact text
for both given below so the builder copies it verbatim rather than drafting prose.

**`content/legal/privacy-notice/US.md` body:**

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

**`content/legal/privacy-notice/global.md` body:**

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

Builder note: paste each body exactly as the fenced block above (the fence markers themselves are
not part of the file content, just this plan's formatting); do not add, remove or reword sentences,
since "not legal text" and `[PLACEHOLDER]` must survive character-for-character for the test below.

## `docs/live-demo.md` additions (exact insertions)

**In section "1. What you need"**, add one bullet after the existing two:

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

**In section "7. Troubleshooting"**, add one entry under "New on the live stack":

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

## Tests (run, not written — this task adds no new test code)

This task changes only prose (notice bodies, a doc). No new test file; no existing test is edited.
The acceptance is proven by running the existing suites that read these two files and confirming
they still pass, because the front matter (`version`, `market`, `reviewedBy`, `reviewedOn`) is
untouched and the body keeps the two substrings those tests require:

- `packages/content/src/realPrivacyNotices.test.ts` — reads the real committed directory; its
  `describe.each` over unsigned notices asserts `version === 'draft-0'`, `reviewedBy === 'pending'`,
  body contains `[PLACEHOLDER]`, body matches `/not legal text/i`, and that `validateContentDir`
  still reports the `reviewedBy is "pending"` issue for each. Also asserts `noticeCoverageIssues`
  and that every file loads (front matter parses) — unaffected by a body-only edit as long as the
  front matter stays byte-identical.
- `packages/content/src/privacyNotices.test.ts` — unit tests against synthetic fixtures (`FRONT`,
  `notice()`), not the real files; unaffected either way, run only to confirm nothing elsewhere in
  the package broke.
- `packages/content/src/validate.test.ts` — synthetic `XX.md`/`global.md` fixtures in a temp dir,
  not the real files; unaffected, run for the same reason.
- `apps/web/src/auth/age.test.ts` — reads a fixture `global.md` it writes itself in a temp dir
  (`'---\nversion: draft-0\nmarket: global\nreviewedBy: pending\n...\n---\n[PLACEHOLDER]\n'`), not
  the real file; unaffected. Confirms `age.ts`'s own behaviour is untouched (it should be, since
  this plan doesn't touch `age.ts`).

Command to run (handoff pastes the real output):

```bash
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/content... --filter=@edmate/web...
python3 .githooks/secret-scan.py --all
```

If `realPrivacyNotices.test.ts` fails after the body edit, the most likely cause is a typo that
dropped `[PLACEHOLDER]` or broke the `/not legal text/i` match, or an accidental front-matter edit
(e.g. `reviewedOn` reformatted by an editor) — fix the body text, do not loosen the test.

## "Once signed" half of the acceptance (not built or tested here)

The acceptance line says checks must "still pass ... for the two drafted files once signed" — that
is a future-state requirement on the *shape* of the draft, not something this task runs today
(signing is the human's own later act, out of scope here, per the task brief). The builder confirms
by inspection, not by actually signing: when a human later changes `reviewedBy` from `pending` to a
real name and removes `[PLACEHOLDER]` from the body (the two things `noticeSigned` checks), nothing
else in either file needs to change for `PrivacyNoticeFrontMatterSchema` or `checkPrivacyNotices` to
pass — `reviewedOn` is already a valid ISO date, `market` already matches the file name, and the
body will no longer be picked up by the `describe.each(... filter(n => !noticeSigned(n)))` block
(it moves out of that filter entirely once signed, so none of its assertions apply to a signed
version). State this inspection explicitly in the handoff; do not add a test that simulates signing
(none of the three real-file test suites need one, and inventing one would be new test surface
outside this plan's scope).

## Risky paths touched

`content/legal/**` matches `.claude/skills/merge-gate/risk-paths.txt`'s
`content/legal/**` line, whose group's `# reviewers:` line is `code-reviewer` (the comment there:
"until the pilot gate this group needs only code-reviewer, which runs on every PR anyway; the PR
still logs risk: high"). Required reviewer for this PR: **code-reviewer**. `docs/live-demo.md` is
not itself a risky path.

The board's `risk: risky` label plus this touching a risk path means the handoff needs a `##
Decisions` entry with `risk: high` at merge (for the lead to write/confirm at merge time — not
something the plan resolves).

## Open questions

None blocking. One note for the lead, not a question for the builder: the board task's own
one-line description says "a signed privacy notice for EDMATE_MARKET" as shorthand; this plan
intentionally does not phrase `docs/live-demo.md` that way, since `EDMATE_MARKET` only selects the
teacher studio's preview market (`apps/web/src/turn/previewMarket.ts`), not a student's market at
the age gate — the real precondition is about whichever market the signed-in student picks (US or
"somewhere else"/global). If the lead disagrees with that framing, it's a one-line doc wording
change, not a re-plan.

## Budget

Budget: 20 tool calls (1 phase, packages/content + docs/live-demo.md)

## Allowed tools

Read, Grep, Glob, Edit, Bash (tests and secret scan only)

## Exit conditions

Status: DONE when both notice bodies are updated with the exact text above (front matter
byte-identical to today), `docs/live-demo.md` has both insertions, and the test command above
(plus the secret scan) is green with real pasted output in the handoff. Status: PARTIAL if more
than about 25 tool calls are used, or if any of the three real-file test suites
(`realPrivacyNotices.test.ts`, `privacyNotices.test.ts`, `validate.test.ts`) fails and the cause
isn't a simple typo in the new body text — stop and report rather than editing those test files or
`age.ts`/`compose.live.yaml`.
