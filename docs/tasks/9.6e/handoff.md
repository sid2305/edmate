# 9.6e handoff: paused plan entry points on /home and the compare page

## Summary
Built `docs/tasks/9.6/plan.md` Phase E: every subscription state now has an entry point.
- `src/chat/liveChats.ts`: new `pausedAgents`/`homePausedLinks` (mirrors `startableAgents`/
  `homeStartLinks`). Only a `paused` live subscription qualifies; a repository failure shows no
  links and logs the error name only. This is additional to (not a replacement for) the existing
  chat/startable lists -- a paused subscription keeps its old chat (human answer B-49), so
  `liveChatAgents`'s own paused exclusion from the chat list is unchanged.
- `app/home/page.tsx` / `view.tsx`: a new "Paused" list, each item linking to
  `/learn/<id>/plan`. The empty-state placeholder now shows only when all three lists (chats,
  startable, paused) are empty.
- `app/packages/[agentId]/page.tsx`: a paused live subscription shows its own text ("Your plan
  with this teacher is paused.") and a "Manage plan" link to `/learn/<id>/plan`, instead of the
  "already subscribed" chat link. An active (or trial/past_due) subscription keeps the existing
  "Continue to chat" link and adds a "Change plan" link beside it, both to the same plan page
  9.6d already built.
- `messages/en.json`: new keys only, under existing `home` (`pausedTitle`, `pausedLink`) and
  `packages` (`pausedNotice`, `managePlan`, `changePlan`) namespaces -- append-only, per the
  shared-file rule. `apps/web/app/home/view.tsx`'s 11.2b question-queue entry
  (`AskQuestionForm`/live-classes block) is unchanged.

## Files
- `apps/web/src/chat/liveChats.ts` (modified) -- `pausedAgents`, `homePausedLinks`.
- `apps/web/src/chat/liveChats.test.ts` (modified) -- `pausedAgents (task 9.6e)` and
  `homePausedLinks` describe blocks.
- `apps/web/app/home/page.tsx` (modified) -- wires `homePausedLinks` into `HomeView`.
- `apps/web/app/home/page.test.tsx` (modified) -- asserts `homePausedLinks` is called with the
  same candidate list and that `paused` reaches `HomeView`.
- `apps/web/app/home/view.tsx` (modified) -- `paused` prop, "Paused" list, placeholder condition
  widened to all three lists.
- `apps/web/app/home/view.test.tsx` (modified) -- `paused plans (task 9.6e)` describe block
  (link target, placeholder suppression, axe).
- `apps/web/app/packages/[agentId]/page.tsx` (modified) -- paused-subscription branch and the
  "Change plan" link on the active branch.
- `apps/web/app/packages/[agentId]/page.test.tsx` (modified) -- paused-text/link and
  Change-plan-link tests.
- `apps/web/messages/en.json` (modified) -- new keys only, as above.

## Tests
- `src/chat/liveChats.test.ts`: 36/36 (27 pre-existing + 9 new: paused qualifies only for
  `paused`, every other status excluded, no-subscription excluded, failure logs error name only,
  no-candidates short-circuits, returns the paused ones).
- `app/home/view.test.tsx` and `app/home/page.test.tsx`: 24/24 (new: Paused list render + link,
  placeholder suppressed by a paused-only list, placeholder shown with all three empty, chats +
  paused together, axe, and the page-level wiring/candidate-list assertion).
- `app/packages/[agentId]/page.test.tsx`: paused text + link test and active
  Change-plan-link test added to the existing 9.3 suite; 15/15 (with `PackageCompare.test.tsx`)
  pass.
- Full gate (post-merge): `corepack pnpm turbo run typecheck lint test --filter=@edmate/web` ->
  10/10 tasks successful (typecheck, lint, test across all workspaces in scope).
- `python3 .githooks/secret-scan.py --all` -> clean (no output).

## Decisions

### 22 Oct 2026 · 9.6e placeholder condition widens to all three lists · decided by builder · risk: low
- Decided: `/home`'s empty-state placeholder (`t('placeholder')`) now shows only when `chats`,
  `startable` and `paused` are all empty, rather than just the first two.
- Why: the plan's Phase E tests say "the placeholder shows only when all three lists are empty",
  so a student with only a paused plan (no active chat, nothing startable) must see the Paused
  list instead of the "come back soon" placeholder.
- risk: low

### 22 Oct 2026 · 9.6e separate labels for the paused-page link vs. the active-page link · decided by builder · risk: low
- Decided: the compare page uses `packages.managePlan` ("Manage plan") for the paused branch and
  `packages.changePlan` ("Change plan") for the active branch, rather than one shared label.
- Why: both link to the same `/learn/<id>/plan` route, but the two states call for different
  wording -- a paused plan is being managed (resumed, cancelled), an active one is being changed
  (upgrade/downgrade). Keeping them distinct also matches /home's own `pausedLink` ("Manage
  plan") label for the paused list, so the same state always reads the same way across the app.
- risk: low

### 22 Oct 2026 · 9.6e `liveChatAgents`'s existing paused exclusion is left as is · decided by builder · risk: low
- Decided: `liveChatAgents` (the function behind `homeChatLinks`, which decides the /home chat
  list) still excludes `paused` from its `NOT_LIVE` set, so a paused subscription gets no chat
  link there; the new paused list is additional, built from a separate `pausedAgents` function.
- Why: human answer B-49 ("a paused subscription keeps its old chat") is about an already-open
  chat *session* continuing to work, not about `/home` offering a fresh chat link for a paused
  plan -- `entitle` already refuses turns on a paused subscription
  (`packages/harness/src/access/entitlement.ts`, out of this phase's bounds), so a chat link
  here would only lead to a dead end. The Phase E brief and plan only ask for a *new* paused
  entry point (the plan page), not a change to the existing chat-link set, and the pre-existing
  `liveChats.test.ts` case ("paused is neither chat nor start -- 9.6") already pins this
  behaviour; it is left green, not altered.
- risk: low

## Left to do
None -- Phase E's scope (home + compare-page entry points for paused and active plans) is
complete.

Status: DONE
Tool calls used: 38
