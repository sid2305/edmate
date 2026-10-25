# Plan: 8.2g — Deploy egress rule for web links (ADR-0014 consequence)

## Acceptance (verbatim, from docs/board/tasks.yaml)

> the deploy guide documents the rule, and the production compose or firewall example applies it.

Title (context): "Deploy egress rule for web links (ADR-0014 consequence): the deploy guide and
compose let the worker reach only public port 443 plus its own database, Redis and object
storage, as a second layer behind the range check; from the 8.2e architect review: the deploy
guide says the web-link resolver ignores /etc/hosts and split-horizon DNS."

### How it will be shown
- A reviewer reads the new deploy note (`docs/setup/web-link-egress-firewall.md`) and confirms it
  states: (a) the rule — the worker's network egress is restricted to public port 443 plus its own
  Postgres, Redis and object-storage endpoints, as a second layer behind the app-level range check
  in `packages/ingest/src/fetch/address.ts`; (b) the resolver (a `dns.promises.Resolver`, ADR-0014
  Decision 1/Consequences) talks to configured nameservers directly and ignores `/etc/hosts` and
  any split-horizon/internal DNS view, so neither can be used to widen or narrow what the worker
  reaches — only `EDMATE_WEB_LINK_HOSTS` (app layer) and this network rule (firewall layer) do that.
- A reviewer reads the new standalone compose example
  (`docker/compose.production-egress.example.yaml`) and sees Postgres/Redis/MinIO on an
  `internal: true` network (no route out) with the worker alone also on a separate `egress`
  network, plus a firewall snippet (iptables and a cloud-security-group shape) in the doc that
  restricts that `egress` network's egress to 443 and the three service endpoints — because Compose
  itself has no port/destination egress filter, the firewall layer is documented text, not compose.
- A diff of `docker/compose.yaml` and `docker/env.example` shows one new comment line each, next
  to the existing `EDMATE_WEB_LINK_HOSTS` setting, pointing at the new doc (same shape as the
  `EMAIL_SERVER` → `sign-in-mail-and-proxy.md` pointer from task 1.4d). No value, default or
  service shape changes anywhere in either file.

## Files to create
- `docs/setup/web-link-egress-firewall.md` — the deploy note. Follows the `sign-in-mail-and-proxy.md`
  precedent (1.4d): states it is deploy config, not a code change; ends with "Board task 13.6 (the
  real deploy guide) should fold this page in once it exists." Sections:
  1. The rule and why (cites ADR-0014 Consequences and the 8.2e review LOW on
     `packages/ingest/src/fetch/address.ts:113-131`).
  2. The resolver-ignores-/etc/hosts-and-split-horizon-DNS note (the exact sentence the 8.2e
     review asked for), stated plainly, with the one line on what *does* control reachability
     (`EDMATE_WEB_LINK_HOSTS` + this firewall layer).
  3. Compose network-segmentation example (point at the new example file; explain `internal: true`
     keeps Postgres/Redis/MinIO off any network with a route out, and the worker's dedicated
     `egress` network is the only thing that needs a host/cloud firewall rule).
  4. Firewall example: an `iptables`/`DOCKER-USER` snippet keyed on the worker's egress-network IP
     (placeholder), allowing only 443 (any host) and the three service endpoints by host:port, then
     dropping the rest; a one-paragraph equivalent for a cloud security group (allow 443 egress to
     0.0.0.0/0 plus the RDS/Elasticache/S3 endpoints on the worker's own security group; add no
     other egress rule). Both are prose/code blocks in the markdown, not executable scripts.
  5. One line: this is a second layer behind the app-level check; it does not replace
     `EDMATE_WEB_LINK_HOSTS` or the range check in `packages/ingest/src/fetch/address.ts`.
- `docker/compose.production-egress.example.yaml` — a **standalone** compose file (its own `name:`,
  not an overlay for `docker/compose.yaml`, never combined with it via `-f`). Services: `postgres`,
  `redis`, `minio` on an `internal: true` network only; `worker` on that network plus a second
  `egress` network. A header comment says it is a reference only, never run as part of the dev
  stack, and gives its own standalone `docker compose config` validation command.

## Files to modify (comments only, no shape change)
- `docker/compose.yaml`: one comment line next to the `worker` service's existing
  `EDMATE_WEB_LINK_HOSTS` line (~line 148-149), pointing at the new doc. No env value, default or
  service key changes.
- `docker/env.example`: one comment line next to the existing `EDMATE_WEB_LINK_HOSTS=*` block
  (~line 79-82), pointing at the new doc, mirroring the `EMAIL_SERVER` → `sign-in-mail-and-proxy.md`
  pointer already in that file.

## Files out of bounds
- `.github/**`, `.claude/**` (explicit instruction).
- `docs/adr/0014-web-link-egress.md` or any ADR: this task implements an already-accepted ADR
  consequence; it does not change the policy, so no ADR edit and no architect/security-reviewer/
  typescript-reviewer gate (see Open questions).
