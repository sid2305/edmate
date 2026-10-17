# GitHub setup

How the public `edmate` repo and the agents' bot are set up. You do steps 1–3 in the browser, because only you can create things on your account. Claude does step 4.

Nothing secret goes in this file or anywhere in the repo. The bot's private key lives outside the repo, in `~/.edmate-bot/`.

## 1. Create the private GitHub App (the agents' bot)

A GitHub App is a bot identity. "Private" means only your account can install it. Agents use it for every push, PR, comment and merge, so GitHub can tell agent actions apart from yours.

1. Go to GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. **Name:** `edmate-bot-sid2305` (app names are unique across GitHub).
3. **Homepage URL:** the repo URL, e.g. `https://github.com/sid2305/edmate`.
4. **Webhook:** untick **Active**. The bot needs no webhook.
5. **Repository permissions:**

   | Permission | Access | Why |
   | --- | --- | --- |
   | Contents | Read and write | Push task branches |
   | Pull requests | Read and write | Open, update and merge PRs |
   | Issues | Read and write | Labels and `needs-human` questions |
   | Workflows | Read and write | Task 0.5 adds `.github/workflows/` |
   | Checks | Read | Read CI results for the merge gate |
   | Metadata | Read | Required by GitHub |

6. **Where can this GitHub App be installed?** → **Only on this account**.
7. Click **Create GitHub App** and note the **App ID** at the top of the page.
8. Under **Private keys**, click **Generate a private key**. A `.pem` file downloads.
9. Move it out of Downloads and lock it down:
   ```bash
   mkdir -p ~/.edmate-bot && mv ~/Downloads/edmate-bot-sid2305.*.pem ~/.edmate-bot/edmate-bot.pem && chmod 600 ~/.edmate-bot/edmate-bot.pem
   ```
   Never put this file inside `~/edmate`. A hook and `.gitignore` block it anyway.

## 2. Create the public repo and install the bot on it

1. Claude creates the repo and pushes the first commit after the secret scan passes, once you say go.
2. In the App's page, choose **Install App → your account → Only select repositories → edmate**.
3. The URL afterwards ends in `/settings/installations/<number>`. That number is the **Installation ID**.

## 3. Repository settings (one-time, as you)

- **Settings → Code security:** turn on **Secret scanning** and **Push protection**. Both are free for public repos. GitHub then rejects pushes that contain known key formats, even if our own scan missed one.
- **Settings → Rules → Rulesets → New branch ruleset** for `main`:
  - Require a pull request before merging, with **0** required approvals. The merge gate decides; risky PRs wait for your `human-approved` label.
  - Require status checks to pass: `ci`, `merge-gate`, `secret-scan`. These are added after task 0.5 creates them.
  - Block force pushes. Restrict deletions.
  - Bypass list: only you.
- **Settings → Actions → General:** "Require approval for all outside collaborators" for workflows from forks.

## 4. Wire the bot into the agents (Claude does this)

Tell Claude the **App ID** and **Installation ID** (these are not secret). Claude then adds:

- a script that turns the private key into a short-lived (1-hour) token for each `git push` and `gh` call;
- repo-local git settings, so agent commits and pushes come from `edmate-bot-sid2305[bot]`;
- a hook so agents can't fall back to your personal GitHub login.

## What the bot can never do

- Add the `human-approved` label. A hook blocks it, and the `merge-gate` check verifies the label was added by **you**.
- Bypass the `main` ruleset. It is not on the bypass list.
- Read `~/.edmate-bot/` from inside a task. The key is only read by the token script.

## If a secret ever leaks

1. **Rotate it first** at the provider (revoke and reissue). Deleting it from git is not enough: public history may already be copied.
2. Then remove it from the code, and record what happened in `docs/decisions/log.md`.
