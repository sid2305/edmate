# Backup model provider (Microsoft Foundry)

When the Claude subscription's usage window is exhausted, the whole agent team stops: the lead, every
builder and reviewer draw from one pool. The backup keeps the same team running on Claude models
deployed in the human's Microsoft Foundry resource, billed per token from the human's Azure credit.
Nothing in the team changes: same agents, skills, hooks, worktrees and merge gate; only the model
endpoint and the bill. Human decision, 22 Oct 2026.

**Rules**
- The backup is for building and testing only. It never serves pilot students; the product's own
  model key stays separate (`docker/env.example`).
- It is a deliberate, capped exception to "stay within the subscription": the Azure subscription's
  spending limit stays on and a budget alert sits at the monthly credit.
- The repo is public. The resource name and deployment names are not secrets, but the filled-in
  config and the key live outside the repo and are never pasted into chat, a task file or a commit.

## One-time setup (the human)

1. In the [Foundry portal](https://ai.azure.com/) create a resource and three **standard
   pay-as-you-go** deployments (not provisioned, which bills while idle), one per tier, with a
   pinned model version: an Opus-class, a Sonnet-class and a Haiku-class Claude model. Name each
   deployment with its model ID (for example `claude-sonnet-5`) so Claude Code recognises the model.
2. Copy the config template outside the repo and fill it in:
   ```bash
   mkdir -p ~/.config/edmate && cp scripts/foundry.env.example ~/.config/edmate/foundry.env
   chmod 600 ~/.config/edmate/foundry.env
   ```
   Set the resource name (name only, not a URL) and the three deployment names.
3. Authentication, one of:
   - paste the API key into `ANTHROPIC_FOUNDRY_API_KEY` in that file; or
   - leave it empty and store the key in the Mac Keychain:
     `security add-generic-password -a "$USER" -s edmate-foundry-key -w`; or
   - leave it empty, no Keychain item, and `az login` once (Entra ID).
4. Check it: `scripts/claude-backup.sh --foundry` should start Claude Code, and `/status` inside
   it shows `Microsoft Foundry` as the API provider. Exit, then `scripts/claude-backup.sh --check`
   should print `subscription OK`.

## Day to day

Start the lead (and any other session) with the launcher instead of `claude`:

```bash
scripts/claude-backup.sh            # probe the subscription, fall back to Foundry on a usage limit
scripts/claude-backup.sh --continue # same, resuming the last session
scripts/claude-backup.sh --check    # just report which provider would be used
scripts/claude-backup.sh --foundry  # force the backup (e.g. the probe is wrong)
```

The probe is one tiny Haiku call on the subscription. On a usage-limit error the launcher exports the
Foundry variables (`CLAUDE_CODE_USE_FOUNDRY=1`, the resource, the key from the file or Keychain, the
three deployment names as the opus/sonnet/haiku aliases) and starts Claude Code; on any other error it
stops and says so rather than silently switching to paid usage. There is no automatic failover inside a
running session: when the limit hits mid-session, quit and relaunch with `--continue`. All state is on
disk (board, blockers, task folders, worktrees), so nothing is lost. Every start is logged, without
secrets, to `~/.config/edmate/backup.log`.

On the backup the main session runs on the Sonnet deployment by default (`EDMATE_BACKUP_MAIN_MODEL`),
and `EDMATE_PROVIDER=foundry` is set so the team-lead skill's backup rules apply: builders on Sonnet,
no third slot, finish running work first, record `provider: foundry` in the board's `model` field.

## Cost to expect

From the board's closeout metrics an Opus-built task re-reads about 50M cached tokens: roughly $25–35
at list prices, about half that on Sonnet, plus the lead's own context. A $150 monthly credit covers
about one backup day a month with everything on Sonnet. Task 0.22's review (24 Oct 2026) and each
closeout record the spend so the mix can be adjusted.

## Reference

- Claude Code on Microsoft Foundry: https://code.claude.com/docs/en/microsoft-foundry
- Variables used: `CLAUDE_CODE_USE_FOUNDRY`, `ANTHROPIC_FOUNDRY_RESOURCE`, `ANTHROPIC_FOUNDRY_API_KEY`
  (or Entra via `az login`, or `ANTHROPIC_FOUNDRY_AUTH_TOKEN`), `ANTHROPIC_DEFAULT_OPUS_MODEL`,
  `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_MODEL`,
  `ANTHROPIC_SMALL_FAST_MODEL`, `ENABLE_PROMPT_CACHING_1H`.
