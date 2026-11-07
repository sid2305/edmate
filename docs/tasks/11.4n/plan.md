# Plan: 11.4n · Swap the worker's from-source ffmpeg compile for a pinned, checksum-verified prebuilt LGPL-only static build

## Task (board 11.4n)
Console finding (6 Nov 2026, live-deploy run on `edmate-app`): 11.4l's from-source LGPL-only ffmpeg
compile (`apps/worker/Dockerfile`'s `ffmpeg` stage) takes ~15 minutes on the live VM's 2 vCPUs
during every fresh `docker compose up --build`, slowing every deploy/rebuild. Swap the Dockerfile
to a pinned, checksum-verified **prebuilt** LGPL-only ffmpeg static build instead of compiling from
source, keeping the same no-GPL-codec guarantee ADR-0016 requires. Tech-stack change (rule 2):
architect, security-reviewer and an opus typescript-reviewer; the lead approves with a `risk: high`
decision referencing ADR-0016.

## Acceptance (verbatim from the board)
> apps/worker/Dockerfile installs a pinned, checksum-verified prebuilt ffmpeg build with no
> --enable-gpl codec (same ffmpegBuild.test.ts assertions as 11.4l/11.4m, updated for the new
> install step); a fresh `docker compose up --build` of the worker image is measurably faster than
> the from-source compile; @edmate/worker typecheck, lint and test stay green; the lead rebuilds
> the image once and re-checks the licence banner before merge.

How each part is shown:
| Acceptance part | Shown by | Who |
|---|---|---|
| Pinned, checksum-verified prebuilt build, no `--enable-gpl` | The new `ffmpeg` stage (pinned release tag + asset name + literal sha256 + `sha256sum -c`, no compiler toolchain), and `ffmpegBuild.test.ts` updated to match (below) | builder |
| Same `ffmpegBuild.test.ts` guarantees, updated for the new install step | The six existing guarantees are kept (no distro ffmpeg; pinned+checksummed fetch; LGPL-only/no GPL; every component the chunker needs is present; image fails closed on GPL or incomplete; runtime copies binary+licence before `USER node`); the *mechanism*-specific assertions (version/sha256 pin shape, `configureTokens()`) are rewritten because there is no `./configure` step any more | builder |
| Fresh build measurably faster | Lead times `docker compose -f docker/compose.yaml build worker` (cold, `--no-cache` on the `ffmpeg` stage only is not practical to isolate across the swap, so the lead times the whole worker image build) before and after, on the branch vs. `main`, and pastes both wall times into `## Lead verification` | lead |
| `@edmate/worker` typecheck, lint, test green | `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...`; `ffmpegChunker.test.ts` is unchanged and must still pass | builder |
| Lead rebuilds and re-checks the licence banner | Same three `docker run` checks 11.4l used, plus the timing above, under `## Lead verification` | lead |

**The builder never runs `docker`, `docker compose`, or the downloaded ffmpeg binary itself.** This
tightens 11.4l's rule: there the builder could not run `configure`/`make` from *source* on the host;
here the download is a **prebuilt executable**, so running it on the host at all (not just
compiling it) is running arbitrary untrusted machine code outside a container. All functional and
licence-banner verification of the running binary happens only in the lead's docker-based review
step, exactly like 11.4l's split, extended to cover "never execute the binary," not only "never
compile from source."

## Authority: amend ADR-0016 again, not a new ADR
Checked `docs/adr/0000-template.md` (the repo's ADR template/process) and the full text of
`docs/adr/0016-ffmpeg-chunker.md`. This repo's convention, already used once on this exact ADR: a
narrower change to *how* a prior decision is carried out is recorded as a **dated amendment
paragraph under the decision it changes**, with one added line in `## Status` naming the date and
task (`Amended 5 Nov 2026 (task 11.4l): Decision 8's fallback taken.`). `Status: Superseded by
ADR-NNNN` is reserved (per the template) for when a *whole* ADR's decision is replaced by a new one
— not the case here. ADR-0016 Decision 8 already states the no-GPL-codec guarantee and names "a
pinned, checksum-verified LGPL-only static build" as the documented fallback; 11.4l took that
fallback by compiling from source (its own D1 reasoned through, and rejected, a prebuilt binary,
for reasons this task must now directly answer — see Research below). 11.4n changes only the
*mechanism* by which that same guarantee is met (download-and-verify instead of
compile-and-verify), not the guarantee itself.

**Decision: this task amends `docs/adr/0016-ffmpeg-chunker.md` again** — a second dated paragraph
under Decision 8, headed "Amendment (6 Nov 2026, task 11.4n)," plus one more `## Status` line. It
does **not** create a new ADR file. This keeps the ffmpeg build-mechanism history in one document,
matching 11.4l's own D5 reasoning ("amending it keeps the decision history in one place rather than
splitting it across documents"), and matches the only precedent this repo has for this exact
situation (the same ADR, the same decision, one build cycle earlier). The reviewer set is unchanged
either way (`docs/adr/**` already requires architect, security-reviewer, typescript-reviewer), so
this choice has no effect on who reviews the PR — only on where the record lives.

## Research: a reputable LGPL-only static-build provider
11.4l's D1 rejected a prebuilt binary for three reasons. This task must answer each one, because
the console finding now makes build speed the overriding constraint:

1. **johnvansickle.com** static builds and **mwader/static-ffmpeg** images: both build with
   `--enable-gpl` (libx264/libx265 etc.), so the binary is GPL as a whole. Still rejected, unchanged
   from 11.4l — these fail the licence requirement outright, not just the provenance one.
2. **BtbN/FFmpeg-Builds** (`github.com/BtbN/FFmpeg-Builds`): publishes, per release, separate
   `linux64-gpl` and **`linux64-lgpl`** asset variants (clearly labelled), built with `--disable-gpl`
   and no external GPL-only codec library for the `-lgpl` variant. This is the candidate this plan
   names. Two of 11.4l's three objections are addressed as follows, and the third is named as an
   open point for review rather than quietly assumed away:
   - **"Rolling 'latest' assets."** BtbN's GitHub Releases page has both a moving `latest` release
     and individually dated, immutable release tags (e.g. an `autobuild-<UTC timestamp>` tag) that
     never change once published. **This task pins one specific dated tag's `linux64-lgpl` asset by
     its exact download URL (tag + filename), never the `.../releases/latest/...` URL.** The builder
     takes the newest dated tag available when the pin is taken (mirroring 11.4l's D2 "newest point
     release when pinned"), records the tag name as a Dockerfile literal, and re-verifies at every
     build only against the sha256 pinned at that time — the same "pin once, re-check every build"
     shape 11.4l already used for the FFmpeg source tarball.
   - **"glibc-linked, Alpine is musl."** Confirmed still true: BtbN's Linux builds link against
     glibc, not musl. **Fix: add `gcompat` (Alpine's glibc-compatibility shim, a few hundred KB, not
     an ffmpeg package) to both the `ffmpeg` stage** (so the build-time licence/component check can
     execute the extracted binary at all) **and the `runtime` stage** (so the worker can run it).
     `gcompat` never appears in an `apk add` line that also names `ffmpeg`, so the existing
     `ffmpegBuild.test.ts` check "the runtime stage installs no distro ffmpeg" (which greps `apk add`
     lines for the whole word `ffmpeg`) stays true and meaningful without modification.
   - **"Its configuration we can only read after running the binary, which the builder can't do."**
     Still true, and now sharper: the builder may not run the extracted binary **at all** (see
     "builder never runs... the downloaded ffmpeg binary" above), so the `configuration:`/`-L`
     check that proves "no `--enable-gpl`, is LGPL 2.1+, has every needed component" **moves
     entirely into the Dockerfile's own `RUN` check** (unchanged from 11.4l in *what* it asserts,
     changed only in that it runs against an extracted/verified binary instead of a freshly `make`d
     one) and is only ever actually executed inside the `ffmpeg` build stage (by `docker build`
     itself, never by the builder's shell) or, redundantly, by the lead's review-step `docker run`.
     The vitest-level test can only check that the Dockerfile's `RUN` check block contains the right
     assertions (text-level, as it already does for test "the image build fails closed on a GPL or
     incomplete ffmpeg") — it cannot independently re-derive "is this binary actually LGPL-only" the
     way the old `configureTokens()` helper could from a `./configure` invocation. **This is the
     real cost of switching to a prebuilt binary: the LGPL-only guarantee becomes entirely a
     build-time (and lead-review-time) check on the artifact BtbN shipped, not a build-time check on
     configure flags this repo chose.** Flagged below as an explicit question for
     architect/security-reviewer, not quietly accepted.
3. Checksum/trust anchor, concretely: no GPG-signed release is published for BtbN's builds (unlike
   FFmpeg.org's source tarballs, which 11.4l GPG-verified against the FFmpeg release signing key).
   **This is a real, lesser trust anchor than 11.4l's**, and the plan does not paper over it: the
   builder downloads the pinned tag's asset over https from `github.com` (TLS to a specific,
   immutable release + asset, under BtbN's GitHub account), computes its own sha256 in a fresh
   throwaway directory (never trusting any third-party-hosted hash file as the sole source), and
   hardcodes that sha256 as a Dockerfile literal — the same "compute it ourselves, pin the literal,
   re-check every build" mechanism 11.4l used, minus the GPG step. **Open question for the ADR
   amendment and for security-reviewer:** is "TLS to a named, immutable GitHub release tag, with a
   locally computed and pinned sha256, but no maintainer signature" an acceptable trust anchor for a
   binary that ships in the public worker image? The plan's position (for the lead to confirm) is
   yes, for MVP speed, on the strength of: the asset is pinned by content hash (any future tampering
   with that specific release asset would change the hash and fail the build, not silently serve
   different bytes), BtbN's LGPL variant is a known, widely used community build (referenced by, for
   example, yt-dlp's own install docs), and the binary is already sandboxed the same way 11.4l's
   compiled one was (non-root, `-protocol_whitelist file`, timeout, no linking into Edmate's own
   code — ADR-0016's "ffmpeg's own parser... attack surface" consequence, unchanged). If
   security-reviewer disagrees, the fallback is to revert this task and keep 11.4l's from-source
   build, accepting the 15-minute rebuild cost (not this plan's call to make unilaterally).

No other candidate was found that offers a clearly labelled LGPL-only Linux static variant with a
dated, non-rolling release. (Gyan's builds are Windows-only; there is no equivalent third option.)

## Design: the Dockerfile diff
- **`ffmpeg` stage** (replaces the whole from-source compile, keeps the stage name and position
  between `build` and `runtime`): `FROM node:22.22.3-alpine3.22 AS ffmpeg` (unchanged base, so no
  new base-image pin and the layer stays cached the same way). `RUN apk add --no-cache curl tar xz
  gcompat` (no `build-base` — there is nothing to compile any more). Fetch the pinned tag's
  `linux64-lgpl` asset by its exact URL (tag + filename as two literals, like `FFMPEG_VERSION`/
  `FFMPEG_SHA256` were), `sha256sum -c` against a literal sha256 before extracting (`tar -xJf` or
  `-xf` depending on the asset's actual compression — confirm, don't assume, when taking the pin).
  Then the **same shape of licence/component `RUN` check 11.4l wrote** (`-hide_banner -L` joined
  with `tr '\n' ' '`, grep for "GNU Lesser General Public License", `if grep -q 'GNU General Public
  License'... exit 1`, `if grep -Eq -e '--enable-(gpl|nonfree|version3|lib)'... exit 1`, and the
  `-decoders`/`-demuxers`/`-muxers`/`-encoders` presence greps for the same six decoders, two
  demuxers, two muxers, one encoder, one protocol and `aresample` filter — confirm the extracted
  binary actually lists a `-filters` entry for `aresample` the same way; BtbN's LGPL build may bundle
  a different filter set than the from-source one did, so this needs checking against the real
  binary, not assumed to carry over unchanged) runs against the **extracted** binary, under `set
  -eux`, so a GPL or incomplete binary still fails `docker build` before `runtime` ever copies it.
- **`runtime` stage:** unchanged except `RUN apk add --no-cache gcompat` added before the two
  `COPY --from=ffmpeg` lines (binary + `COPYING.LGPLv2.1`/`LICENSE.md`), which stay as 11.4l wrote
  them (path, ownership, order relative to `USER node`). If the BtbN asset's licence file has a
  different name than `COPYING.LGPLv2.1` (confirm when taking the pin), copy it under that name, not
  a renamed one, and update the test's expected filename to match.
- **`base` and `build` stages:** unchanged, as in 11.4l.
- Header comment (lines 1-4): the clause "a third stage builds an LGPL-only ffmpeg (ADR-0016)"
  11.4l added stays accurate as-is (it's still a third, discarded stage; only its *contents*
  change) — reword only if the builder finds it now reads oddly next to "builds."

## Test file: what changes in `ffmpegBuild.test.ts`
Read: `apps/worker/src/ingest/ffmpegBuild.test.ts` (233 lines, 6 `it` blocks) and
`apps/worker/src/ingest/ffmpegChunker.ts`/`.test.ts` (unchanged by this task — confirm, don't
assume, same as 11.4l's Design answer 4).

Keep (same guarantee, little or no change):
- "the runtime stage installs no distro ffmpeg" — unchanged; `gcompat` doesn't match `/\bffmpeg\b/`.
- "every multi-command RUN in the ffmpeg stage starts with set -eux" — unchanged in shape; still
  checks the `ffmpeg` stage's `RUN` blocks.
- "runtime copies the built binary onto PATH with its licence" — unchanged in shape; update the
  expected licence filename only if it differs from `COPYING.LGPLv2.1` (see above).

Rewrite (the mechanism changed):
- "ffmpeg is fetched at a pinned version over https and checked against a pinned sha256" →
  re-target at the new literals (release tag, asset filename, sha256) and the new URL shape
  (`https://github.com/BtbN/FFmpeg-Builds/releases/download/<tag>/<asset>`, never
  `.../releases/latest/...`), keeping the same ordering assertions (checksum between fetch and
  extract) and the same "not a placeholder" sha256 check.
- "configure is LGPL-only with no external library" → **delete**, together with the
  `configureTokens()`/`enabled()`/`DEMUXER_FOR_FORMAT`/`chunkerArgv`/`valueAfter` helpers that exist
  only to parse a `./configure` invocation that no longer exists.
- "the build enables every component the chunker's argv needs" → **replace** with an assertion that
  the Dockerfile's licence/component `RUN` check block (the one moved into the design above)
  textually greps for every literal the chunker's real argv uses. Keep capturing the chunker's real
  argv with the existing fake-`ProcessRunner` technique (so this test still fails if the chunker ever
  starts asking for a component the Dockerfile doesn't check for — the property that made 11.4l's
  version valuable) but check **string containment of each needed literal inside the `RUN` check
  text**, not membership in a parsed configure-token set: for each of `audio/mp4`, `video/mp4`,
  `video/webm`, extract the `-f` value before `-i` from the captured argv, map it through
  `DEMUXER_FOR_FORMAT` as before, and assert the check block's `-demuxers` grep line names that
  demuxer's exact joined-name string (e.g. `'mov,mp4,m4a,3gp,3g2,mj2'` for `mp4`) — same for the
  `-c:a` encoder, the `-f`-after-`-i` and `-segment_format` muxer names, and the
  `-protocol_whitelist` value; plus the three decoders and the `aresample` filter literals. This is
  the trickiest part of the rewrite; keep every helper under ~40 lines, same as 11.4l's budget.
- "the image build fails closed on a GPL or incomplete ffmpeg" → same assertions as 11.4l (the
  joined `-L` grep, the `if ... exit 1` shapes, the `! grep` anti-pattern check), just confirm they
  still read from the right stage text now that the stage's RUN blocks are different in number/order.

Run the suite red first against the unmodified Dockerfile (same `vitest run
src/ingest/ffmpegBuild.test.ts` command 11.4l used) before editing the Dockerfile, and paste the red
summary into the handoff, exactly like 11.4l did.

## Files
Create: none (the test file is modified, not created).

Modify:
- `apps/worker/Dockerfile`: the `ffmpeg` stage replaced (download-and-verify instead of
  compile-and-verify), `gcompat` added to both the `ffmpeg` and `runtime` stages.
- `apps/worker/src/ingest/ffmpegBuild.test.ts`: as above.
- `docs/adr/0016-ffmpeg-chunker.md`: one more `## Status` line and one dated amendment paragraph
  under Decision 8 (6 Nov 2026, task 11.4n). No existing sentence rewritten, including 11.4l's own
  5 Nov 2026 amendment paragraph, which stays as history even though this task supersedes its
  mechanism.
- `docs/tasks/11.4n/handoff.md` (new, the builder's handoff).

Out of bounds (stop at `PARTIAL` if any needs a change):
- `apps/worker/src/ingest/ffmpegChunker.ts` and `ffmpegChunker.test.ts` (unchanged; the chunker's
  argv doesn't change, only how the binary it calls was obtained).
- `packages/**`, `apps/web/**`, `docker/**`, `.github/**`, `.claude/**`, `.githooks/**`,
  `.dockerignore`, `pnpm-lock.yaml`, every `package.json`.
- Any other ADR, and `docs/board/tasks.yaml` (the lead owns it).

## Steps (tests first)
1. **Red:** run the existing `ffmpegBuild.test.ts` unmodified against the unmodified Dockerfile to
   confirm current green (sanity baseline), then begin editing the test file per "Test file" above;
   run it red against the *still-unmodified* Dockerfile and paste the red summary.
2. **Pin the source (outside docker, no execution of anything downloaded).** In a fresh
   `mktemp -d`, fetch the BtbN release page/API to find the newest dated (non-`latest`) tag,
   download that tag's `linux64-lgpl` asset by its exact tag+filename URL over https, compute its
   own sha256 with `sha256sum`, and record: the tag name, the exact asset filename, the sha256, and
   confirm the licence-file name inside the archive (extract with `tar`, list contents, do **not**
   run anything inside it). If the release page is unreachable, or no dated `-lgpl` asset exists:
   **stop at `Status: PARTIAL`**, leaving the Dockerfile's literals unfilled — never guess a tag,
   filename or hash.
3. **Green:** edit the Dockerfile per Design above with the real tag/filename/sha256/licence-file
   name filled in. Re-run `ffmpegBuild.test.ts` until green, then the whole gate.
4. **ADR-0016 amendment**, as described in "Authority" above: a second dated paragraph under
   Decision 8 plus one more `## Status` line. State plainly: the from-source build (11.4l) took
   ~15 minutes per fresh `docker compose up --build` on the live VM's 2 vCPUs; this swaps to BtbN's
   pinned, checksum-verified `linux64-lgpl` release asset (naming the tag), with the same
   no-GPL-codec guarantee re-verified against the extracted binary instead of against configure
   flags; `gcompat` is added for glibc compatibility on the musl base; there is no GPG-equivalent
   signature on this artifact, unlike 11.4l's source tarball, which is accepted for MVP build-speed
   reasons (name the lead's explicit acceptance here once given, not assumed).
5. **Handoff** `docs/tasks/11.4n/handoff.md`: the red/green evidence; the tag, asset filename,
   sha256 and how it was computed; the before/after Dockerfile diff summary; an empty
   `## Lead verification` section (tag, actual `configuration:`/`-L` output, apk-ffmpeg-absent
   check, and both the old and new cold-build wall times) for the lead to fill in; `## Decisions`
   (the risk: high entry plus D1-D5 below); `## Gate`; `## Budget` / `Tool calls used: N`.

## Gate (builder)
```bash
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...
python3 .githooks/secret-scan.py --all
```
Also `corepack pnpm exec prettier --check apps/worker/src/ingest/ffmpegBuild.test.ts
docs/tasks/11.4n/handoff.md docs/adr/0016-ffmpeg-chunker.md`. `ffmpegChunker.test.ts` must stay
green with zero changes (its opt-in `FFMPEG_PRESENT` block runs or skips per host, either is fine,
as in 11.4l — note which in the handoff).

## Lead verification (review step only; never in the builder's gate)
On the VM, from the PR branch, mirroring 11.4l's three `docker run` checks plus a timing pass:
```bash
time docker build -f apps/worker/Dockerfile -t edmate-worker-check .      # new mechanism
docker run --rm --entrypoint ffmpeg edmate-worker-check -version | head -3
docker run --rm --entrypoint ffmpeg edmate-worker-check -hide_banner -L
docker run --rm --entrypoint sh edmate-worker-check -c 'apk info -e ffmpeg || echo "no apk ffmpeg"; ls /usr/local/share/licenses/ffmpeg'
```
Then checkout `main` (or the pre-11.4n commit) and time the same `docker build` once more (cold, or
at least with the `ffmpeg` stage's cache cleared) to get the "before" number for the acceptance's
"measurably faster" claim. Paste both wall times, the `configuration:`/`-L` output and the apk check
into the handoff's `## Lead verification`. Re-run 11.4l's functional smoke (synthetic MP4+AAC and
WebM+Opus, `--network none`) unchanged — the chunker's argv didn't change, so the pass bar (exit 0,
4-5 pieces, about a second or two) is the same.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `apps/worker/Dockerfile`: no match in risk-paths.txt. Rule 2 still applies (tech-stack change),
  reviewed by architect, security-reviewer and an opus typescript-reviewer, per the board task.
- `apps/worker/src/ingest/ffmpegBuild.test.ts`: no match (only worker glob listed is
  `apps/worker/src/alerts/**`).
- `docs/adr/0016-ffmpeg-chunker.md`: **matches `docs/adr/**`.** Group reviewers: architect,
  security-reviewer, typescript-reviewer — the same set rule 2 already requires here.
- `docs/tasks/11.4n/*`: no match.
- Safety prefixes (`packages/harness/src/guardrails/**`, `content/**`,
  `evals/suites/safety|locked/**`, `apps/worker/src/alerts/**`): none touched.

**Required in `review.md`: architect, security-reviewer, typescript-reviewer (opus), code-reviewer**
(code-reviewer always required; the other three per rule 2 and the board task's explicit brief). The
handoff's `## Decisions` must carry the `risk: high` entry below, referencing ADR-0016. The lead
approves at merge, after rebuilding the image and timing both builds (above).

## Decisions to log in the handoff
- **11.4n prebuilt LGPL-only ffmpeg replaces the from-source compile (lead, risk: high).**
  Decided: the worker image downloads a pinned, checksum-verified BtbN/FFmpeg-Builds `linux64-lgpl`
  release asset (naming the tag and sha256) instead of compiling FFmpeg from source, cutting a fresh
  `docker compose up --build`'s ffmpeg step from ~15 minutes to (the lead's measured time). Why:
  console found the from-source compile (11.4l) too slow on the live VM's 2 vCPUs for every
  deploy/rebuild; ADR-0016 Decision 8 already names "a pinned, checksum-verified LGPL-only static
  build" as an acceptable mechanism. Reviewed by architect, security-reviewer, typescript-reviewer
  (opus); code-reviewer also ran. The lead re-checked the licence banner, the absence of any apk
  ffmpeg, the functional smoke test and both build timings before merge.
- D1 (risk: medium): a prebuilt binary rather than a source compile, reversing 11.4l's D1. Why: the
  console finding makes build time the binding constraint; the two objections 11.4l raised against
  a prebuilt binary (rolling assets, glibc-on-musl) are addressed by pinning a dated tag and adding
  `gcompat`; the third (no GPG signature) is accepted, not solved — named explicitly for
  security-reviewer.
- D2 (risk: low): BtbN/FFmpeg-Builds's `linux64-lgpl` variant, pinned to a specific dated release
  tag (name it), never the `latest` tag/URL.
- D3 (risk: low): `gcompat` added to both the `ffmpeg` and `runtime` stages, since BtbN's Linux
  builds are glibc-linked and the base image is musl Alpine.
- D4 (risk: medium): no GPG-equivalent signature on this artifact; trust comes from TLS to a named
  immutable GitHub release tag plus a locally computed, pinned sha256, not from a maintainer
  signature. Accepted for MVP build-speed reasons, reversible by reverting to 11.4l's from-source
  build if security-reviewer or the lead judges this insufficient.
- D5 (risk: low): recorded as a second dated amendment to ADR-0016, not a new ADR file, matching
  11.4l's own D5 reasoning and this repo's "Superseded by ADR-NNNN" convention being reserved for
  whole-ADR replacement, not a mechanism swap within one still-valid decision.

## Open questions
One, potentially blocking at review (not at plan time): **is BtbN/FFmpeg-Builds's unsigned,
checksum-only trust anchor acceptable for a binary shipped in the public worker image**, given
11.4l had a GPG-signed source as its anchor? This plan's position is yes, for MVP speed, with the
mitigations in D1-D4 above (content-hash pinning, a dated non-rolling tag, the binary's existing
sandboxing from ADR-0016 unchanged). If architect or security-reviewer disagrees at review, the
task goes back to the builder as a fix round, or the lead reverts to keeping 11.4l's from-source
build and closes this task as a documented "investigated, not taken" decision instead — this is not
decided unilaterally by the plan or the builder.

## Budget
Budget: 65 tool calls (1 phase, @edmate/worker)

One phase. One Dockerfile edit, one test-file rewrite (no new file), one ADR paragraph and one
handoff, all in one package — same shape and size class as 11.4l (60 tool calls, used 55), with a
little headroom for the extra release-page/API research this task needs in place of 11.4l's GPG
step. The sizing rule's split thresholds (more than about 8 source files, 2+ packages, 2+ guards or
adapters) are not reached.

## Allowed tools
Read, Grep, Glob, Edit, Write, and Bash for only these:
- `curl` to `github.com`/`api.github.com`, for only the BtbN/FFmpeg-Builds releases listing/API and
  the one pinned tag's `linux64-lgpl` asset;
- `sha256sum` on the downloaded asset, and `tar`/`xz` to **extract and inspect it (list contents,
  read the licence file text) only — never execute the extracted `ffmpeg` binary**;
- the pnpm gate commands and the secret scan;
- `rm -rf` of the download directory at the end.

**No `docker`, `docker compose`, `make`, no host compile of ffmpeg, and no execution of the
downloaded `ffmpeg` binary on the host, in a container or otherwise, by the builder.** Running it is
the lead's review step only.

## Exit conditions
- **`Status: DONE`** when all of these hold:
  - `ffmpegBuild.test.ts` was red (against the real, unmodified Dockerfile) and then went green.
  - The Dockerfile pins a real, dated (non-`latest`) BtbN release tag, asset filename and sha256,
    and adds `gcompat` to both stages.
  - The ADR amendment is written as a second dated paragraph under Decision 8.
  - The `@edmate/worker` gate and the secret scan are green.
  - The handoff has the pin evidence, the Dockerfile diff summary and the decisions, with an empty
    `## Lead verification` section left for the lead.

  The lead's image rebuild, licence re-check and timing comparison are not part of `DONE` — they
  happen at review, same split as 11.4l.
- **`Status: PARTIAL`, then stop and report** if any of these happen:
  - No network, or no dated non-`latest` `linux64-lgpl` asset can be found; leave the Dockerfile's
    tag/filename/sha256 literals unfilled. Never commit a guessed or unverified pin.
  - The extracted archive's licence file isn't named what the plan assumed, or the binary's
    advertised component set (readable only from the Dockerfile's own build-time check, which the
    builder cannot run) can't be reasoned about statically enough to write a meaningful test —
    report exactly what's missing rather than guessing a test that can't fail.
  - Any out-of-bounds file (including `ffmpegChunker.ts` or its test) seems to need a change.
  - The gate is red for a reason in this task's files after two fix attempts.
  - The builder is past about 60 tool calls.
