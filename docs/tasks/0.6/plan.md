# Implementation Plan: Task 0.6 — Dev Container

## Overview
Set up a Dev Container with Node 22 (corepack pnpm), Python 3 (PyYAML), Docker access, Claude Code, and jq, plus a postCreateCommand that configures git hooks and installs dependencies. The container must pass `corepack pnpm test` and `python3 .githooks/secret-scan.py --all` on build.

## Acceptance
- [ ] `.devcontainer/devcontainer.json` builds without error
- [ ] Inside the container: `corepack pnpm test` passes
- [ ] Inside the container: `python3 .githooks/secret-scan.py --all` passes
- [ ] Setup matches `docs/setup/devbox.md` (Node 22, corepack pnpm, Python 3, PyYAML, jq, no host paths, no secrets)

## Files to Create / Modify

### Create
- `.devcontainer/devcontainer.json` — Main Dev Container config
  - Image: `mcr.microsoft.com/devcontainers/base:ubuntu-24.04` (modern, LTS, no host dependencies)
  - Node 22.x via nvm in postCreateCommand
  - Features: docker-outside-of-docker (pinned image), Python 3
  - System packages: jq, git, curl
  - Port forwards: 8080 (Caddy), 9000 (MinIO API), 9001 (MinIO Console)
  - postCreateCommand: git config + corepack pnpm install
- `.devcontainer/Dockerfile` — Optional; only if base image needs customization. If using mcr.microsoft.com/devcontainers/base with devcontainer features, likely not needed.

### No modifications required
- `docs/setup/devbox.md` — Already documents the VM setup correctly; this plan makes Dev Container match it
- `.githooks/` — Already in place; plan only ensures it runs in the container
- `package.json` — Already specifies `engines: { node: "22.x" }`
- `.nvmrc` — Already specifies `22`

## Files Out of Bounds
- Everything outside `.devcontainer/` and `docs/tasks/0.6/` (per task instructions)
- Root docs/: No README changes needed

## Implementation Steps

### Step 1: Create `.devcontainer/devcontainer.json`
- **Action:** Write base configuration with:
  - `image: "mcr.microsoft.com/devcontainers/base:ubuntu-24.04"` (pre-built, includes git, curl, sudo)
  - `features: { "ghcr.io/devcontainers/features/docker-outside-of-docker:latest": { version: "latest" }, "ghcr.io/devcontainers/features/python:latest": { version: "3.x" } }`
  - `customizations: { vscode: { extensions: [] } }` (leave empty; Claude Code is installed via npm)
  - `forwardPorts: [8080, 9000, 9001]`
  - `portsAttributes: { "8080": { label: "Caddy HTTP" }, "9000": { label: "MinIO API" }, "9001": { label: "MinIO Console" } }`
  - `postCreateCommand: "git config core.hooksPath .githooks && corepack pnpm install --frozen-lockfile"`
- **Why:** Devcontainer spec compliance; docker-outside-of-docker for Compose; Python for secret-scan; ports match compose.yaml
- **Dependencies:** None
- **Risk:** Low — standard devcontainer patterns, no modifications to existing code

### Step 2: Add Node 22 and tooling in postCreateCommand
- **Action:** Extend postCreateCommand to run:
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash && \
  export NVM_DIR="$HOME/.nvm" && \
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && \
  nvm install 22 && \
  npm install -g @anthropic-ai/claude-code@latest && \
  apt-get update && apt-get install -y jq && \
  git config core.hooksPath .githooks && \
  corepack pnpm install --frozen-lockfile
  ```
- **Why:** NVM installs Node 22 matching .nvmrc; Claude Code enables /rc remote control; jq for tools; corepack is included with Node 22
- **Dependencies:** Step 1
- **Risk:** Medium — NVM install script is from GitHub; pin Claude Code to @latest for now (or specific version once 0.6 is stable)

### Step 3: Verify no secrets or host mounts
- **Action:** Check devcontainer.json for:
  - No `mounts` entry or only bind `source` refs (never secrets)
  - No env vars hardcoded except NODE_ENV (development)
  - No reference to host paths like `/var/run/docker.sock` directly (docker-outside-of-docker feature handles it)
- **Why:** Prevent accidental commit of keys or exposure of host paths
- **Dependencies:** Steps 1–2
- **Risk:** Low — straightforward review

### Step 4: Test acceptance (local verification strategy)
- **Action:** Document what can be verified on this machine:
  - `npx @devcontainers/cli build` (if available) or VS Code Dev Container extension can validate the JSON schema
  - `docker build -t edmate-devcontainer $(cat .devcontainer/devcontainer.json | jq -r '.image')` to test the base image pulls
  - Full build requires a dev container runtime (VS Code, Cursor, or the `devcontainers` CLI)
  - CI or human must actually run `corepack pnpm test` inside the container
- **Why:** JSON schema validation is possible locally; full build requires a runtime
- **Dependencies:** Steps 1–3
- **Risk:** Low

## Testing Strategy
- **Acceptance (manual, in Dev Container runtime):**
  - Container builds without error
  - `node --version` shows Node 22.x
  - `corepack --version` works
  - `pnpm --version` works (corepack-managed)
  - `python3 .githooks/secret-scan.py --all` exits 0
  - `corepack pnpm test --filter=contracts` runs and passes (smoke test)
- **Local verification (this machine):**
  - `jq . .devcontainer/devcontainer.json` parses without error (JSON syntax)
  - Search `.devcontainer/devcontainer.json` for secrets patterns: `PASSWORD`, `TOKEN`, `KEY`, `SECRET` (case-insensitive)

## Risky Paths Touched
None (checked against `.claude/skills/merge-gate/risk-paths.txt`). Dev Container configuration is non-risky infrastructure code.

## Open Questions
1. **Claude Code version:** Should we pin to a specific major.minor (e.g., `@1.0.0`) or track `@latest`? For now, `@latest` is safe; stable after first merge.
2. **Docker-outside-of-docker base image:** The feature auto-selects; should we pin the feature version or let it auto-update? Auto-update is simpler for dev.
3. **PyYAML installation:** Python feature includes pip; should plan assume `pip install pyyaml` or include it in devcontainer.json `postCreateCommand`? Include it explicitly for clarity.

## Success Criteria
- [ ] `.devcontainer/devcontainer.json` valid JSON with all required keys
- [ ] postCreateCommand installs Node 22, Claude Code, PyYAML, jq
- [ ] Container builds and `corepack pnpm install --frozen-lockfile` succeeds
- [ ] Inside container: `corepack pnpm test` passes
- [ ] Inside container: `python3 .githooks/secret-scan.py --all` passes
- [ ] No hardcoded secrets or host paths in config

## Lead answers (18 Oct 2026) — override the sections above

1. **Pin everything.** Claude Code at an exact npm version (no `@latest`); every devcontainer feature at an exact version; the base image at an exact tag (and digest if practical).
2. **Node** via the official `ghcr.io/devcontainers/features/node` feature pinned to the exact Node 22 minor in `.nvmrc`/engines, not nvm in postCreateCommand. pnpm through corepack only.
3. PyYAML and jq installed explicitly (feature or apt), pinned where the tool allows.
4. **Verify for real:** Docker is running on this machine. Use `npx --yes @devcontainers/cli@<pinned> build --workspace-folder .` then `up` + `exec` to run `corepack pnpm test` and `python3 .githooks/secret-scan.py --all` inside the container, and `git config core.hooksPath` to show `.githooks`. Paste the trimmed output in the handoff, then remove the container. If the CLI can't run here, say exactly why and fall back to a JSON check.
5. Log the pins and the Node-feature choice in the handoff decisions.
