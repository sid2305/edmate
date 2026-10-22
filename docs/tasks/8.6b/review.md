# 8.6b review — APPROVE

Reviewers: code-reviewer (opus), typescript-reviewer (sonnet), security-reviewer (sonnet), database-reviewer (sonnet), lead

## Findings
- [MEDIUM] [deferred 8.6f] packages/db/test/packages.int.test.ts — the PACKAGES_MAX cap test runs creates one by one; add a concurrent Promise.all case at the boundary.
- [LOW] [deferred 8.6f] packages/db/src/repositories/packages.ts — the 20-package cap throws the same `invalid` kind as a bad draft; Phase C checks listForTeacher first, a distinct kind can come later.
- [LOW] [deferred 8.6f] packages/db/src/repositories/packages.ts — the module-ownership check and the version locking are duplicated with package-versions.ts (which writes versions without the package row lock); share both.
- [LOW] [deferred 8.6f] packages/db/src/repositories/agents.ts — DraftAgentInput types modelPolicy as z.unknown(); reference ModelPolicySchema.
- [LOW] [deferred 8.6f] packages/db/src/repositories/packages.ts — the audit row keeps the package id out of `after` because the redactor treats digit-led UUIDs as phone numbers; fix the redactor.
- [LOW] [wontfix] packages/db/src/repositories/packages.ts — checkModules returns early for an empty module list; a zero-module package is valid by the contract.
