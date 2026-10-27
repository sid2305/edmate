# Review: 11.4i — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet)

## Findings
- [LOW] [wontfix] apps/web/src/studio/routes.ts:234 — the `type.transcribe && !type.splittable ? MSG.mediaTooLarge : MSG.tooLarge` arm can no longer be reached, because every transcribed type is now splittable. The plan keeps it on purpose, so a future media type the worker cannot split still gets the right message (lead decision in the handoff).

## Notes
- code-reviewer cross-checked the worker: ffmpegChunker.ts handles exactly audio/mp4, video/mp4 and video/webm, and mp3 and wav already split through the default chunker. Every type marked splittable can be split.
- No references to the removed exports or the `media_too_large` key remain anywhere in apps/ or packages/.
- The 15-minute budget reasoning in the handoff checks out (24 MB per Whisper piece is about 13 minutes of 16 kHz mono audio). The ffmpeg licence check is human-only and tracked in blockers.md (B-62).
