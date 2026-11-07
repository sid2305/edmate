---
version: draft-0
market: global
reviewedBy: pending
reviewedOn: "2026-10-20"
---
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
