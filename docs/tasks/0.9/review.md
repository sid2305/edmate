# 0.9 review — APPROVE
Reviewers: security-reviewer (opus)

security-reviewer confirmed the `secrets` job uses main's scanner and allow list, passes files as an argv list (no shell), prints no secret values, fails closed on bad refs, git errors and scanner crashes, and caught a secret added in a merge commit in a scratch repo. Action SHAs match their tags; permissions are `contents: read` with `persist-credentials: false`. Live CI: `secrets` and `label` pass.

## Findings
- [MEDIUM] [wontfix] .github/workflows/ci.yml:57 — a PR can rewrite its own CI job, because pull_request runs the PR's workflow. See decision log 18 Oct 2026.
- [LOW] [deferred 0.10] .githooks/secret-scan-allow.txt:3 — the scanner skips its own file.
