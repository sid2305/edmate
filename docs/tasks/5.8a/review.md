# 5.8a review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (opus)

Both reviewers ran typecheck, lint and tests for cli, web, content and db in a snapshot, and all passed. The one exception was an existing `slackClock` timing flake in cli `deps.test.ts`, which passed 3 out of 3 times on its own. The code reviewer confirmed that an unsigned set can never be served, and that the seed's pick throws before its transaction starts.

## Findings
- [MEDIUM] [deferred 5.8b] packages/content/src/promptPacks.ts — a signed pre-release set (for example `2.0.0-rc.1`) would outrank 1.3.0 and be pinned with no code change. The fix is to skip pre-release versions in `newestSignedSet`.
- [MEDIUM] [deferred 5.8e] apps/cli/src/commands/chat/world.ts — `loadChatPersonas` swallows the load error, and the banner gives no file name or reason.
- [LOW] [deferred 5.8e] apps/cli/src/commands/chat/world.ts — the fall-back to the fixture set when no set is signed is silent. The banner should show the prompt-pack source.
- [LOW] [deferred 5.8e] packages/content/src/promptPacks.ts — set ranking borrows `comparePersonaVersions`. Move it to a shared semver helper.
- [LOW] [deferred 5.8e] packages/content/src/promptPacks.ts — the `pending` check is repeated in `personaTemplates.ts` and `agePolicy.ts`. Share one `isSignedOff` helper.
- [LOW] [deferred 5.8e] apps/cli/src/commands/chat.ts — `/leave` matches only the exact line, so `/leave now` is sent as a role-play answer.
