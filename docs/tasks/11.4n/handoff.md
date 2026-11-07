# Handoff: 11.4n · Prebuilt LGPL-only ffmpeg (replacing the from-source compile)

Status: PARTIAL (stopped at plan Step 2, before any file edit: needs a human decision)

- Branch: `m13/11.4n-ffmpeg-prebuilt`
- Worktree: `/tmp/edmate-11.4n`
- Tool calls used: 30

## Why it stopped

The pin was taken and verified, but reading the asset without running it shows that BtbN's
`linux64-lgpl` variant does not meet ADR-0016 Decision 8 as written. That decision requires
"LGPL 2.1+ only (no `--enable-gpl`, `--enable-version3`, `--enable-nonfree` or external library)".
The plan's exit conditions say to stop when "the extracted archive's licence file isn't named what
the plan assumed". It isn't, and the configuration under it differs too. Filling in the Dockerfile
now would mean one of two things:

- keeping the existing fail-closed check, so `docker build` fails on this binary every time; or
- loosening the check (allowing `version3` and `lib`), which changes ADR-0016's licence guarantee.
  That is a decision for a human, not for the builder (rule 7).

So nothing in the Dockerfile, the test or the ADR was edited. No red test was committed.

## Evidence (all static: no docker, the binary was never run)

**Pin candidate (verified):**
- Newest dated tag (from `curl https://api.github.com/repos/BtbN/FFmpeg-Builds/releases?per_page=8`):
  `autobuild-2026-11-06-12-50`, published 2026-11-06T12:51:07Z. The moving `latest` tag was
  skipped.
- Asset: `ffmpeg-n9.0.2-47-gb204e94e90-linux64-lgpl-9.0.tar.xz`, the static (non-`-shared`)
  build from the 9.0 release branch, picked over the `N-…` master build. It is 136,168,764 bytes.
- URL: `https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-06-12-50/ffmpeg-n9.0.2-47-gb204e94e90-linux64-lgpl-9.0.tar.xz`
- `sha256sum` → `5b21242bfc02f60fd901de18e862ae2a1a47c2b8a816dfb1b859356cb15dab57`. Computed in a
  fresh directory after a `curl --proto '=https' --tlsv1.2` download. It matches the GitHub API's
  own `digest` field for that asset. `xz -t` passed, and the archive is xz-compressed (`tar -xJf`).

**What the archive holds (`tar -tJf`, then extracted, with only text read):**
- Layout: `<dir>/bin/{ffmpeg,ffprobe,ffplay}`, `<dir>/LICENSE.txt`, `man/`, `doc/`, `presets/`.
- **Licence file: `LICENSE.txt` is the GNU LESSER GENERAL PUBLIC LICENSE, Version 3** (128
  lines). There is no `COPYING.LGPLv2.1` or `LICENSE.md`.
- `file bin/ffmpeg` → `ELF 64-bit LSB pie executable, x86-64, dynamically linked, interpreter
  /lib64/ld-linux-x86-64.so.2, for GNU/Linux 4.18.20, stripped`. The binary is about 140 MB, and
  the image would ship only this one file.
- Embedded configure string, read with `grep -a` on the file without running it (trimmed):
  `--enable-version3 --disable-debug --enable-iconv --enable-zlib --enable-libxml2
  --enable-libsoxr --enable-openssl --enable-libvmaf … --enable-libdav1d --enable-libvorbis …
  --enable-libmp3lame --enable-libopus … --enable-librist --enable-libssh … --enable-libzmq …
  --enable-libsrt … --enable-vulkan --enable-opencl --enable-vaapi … --disable-libx264
  --disable-libx265 --disable-libxvid … --extra-version=20261106`. It has no `--enable-gpl` and no
  `--enable-nonfree`. It does have `--enable-version3` and about 60 `--enable-lib*`. It has no
  `--disable-network`, and it has openssl, libssh, libsrt, librist and libzmq.
