# 11.4d review — APPROVE

Reviewers: security-reviewer, architect, typescript-reviewer, code-reviewer

## Findings
- [CRITICAL] [fixed] apps/worker/src/ingest/ffmpegChunker.ts — no `-protocol_whitelist` and no forced input format, so an upload shaped like an HLS or concat playlist could make ffmpeg fetch URLs (SSRF) or read local files; fix round 1 added `-protocol_whitelist file` and a forced demuxer from a fixed mime table before `-i`, with real-ffmpeg rejection tests (security-reviewer; architect HIGH on the same issue)
- [HIGH] [fixed] apps/worker/src/ingest/ffmpegChunker.ts — the runner sent only SIGTERM on timeout, so a child ignoring it could hang run(); fix round 1 escalates to SIGKILL after a grace timer, tested with a real SIGTERM-trapping child (typescript-reviewer)
- [MEDIUM] [fixed] docs/adr/0016-ffmpeg-chunker.md — Consequences did not name ffmpeg's own parser attack surface or its mitigations; fix round 1 added them (architect)
- [MEDIUM] [deferred 11.4j] apps/worker/src/ingest/ffmpegChunker.ts — output size is only checked after ffmpeg exits; disk can fill during the run (security-reviewer)
- [MEDIUM] [deferred 11.4j] apps/worker/src/ingest/ffmpegChunker.ts — wavDurationMs does not bounds-check the fmt and data chunks (typescript-reviewer)
- [MEDIUM] [deferred 11.4j] apps/worker/src/ingest/ffmpegChunker.ts — drained stdout/stderr have no error listener (typescript-reviewer)
- [LOW] [deferred 11.4j] apps/worker/src/ingest/ffmpegChunker.ts — the bare catch after run() drops the error name, so a missing binary looks like bad input (typescript-reviewer)
- [LOW] [deferred 11.4j] apps/worker/src/ingest/ffmpegChunker.test.ts — the oversized-output test checks the directory after cleanup instead of counting reads (code-reviewer)
- [LOW] [deferred 11.4j] apps/worker/src/ingest/ffmpegChunker.ts — the runner's abort listener is not removed when the child exits first (typescript-reviewer, re-review)
