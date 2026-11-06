# 11.4l review — APPROVE
Reviewers: architect, security-reviewer, typescript-reviewer (opus), code-reviewer

## Scope
`apps/worker/Dockerfile` (new `ffmpeg` build stage; runtime `COPY --from=ffmpeg` in place of `apk
add ffmpeg`), `apps/worker/src/ingest/ffmpegBuild.test.ts` (new, 6 tests), `docs/adr/0016-ffmpeg-chunker.md`
(dated amendment under Decision 8). Risk tier: contracts/ADR + tech-stack change
(`risk-paths.txt` and build-plan rule 2) — architect, security-reviewer, typescript-reviewer
required; code-reviewer always required.

## Lead verification (independent, not from the builder's report)
Rebuilt the image from the fix-round-1 commit (`bf139afc`): build succeeded, including the image's
own licence-check `RUN` step that previously failed closed on a correct LGPL build. Confirmed:
`ffmpeg -version`'s `configuration:` line matches the handoff's expected line exactly; `-L` names
the GNU LGPL v2.1+ with no GPL text; `apk info -e ffmpeg` finds no distro package; both licence
files are present. Ran the plan's functional smoke test (synthetic MP4+AAC and WebM+Opus, made in
a throwaway container, never committed) against the built image with `--network none`: both exits
0, 5 and 4 pieces respectively, under half a second each, video correctly dropped by `-vn`. Full
detail in `handoff.md`'s `## Lead verification`.

## Findings
- [LOW] [fixed] docs/adr/0016-ffmpeg-chunker.md:38 — Decision 9's image-size note didn't point to
  the Decision 8 amendment that supersedes it. Added a pointer (architect).
- [LOW] [fixed] docs/adr/0016-ffmpeg-chunker.md:51 — Consequences' image-size bullet, same gap.
  Added a pointer (architect).
- [LOW] [fixed] docs/adr/0016-ffmpeg-chunker.md:52 — Consequences said "no code depends on which
  ffmpeg build ships," now partly untrue since the pruned codec set changes which uploads succeed.
  Corrected (architect).
- [LOW] [fixed] docs/tasks/11.4l/handoff.md (Reversible line, main decision) — said reverting
  "restores the apk package," without naming that package as the GPL build the ADR rejects.
  Corrected to point at the ADR's actual named rollback (architect).
- [LOW] [fixed] docs/tasks/11.4l/handoff.md (D2 Why/Alternatives) — called 8.x "unreleased"; the
  plan says 8.x shipped with configure changes (e.g. removed libpostproc), just not checked against
  this flag set. Corrected (architect).
- [LOW] [fixed] docs/tasks/11.4l/handoff.md (D3 Why) — said the decoder set was "every codec the
  chunker's own argv uses," but the argv names no decoder (ffmpeg auto-selects by input). Corrected
  to describe the decoders by the MIME types/codecs they actually serve (architect).
- [MEDIUM] [deferred 11.4m] apps/worker/src/ingest/ffmpegBuild.test.ts — neither multi-command `RUN`
  block is checked for `set -eux`; a dropped `set -e` would silently pass the test while weakening
  the Dockerfile's own fail-closed behaviour (typescript-reviewer).
- [MEDIUM] [deferred 11.4m] apps/worker/src/ingest/ffmpegBuild.test.ts:104 — the sha256 pin check
  only checks command order, not that the grep actually interpolates `${FFMPEG_SHA256}`
  (typescript-reviewer).
- [LOW] [deferred 11.4m] apps/worker/src/ingest/ffmpegBuild.test.ts:84 — the `apk add` regex misses
  `apk --no-cache add ffmpeg` (typescript-reviewer).
- [LOW] [deferred 11.4m] apps/worker/src/ingest/ffmpegBuild.test.ts:42/116 — the configure-flag
  split doesn't strip quotes, so a quoted `"--enable-gpl"` would pass the test (the image's own
  build-time check would still fail closed) (typescript-reviewer).
- [LOW] [deferred 11.4m] apps/worker/src/ingest/ffmpegBuild.test.ts:147 — the LGPL-phrase assertion
  doesn't anchor to the actual failing `grep -q` line, and the GPL-banner `if grep` isn't pinned by
  its own regex (typescript-reviewer).
- [LOW] [deferred 11.4m] apps/worker/src/ingest/ffmpegBuild.test.ts:17-18 — `configureTokens()`'s
  end-of-text fallback would, in a hypothetical Dockerfile missing `make -j`, over-scan into the
  licence-check block's quoted grep pattern (code-reviewer).
- [LOW] [deferred 11.4m] apps/worker/src/ingest/ffmpegBuild.test.ts:~143 — the banner-join assertion
  is an intentionally brittle literal-string pin (so a regression can't silently return); accepted
  tradeoff, no action needed beyond noting it (code-reviewer).
- [LOW] [deferred 11.4m] apps/worker/Dockerfile — single-source download from ffmpeg.org with no
  mirror (availability risk only; sha256 pin already catches tampering) (security-reviewer).
- [LOW] [deferred 11.4m] apps/worker/src/ingest/ffmpegBuild.test.ts — no assertion that the `curl`
  line keeps `--proto '=https' --tlsv1.2`, so a future edit could silently weaken TLS enforcement
  with no test catching it (security-reviewer).

No CRITICAL or HIGH findings from any reviewer. Follow-up task `11.4m` (risk: low) carries every
deferred MEDIUM/LOW as test-hardening only, no Dockerfile behaviour change.