- Shared-library names in the binary's strings: `libc.so.6 libm.so.6 libmvec.so.1 libdl.so.2
  libpthread.so.0 librt.so.1 libgcc_s.so.1`, plus GPU/X runtimes it most likely `dlopen`s
  (`libcuda`, `libva*`, `libvulkan`, `libxcb*`, `libmfx*`, `libvpl`, `libamfrt64`, `libbluray`,
  `libvapoursynth-script`). A text match can't separate hard `NEEDED` libraries from `dlopen`
  ones.

**What this means for the plan's design:**
1. **Licence.** The binary is LGPL **v3**, not "LGPL 2.1+". The Dockerfile's existing check
   `if grep -Eq -e '--enable-(gpl|nonfree|version3|lib)' … exit 1` would fail the image build, and
   the plan says to keep it unchanged. The `-L` banner most likely reads "GNU Lesser General
   Public License … version 3". That passes the `GNU Lesser General Public License` grep, but it
   is a different licence from the one ADR-0016 names.
2. **Licence filename.** The runtime `COPY` needs `LICENSE.txt`, and the test's `COPYING\.LGPLv2\.1`
   expectation changes with it. Easy to do, but it should be decided together with item 1.
3. **Attack surface.** ADR-0016 used a pruned, network-disabled, audio-only build. This one is a
   full build with TLS/SSH/SRT/RIST/ZMQ network stacks and every codec. The chunker's
   `-protocol_whitelist file` and forced demuxer still limit what ffmpeg opens, so
   security-reviewer should weigh this as a much bigger parser surface, not as a new hole.
4. **gcompat.** The binary is glibc-linked and its strings name `libmvec.so.1`, which is
   glibc-specific. Whether Alpine's `gcompat` provides it (and `libgcc_s` via `libgcc`) can only be
   shown by running the binary, which is the lead's step. This is a real risk that the plan's
   gcompat fix is not enough.
5. **Other variants.** Every other dated tag's `linux64-lgpl` asset (master, 8.1, 9.0) comes from
   BtbN's same `lgpl` variant definition. I inferred that it has the same `--enable-version3`
   and external-library set. I did not download and check those assets.

## Options for the human/lead (not chosen by the builder)

- **A.** Accept LGPL v3 plus external LGPL-compatible libraries. This would mean amending ADR-0016
  Decision 8's licence wording and relaxing the Dockerfile check (allow `version3` and `lib`, keep
  rejecting `gpl` and `nonfree`), and copying `LICENSE.txt`. Needs architect, security-reviewer and
  typescript-reviewer, plus the lead's `risk: high`. The gcompat/libmvec question is still open
  until the lead runs the binary.
- **B.** Keep 11.4l's from-source LGPL 2.1+ build, but make it fast without a prebuilt binary. For
  example, publish the compiled `ffmpeg` stage once as a pinned, digest-referenced image (built by
  CI or the lead) and `COPY --from=<image>@sha256:…`, or rely on BuildKit layer caching so only the
  first build on a VM pays the ~15 minutes. Keeps every ADR-0016 guarantee.
- **C.** Close 11.4n as "investigated, not taken" (the plan's own fallback) and accept the
  rebuild cost.

## Changes

None to source, the Dockerfile, the test or the ADR. The only file added is this handoff.

## Acceptance evidence

- Baseline (plan Step 1, unmodified tree):
  `corepack pnpm vitest run src/ingest/ffmpegBuild.test.ts` → `Test Files 1 passed (1) · Tests 7 passed (7)`.
  The first attempt failed with `Failed to resolve entry for package "@edmate/gateway"` until
  `turbo run build --filter=@edmate/worker^...` built the workspace deps. That was environment
  setup, not a test result.
- Red step: not done. The test rewrite depends on the decision above, both for the licence
  filename and for whether the `version3`/`lib` assertion stays.
- `ffmpegChunker.test.ts`: unchanged. Its `FFMPEG_PRESENT` block was skipped on this host, since
  the host has no ffmpeg.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...` → `Tasks: 38 successful, 38 total`
- `python3 .githooks/secret-scan.py --all` → exit 0 (clean).

## Deviations

- Node/pnpm ran via an explicit `PATH=<nvm node v22.23.4 bin>:…` instead of
  `source ~/.nvm/nvm.sh`. The agent sandbox refused `source` for a worktree outside its own
  directory.
- `grep -a` and `file` were used on the extracted binary to read its embedded configure string and
  ELF header. Both read the file without running it. The plan's tool list names only
  `tar`/`xz`/`sha256sum` for inspection. I judged these to fall within "statically inspect" and
  "never execute"; the lead should confirm.
- The download directory was removed at the end, as the plan says.

## Lead verification

<!-- left empty for the lead: tag, `configuration:`/`-L` output, apk-ffmpeg-absent check, old and new cold-build wall times -->

## Decisions

- **11.4n prebuilt LGPL-only ffmpeg replaces the from-source compile (lead, risk: high): NOT
  TAKEN YET.** The planned entry depends on BtbN's `linux64-lgpl` asset being LGPL 2.1+ with no
  external library. It is LGPL v3 (`--enable-version3`) with about 60 external libraries, so
  ADR-0016 Decision 8's licence wording would have to change first. If option A is chosen, the
  entry reads: the worker image downloads BtbN/FFmpeg-Builds
  `autobuild-2026-11-06-12-50`/`ffmpeg-n9.0.2-47-gb204e94e90-linux64-lgpl-9.0.tar.xz` (sha256
  `5b21242bfc02f60fd901de18e862ae2a1a47c2b8a816dfb1b859356cb15dab57`) instead of compiling FFmpeg,
  under a licence relaxed from LGPL 2.1+ to LGPL v3. Reviewed by architect, security-reviewer and
  typescript-reviewer (opus), plus code-reviewer. The lead re-checks the banner, the apk check, the
  smoke test and both timings before merge.
- D1 (risk: medium): a prebuilt binary rather than a source compile (reversing 11.4l's D1). Still
  proposed. It also now carries the licence-version change above, which the plan did not foresee.
- D2 (risk: low): BtbN `linux64-lgpl`, pinned to dated tag `autobuild-2026-11-06-12-50`, never
  `latest`. Proposed. The pin is verified (see Evidence).
- D3 (risk: low): `gcompat` in both the `ffmpeg` and `runtime` stages, for a glibc binary on musl.
  Proposed. It may not be enough, because the binary names `libmvec.so.1` (glibc-only) and
  `libgcc_s.so.1`. Only running it in the lead's step can prove it works.
- D4 (risk: medium): no GPG-equivalent signature. Trust would come from TLS to an immutable dated
  release plus a locally computed sha256, which matched GitHub's own API digest. Proposed; this is
  the open question for security-reviewer.
- D5 (risk: low): record the change as a second dated amendment to ADR-0016, not a new ADR.
  Proposed. Not written yet, because what the amendment says depends on the option chosen.
- D6 (builder, risk: low): stopped at PARTIAL instead of loosening the Dockerfile's `version3|lib`
  check or renaming the licence file. Both would quietly change ADR-0016's licence guarantee
  (rule 7: ask, don't guess).

## Left to do

1. A human/lead picks option A, B or C above.
2. If A: amend the plan, then do the red test rewrite, fill in the Dockerfile with the pin above
   (`tar -xJf`, `LICENSE.txt`, the relaxed check, `gcompat`, probably `libgcc`), write the ADR-0016
   amendment, run the gate, and have the lead run the binary in docker to settle gcompat/libmvec.
3. If B or C: re-plan or close 11.4n.
