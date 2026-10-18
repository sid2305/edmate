# 0.4 handoff: ADR template; ADR-0001 stack, ADR-0002 ports and adapters, ADR-0003 access filter by construction

Status: DONE
Branch: `m0/0.4-adrs`
Worktree: `.claude/worktrees/agent-aff11a7a71f02e9e1`
Risky: every `docs/adr/**` file (group "Contracts and ADRs"). Required reviewers: architect, security-reviewer, typescript-reviewer.

## Process

Per the plan's lead answers, the builder (tdd-guide) wrote the ADR text directly from the build plan, the PRD and the decision log. `architect` did not pre-draft. `architect`, `security-reviewer` and `typescript-reviewer` still review every ADR before merge.

## Acceptance evidence

Heading-check tests were written first and failed (no script yet), then passed.

`python3 -m unittest discover -s docs/adr -p 'test_*.py'`, before the script existed:
```
Ran 10 tests in 0.138s
FAILED (failures=10)
```
After:
```
Ran 10 tests in 0.260s
OK
```
The tests cover: all headings in order (silent pass), a missing heading (names file and heading), out of order, the template skipped, non-ADR files ignored, `## X` inside a line or `### X` not counted, several bad files all reported, a missing directory, and the real `docs/adr/` folder passing.

`python3 docs/adr/check-headings.py; echo "exit=$?"` on the real ADRs:
```
exit=0
```
(no output means every ADR has all seven headings in order)

`python3 .githooks/secret-scan.py --all; echo "exit=$?"`:
```
exit=0
```

Each ADR is `Accepted`, uses every template heading, and cites its sources:
- 0001: build plan § Tech stack (fixed) and rule 2; decision log 17 Oct 2026 · Tech stack.
- 0002: build plan § Repo layout, § Core contracts, § Turn pipeline spec (Determinism), rule 3; decision log 18 Oct 2026 · 0.3 Ports live in contracts and 17 Oct 2026 · 0.1 Harness purity rule. It names the Repo layout vs Core contracts conflict and the reason.
- 0003: build plan § Access filter points 1–9 (probe, public titles, the leak definition in the plan's words), § Turn pipeline spec step 6, task 5.4 acceptance; PRD § Locked means locked.

Merged PR: to be filled in by the lead on merge.

## Changes

Created:
- `docs/adr/0000-template.md`: the skeleton (Status, Date, Context, Decision, Alternatives, Consequences, Reviewers). Called "the template", not ADR-0000.
- `docs/adr/0001-tech-stack.md`
- `docs/adr/0002-ports-and-adapters.md`
- `docs/adr/0003-access-filter-by-construction.md`
- `docs/adr/check-headings.py`: stdlib only; optional dir argument (default: its own folder); exit 1 with `<file>: missing: <heading>` or `<file>: out of order: ...`. Not wired into CI (0.5 may add it).
- `docs/adr/test_check_headings.py`: unittest suite for the script.
- `docs/tasks/0.4/handoff.md`

## Deviations

- Added `docs/adr/test_check_headings.py` (not in the plan's file list) so the check script has real tests first.
- The ADRs' `## Reviewers` say "Pending: architect, security-reviewer, typescript-reviewer". The lead should replace "Pending" with the names once reviews finish.
- `README.md` still says `adr/ (later, task 0.4)`. Not edited because the brief kept this task inside `docs/adr/` and `docs/tasks/0.4/`. A one-line follow-up for the lead.
- Dropped one claim from the plan's ADR-0003 draft: the plan said the PRD calls a safety or access incident "existential", but the PRD does not say that. ADR-0003 quotes PRD § Locked means locked instead.

## Decisions

### 18 Oct 2026 · 0.4 ADRs recorded · decided by team lead · risk: high
Decided: Three architecture decisions already made in the build plan and the decision log are now written down as ADRs: the tech stack (TypeScript throughout, no Rust), where port interfaces live (`packages/contracts/src/ports.ts`, type-only, differing from the Repo-layout prose that says harness defines them), and the access filter being built by construction (filtered search, the code-only probe, public titles, the 8-token leak definition). A template (`docs/adr/0000-template.md`) fixes the shape every future ADR must use.
Why: Rule 2 requires an ADR before contracts, stack or prompt-pack behaviour can change again; writing these three down now gives that rule something to point at, and the ports note resolves a reader-visible conflict between two parts of the spec. No code or contract changed; the ADRs only record what the spec and log already say, each with its source.
Alternatives: Leave the decisions only in the build plan and decision log, with no `docs/adr/` folder yet.
Reversible: Only by a new ADR superseding one of these.

### 18 Oct 2026 · 0.4 Builder writes the ADR text · decided by team lead · risk: low
Decided: For task 0.4 the builder wrote the ADR text directly from the build plan, PRD and decision log; `architect` did not pre-draft it, but still reviews every ADR and its findings are fixed before merge.
Why: Saves tokens; these ADRs only record decisions already made, so there is nothing for architect to decide up front.
Alternatives: Architect drafts the full ADR text first and the builder copies it, as the plan and the merge-gate skill describe.
Reversible: Yes; later ADRs can go back to architect drafting.

### 18 Oct 2026 · 0.4 Heading check has its own tests · decided by tdd-guide · risk: low
Decided: Added `docs/adr/test_check_headings.py` (stdlib unittest) next to `docs/adr/check-headings.py`, and the script takes an optional folder argument so tests can run it on temporary folders.
Why: The brief asked for tests first; a folder argument lets the tests check failures without breaking the real ADRs.
Alternatives: Only run the script by hand against the real folder.
Reversible: Yes, delete the test file.

### 18 Oct 2026 · 0.4 Review · decided by team lead · risk: low
Decided: check-headings.py does not flag a heading that appears twice; it checks only that every template heading is present and in order. The lead fixed four wording findings in the ADRs and the README in this PR.
Why: Duplicate headings are harmless and nothing in the spec asks for the check; later ADR edits need three reviewers, so cheap fixes were made now.
Alternatives: Add a duplicate check.
Reversible: Yes.