- Any application code: `packages/ingest/**`, `apps/worker/src/**`, `apps/web/src/**` (including
  `apps/web/src/deploy/stack-config.test.ts` — read it, don't edit it; see Open questions).
- `docs/board/tasks.yaml` — the lead updates board status, not the builder.
- Any file under `docker/data/` (the running dev stack's live volumes).

## Tests first / verification
1. Before touching anything, read `apps/web/src/deploy/stack-config.test.ts` in full (already
   done in planning: it text-parses `docker/compose.yaml` and `apps/web/Dockerfile` for specific
   `${VAR:-default}` env lines; it does not assert on `EDMATE_WEB_LINK_HOSTS`, which uses
   `${VAR-*}`, no colon, so it isn't matched by the test's `passed()` regex either way). Run it
   once (`source ~/.nvm/nvm.sh && corepack pnpm turbo run test --filter=@edmate/web -- stack-config`)
   to confirm it is green before any edit — this is the "existing compose/deploy test" named in the
   task.
2. Make the two comment-only edits to `docker/compose.yaml` and `docker/env.example`; re-run the
   same test (step 1's command) and confirm it is still green with no new failures — proves the
   comment-only diff didn't touch any line the test matches.
3. Validate compose syntax **without touching the running dev stack**
   (`edmate-caddy-1`, `-web-1`, `-worker-1`, `-mailpit-1`, `-postgres-1`, `-redis-1` must not be
   restarted or recreated):
   - `docker compose -f docker/compose.yaml config` — renders only; starts, stops or recreates
     nothing. Confirms the edited (comment-only) file still parses.
   - `docker compose -f docker/compose.production-egress.example.yaml config` — the new file is
     entirely standalone (its own `name:`, never combined with `docker/compose.yaml` via `-f`), so
     this validates it in total isolation from the dev stack.
   - **If the builder's worktree has no Docker access** (precedent: task 1.4d hit this and
     hand-checked instead — "`docker compose config` was not run (no compose access in this
     worktree)"), skip both commands and instead hand-check: (a) the two comment-only diffs byte
     for byte against the surrounding lines (no other character changed); (b) the new standalone
     example file against the Compose Spec for `networks`/`internal` shape by eye. State in the
     handoff which path was taken (ran `docker compose config`, or hand-checked because Docker was
     unavailable) — do not silently skip verification.
4. Do not run `docker compose -f docker/compose.yaml up`, `restart`, `stop` or any command that
   starts, stops or recreates a container.

## Risky paths touched
None (checked against `.claude/skills/merge-gate/risk-paths.txt`): `docker/**` and
`docs/setup/**` match no glob in that file (the file's groups are
`packages/harness/src/guardrails/**` and other prompt/safety paths, `packages/harness/src/access/**`
and other identity/payments/webhook paths, `packages/contracts/**` and `docs/adr/**`, and
`.claude/**`/`.github/**`/`.githooks/**`). This PR therefore needs no named reviewer group beyond
`code-reviewer`, which runs on every PR regardless; no `risk: high` decision-log entry is required
for risk-paths reasons. (If the lead wants an entry anyway, for traceability back to ADR-0014's
"Tracked as board task 8.2g" line, that's the lead's call at merge, not a plan requirement.)

## Open questions (each with a recommended answer)
Lead (25 Oct 2026): all four recommendations accepted as written.

1. **Should this task also amend `docs/adr/0014-web-link-egress.md` to mark the Consequences line
   ("Tracked as board task 8.2g") as done, or the 8.2e review's deferred LOW as resolved?**
   Recommend **no** — editing `docs/adr/**` is a risky path needing architect, security-reviewer
   and typescript-reviewer, which this docs/config task shouldn't need to pull in for a pointer.
   The new deploy doc links to ADR-0014 one-way; the ADR itself is left as written. If the lead
   wants the ADR's line formally closed out, that's a tiny separate edit the lead can make directly
   (same pattern as the 8.2e review's lead-edited ADR MEDIUM).
2. **Does the new standalone example file need a real, working `build:`/image set so
   `docker compose config` fully resolves (vs. a schema-only skeleton)?** Recommend reusing the
   exact `image:`/`build:` lines already in `docker/compose.yaml` for postgres/redis/minio/worker,
   so the example stays realistic and `docker compose config` resolves cleanly end to end, while
   keeping it a separate, standalone file (own `name:`) so it's never accidentally combined with
   the dev compose file via `-f`.
3. **Should `apps/web/src/deploy/stack-config.test.ts` gain a new assertion (e.g., that the
   `EDMATE_WEB_LINK_HOSTS` line carries a pointer comment, or that the example file exists)?**
   Recommend **no** for this task — the task scope is explicitly "docs and compose/network config;
   no application code," and that file is a `.ts` test under `apps/web/src`. Leave it unedited; a
   follow-up board task can add such an assertion if the lead wants drift protection.
4. **Exact doc filename:** `docs/setup/web-link-egress-firewall.md` vs. some other name under
   `docs/setup/`. Recommend the name above (parallels `sign-in-mail-and-proxy.md`'s topic-named
   style) — no need to ask; low stakes, easily renamed later.

## Budget
Budget: 25 tool calls (1 phase, docs + docker config only; no source packages)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (only for: `docker compose config` validation if Docker is
available in the worktree, and running the one existing vitest file named above; no `up`,
`restart`, `stop`, `down` or any command that touches a running container).

## Exit conditions
- **Status: DONE** — both new files exist and read as described above; both comment-only edits
  land with no other character changed; `apps/web/src/deploy/stack-config.test.ts` is green before
  and after; compose syntax is confirmed either by `docker compose config` on both files (dev file
  unchanged behaviour, standalone example resolves alone) or, if Docker is unavailable in the
  worktree, by the hand-check described in Verification step 3, named in the handoff; no running
  container was restarted, recreated or stopped; handoff written with a `## Decisions` section
  noting the Open-questions answers taken.
- **Status: PARTIAL** — stop and hand back if: past ~25 tool calls with verification still open;
  Docker is unavailable *and* the hand-check can't confidently rule out a shape change (e.g. the
  diff isn't comment-only); or any doubt arises about whether a command would touch the running
  dev stack (stop before running it, don't guess).
