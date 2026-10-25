# Handoff: 8.2g — Deploy egress rule for web links (ADR-0014 consequence)

Status: DONE

## What changed

- Added `docs/setup/web-link-egress-firewall.md`: the deploy note. States the rule (worker
  egress restricted to public 443 plus its own Postgres/Redis/object-storage endpoints, as a
  second layer behind `packages/ingest/src/fetch/address.ts`), the resolver-ignores-`/etc/hosts`-
  and-split-horizon-DNS note, a compose network-segmentation explanation pointing at the new
  example file, an `iptables`/`DOCKER-USER` snippet and a cloud-security-group paragraph (both
  placeholders, no real hosts/credentials), and the "second layer, not a replacement" closing
  note. Ends with the board-task-13.6 fold-in line, matching the `sign-in-mail-and-proxy.md`
  precedent.
- Added `docker/compose.production-egress.example.yaml`: a standalone compose file (own
  `name: edmate-production-egress-example`, never combined with `docker/compose.yaml` via `-f`).
  `postgres`/`redis`/`minio` on an `internal: true` network only; `worker` on that network plus a
  second `egress` network. Header comment states it is reference-only and gives its own
  standalone `docker compose config` validation command. `image:`/`build:` lines reused verbatim
  from `docker/compose.yaml` (Open question 2, accepted) so it resolves end to end.
- `docker/compose.yaml`: one comment line added above the existing `EDMATE_WEB_LINK_HOSTS` line
  (worker service, ~line 149), pointing at the new doc. No env value, default or service key
  changed.
- `docker/env.example`: one comment line added above the existing `EDMATE_WEB_LINK_HOSTS=*` line
  (~line 82), pointing at the new doc, mirroring the `EMAIL_SERVER` → `sign-in-mail-and-proxy.md`
  pointer already in that file.

## Decisions

### 25 Oct 2026 · 8.2g ADR-0014 left unedited · decided by builder · risk: low
- Decided: did not touch `docs/adr/0014-web-link-egress.md` (Open question 1).
- Why: editing `docs/adr/**` is a risky path needing architect, security-reviewer and
  typescript-reviewer; the new doc links to the ADR one-way instead, per the plan's accepted
  recommendation.

### 25 Oct 2026 · 8.2g example file reuses real image/build lines · decided by builder · risk: low
- Decided: `docker/compose.production-egress.example.yaml`'s `postgres`/`redis`/`minio`/`worker`
  services use the exact `image:`/`build:` lines from `docker/compose.yaml` (Open question 2).
- Why: keeps the example realistic and lets `docker compose config` resolve it end to end, while
  staying a separate, standalone file (own `name:`) never combined with the dev compose file.

### 25 Oct 2026 · 8.2g stack-config.test.ts left unedited · decided by builder · risk: low
- Decided: did not add a new assertion to `apps/web/src/deploy/stack-config.test.ts` (Open
  question 3).
- Why: task scope is docs and compose/network config only, no application code; that file is a
  `.ts` test under `apps/web/src`.

### 25 Oct 2026 · 8.2g doc filename · decided by builder · risk: low
- Decided: used `docs/setup/web-link-egress-firewall.md` (Open question 4).
- Why: parallels the existing `sign-in-mail-and-proxy.md` topic-named style in the same
  directory; low stakes, easily renamed later.

## Left to do

None.

## Evidence

- Baseline test (before any edit):
  `corepack pnpm turbo run test --filter=@edmate/web -- stack-config` →
  `src/deploy/stack-config.test.ts (14 tests)` all passed, `Test Files 1 passed`,
  `Tests 14 passed`. (The run's own non-zero exit is the package's global coverage threshold
  check firing because only one file ran under `--coverage`; not a stack-config failure.)
- Same command after the two comment-only edits → identical result: 14/14 tests passed, same
  coverage-threshold-only exit, no new failures.
- Compose syntax, Docker was available in this worktree, so the plan's primary verification path
  was taken (not the hand-check fallback):
  - `docker compose -f docker/compose.yaml config` → `DEV COMPOSE OK` (renders only; no
    container started, stopped or recreated).
  - `docker compose -f docker/compose.production-egress.example.yaml config` → `EXAMPLE COMPOSE
    OK` (fully standalone; never combined with the dev file).
- `git diff -- docker/compose.yaml docker/env.example` → exactly one new comment line added in
  each file next to the existing `EDMATE_WEB_LINK_HOSTS` line; no other character changed.
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).
- No running container (`edmate-caddy-1`, `-web-1`, `-worker-1`, `-mailpit-1`, `-postgres-1`,
  `-redis-1`) was touched; only `docker compose ... config` was run.

## Budget

Tool calls used: 15
