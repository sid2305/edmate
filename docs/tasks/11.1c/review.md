# 11.1c review — APPROVE

Reviewers: typescript-reviewer (sonnet), code-reviewer (sonnet), lead

Both reviewers approved with no CRITICAL, HIGH or MEDIUM findings. The code-reviewer re-ran the web gate on a scratch worktree (34/34 green). The student scope comes only from the session principal, and the teacher id from the agent's owner, never from client input. The repository already limits the list to trial and active subscriptions. A failed lookup is logged by error name and leaves chats and start links unchanged. Join links open in a new tab with `rel="noopener noreferrer"`. The diff touches only the plan's Phase C files, and the existing chats/startable tests are unchanged.

## Findings
- [LOW] [deferred 11.1d] packages/db/src/repositories/live-classes.ts:54-58 — the repository accepts http as well as https links (the studio route already refuses http); 11.1d decides https only in the repository.
- [LOW] [wontfix] apps/web/app/home/page.tsx — owner lookups run one after another, matching the existing homeChatLinks and homeStartLinks precedent; a student has few agents.
