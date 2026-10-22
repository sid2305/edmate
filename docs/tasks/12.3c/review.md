# 12.3c review — APPROVE
Reviewers: security-reviewer (sonnet), code-reviewer (sonnet), typescript-reviewer (sonnet)

Every studio write route (create, replace and add-link; caption files go through create) now requires `rightsDeclared: true` server-side, as a strict zod literal, before any write. Tests show that a missing or false declaration gets a 400 with nothing written. The upload centre has a labelled checkbox that keeps the upload controls disabled until it is ticked (jest-axe clean). The public /legal/rights page is a server component that renders text nodes only. It shows a neutral placeholder while the grievance contact is pending and invents no contact details. All three reviewers approve with no findings.

## Findings
