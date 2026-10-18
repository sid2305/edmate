# 0.6 handoff: dev container

Status: DONE
Branch: `m0/0.6-devcontainer`
Worktree: `.claude/worktrees/agent-a371d4e88cc837d39`
Risky: none (no path in `.claude/skills/merge-gate/risk-paths.txt` touched).

## Acceptance evidence

Verified for real with the devcontainers CLI 0.89.0 on this Mac (Docker Desktop, daemon 29.5.3, arm64). The
workspace was a fresh `git clone` of this branch in the session scratchpad, because a git worktree's `.git` file
points at the main repo's `.git/worktrees/...`, which is not mounted into the container. Container, images and
clone were removed afterwards (image was 1.16 GB).

`npx --yes @devcontainers/cli@0.89.0 build --workspace-folder <clone> --image-name edmate-devcontainer:0.6`
```
#15 ... Unpacking moby-cli (29.5.3-ubuntu24.04u5) ...
#15 ... Preparing to unpack .../moby-buildx_0.38.0-ubuntu24.04u2_arm64.deb ...
{"outcome":"success","imageName":["edmate-devcontainer:0.6"], ...}
```

`npx --yes @devcontainers/cli@0.89.0 up --workspace-folder <clone>` (postCreateCommand runs here)
```
Packages: +207
Done in 19.1s using pnpm v12.14.0
{"outcome":"success", ..., "remoteUser":"vscode", ...}
```

`npx --yes @devcontainers/cli@0.89.0 exec --workspace-folder <clone> ./verify.sh` (a throwaway script, not committed,
that prints tool versions, then runs `git config core.hooksPath`, `python3 .githooks/secret-scan.py --all` and
`corepack pnpm test`):
```
node v22.22.3
pnpm 12.14.0
Python 3.12.3
PyYAML 6.0.1
jq-1.7
Docker version 29.5.3-5, build d1c06ef6b41d88d76866aea43c246cd7c63d04fa
Docker Compose version 5.6.0-2
host daemon 29.5.3
claude 2.1.302 (Claude Code)
core.hooksPath=.githooks
secret_scan_exit=0
pnpm_test_exit=0
 Tasks:    7 successful, 7 total
Cached:    0 cached, 7 total
```
Re-ran after pinning buildx, with a fresh container (`up --remove-existing-container`): same output, all exits 0.

On the host: `npx --yes prettier@3.9.10 --check .devcontainer/devcontainer.json README.md` → `All matched files use
Prettier code style!`; `python3 .githooks/secret-scan.py --all` → exit 0.

## Changes

- `.devcontainer/Dockerfile`: `mcr.microsoft.com/devcontainers/base:3.0.10-noble` pinned by digest; apt installs
  `python3` and `python3-yaml=6.0.1-2build2`. jq ships in the base image.
- `.devcontainer/devcontainer.json`: node feature 2.1.1 (Node 22.22.3, nvm 0.40.8, no pnpm/npm override);
  docker-outside-of-docker feature 1.10.1 (Docker CLI 29.5.3, buildx 0.38.0, no v1 `docker-compose`); workspace
  mounted at the host path; `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`; forwards port 3000; postCreateCommand installs
  Claude Code 2.1.302, sets `core.hooksPath .githooks` and runs `corepack pnpm install --frozen-lockfile`.
- `README.md`: one line under Requirements pointing at the dev container.

## Deviations

- Ports: the plan said forward 8080, 9000, 9001. With docker-outside-of-docker, Compose containers run on the host
  daemon and already publish those ports on the host's 127.0.0.1, so forwarding them from the dev container would
  clash. Only 3000 (the Next.js dev server, which runs inside the dev container) is forwarded.
- A small Dockerfile instead of the python feature: the python feature builds Python from source (slow) and its
  PyYAML would come from pip unpinned; apt gives the same Python 3 + PyYAML as `docs/setup/devbox.md`.
- `workspaceMount`/`workspaceFolder` use `${localWorkspaceFolder}` (a variable, no hard-coded host path) so Compose
  bind mounts like `./data/minio` resolve on the host daemon.

## Decisions

### 18 Oct 2026 · 0.6 Exact pins for every dev container input · decided by tdd-guide · risk: low
Decided: Base image `mcr.microsoft.com/devcontainers/base:3.0.10-noble` by digest `sha256:21e9e327...86c3e6`; node feature `2.1.1` with Node `22.22.3` and nvm `0.40.8`; docker-outside-of-docker feature `1.10.1` with Docker CLI `29.5.3` and buildx `0.38.0`; Claude Code `2.1.302`; PyYAML `6.0.1-2build2` (apt); devcontainers CLI `0.89.0` for verification. Node 22.22.3 is the 22.x on the build machine, since `.nvmrc` and `engines` only say 22.
Why: Lead answer 1: pin everything so builds are repeatable; each version was current and checked to build.
Alternatives: Track `latest` or major tags (`:2`, `@latest`), which drift silently.
Reversible: Yes; bump the numbers in one PR.

### 18 Oct 2026 · 0.6 Not pinned where the tool has no option · decided by tdd-guide · risk: low
Decided: `python3` (3.12.3) and the `docker compose` plugin (moby-compose 5.6.0) are not pinned to an exact package version; jq (1.7.1) is fixed only by the base image digest.
Why: The docker feature has no compose-plugin version option, and pinning `python3` to an apt build in `noble-updates` would break once Ubuntu replaces it; the base digest already fixes jq.
Alternatives: Pin apt versions of python3/jq exactly and accept builds breaking on security updates.
Reversible: Yes.

### 18 Oct 2026 · 0.6 Node via the official node feature · decided by team lead · risk: low
Decided: Node comes from `ghcr.io/devcontainers/features/node` (pinned), not an nvm curl-install in postCreateCommand; pnpm only through corepack (`pnpmVersion: none`).
Why: Lead answer 2; the feature is pinned and cached in the image, and avoids piping an unpinned install script.
Alternatives: nvm install script in postCreateCommand, as the original plan step 2 said.
Reversible: Yes.

### 18 Oct 2026 · 0.6 Forward only port 3000; mount the repo at its host path · decided by tdd-guide · risk: low
Decided: The dev container forwards 3000 only, and mounts the workspace at the same path as on the host.
Why: Docker runs on the host (docker-outside-of-docker), so Compose already publishes 8080/9000/9001 on the host and forwarding them would clash; same-path mounting makes Compose's relative bind mounts work from inside the container.
Alternatives: Forward 8080/9000/9001 as the plan said; mount at `/workspaces/edmate` and pass `LOCAL_WORKSPACE_FOLDER` into Compose.
Reversible: Yes.
