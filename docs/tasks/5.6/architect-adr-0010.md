## 1. ADR draft (file: docs/adr/0010-practice-items-from-tool.md. 0009 is already taken by 3.11d, which is in review; check 0010 is still free at build time)

```markdown
# ADR-0010: Practice items come only from `practice.next_item`; their answer keys stay on the server

## Status

Proposed

## Date

2026-10-20

## Context

Task 5.6 must show "items map to the outline's topics; answer keys never reach the client". `practice@1.0.0` (signed off, pinned by `set@1.0.0.yaml`) tells the model to write a new item when the bank has none. The harness never knows the answer to an item the model wrote, so `mustNotReveal`, the stream gate and postGuard cannot protect it. It leaks by construction (5.6 plan, Decision 2). `HelpState.answerKey` (ADR-0005) was reserved for 5.6, but nothing sets it: `decide` builds `next` before generate's tool loop runs, and the item only exists inside that loop. Prompt-pack behaviour changes need an ADR (CLAUDE.md non-negotiable 2).

## Decision

1. **Pack `practice@1.1.0`.** Every new item, including a transfer question, comes from `practice.next_item`. The model never writes an item, question or answer, and never sets a question from retrieved material. It shows the item exactly as returned. If there is no item, the call fails or the tool isn't offered, it says no item is ready and makes up nothing. Before an attempt it never reveals or solves the item, never rules out MCQ options and never traces code-output items. It calls the tool with no topic and no item ids. The named human signs it off (B-26) before merge.
2. **Set.** Add `set@1.1.0.yaml` with practice 1.1.0 and every other pack unchanged. `set@1.0.0.yaml` stays byte-for-byte the same, because traced turns name it. The demo seed (`PROMPT_PACK_VERSION`, packages/db/src/seed.ts) and test fixtures move to 1.1.0.
3. **Tool (harness-internal; contracts `Tool<I,O>` unchanged).**
   - Input is a strict `{ level?: 1|2|3 }`. The model never chooses a topic or an item id.
   - `run` reads only `ctx.entitlement` (teacherId, allowedModuleIds). The module comes from this turn's retrieved chunks, else the active item's module, else the first allowed module. The bank picks the topic and leaves out item ids already served (kept in HelpState).
   - The model-visible output is `{ id, kind, level, prompt, options? }`. The answer key is never in the tool output, the `skill` event or the trace. The harness looks it up by item id through a harness-internal `RegisteredTool` hook. Generated item ids are deterministic, so the key can be recomputed.
4. **Saving the key.**
   - As soon as the key is known, it is added to this turn's stream gate and to postGuard.
   - Every item whose `skill` event was emitted adds its key to `GenerateResult.practiceAnswerKey` (several items: the union).
   - The runner writes that into `next.help.answerKey` on every outcome where the event went out. It also resets the per-problem ladder fields (rung 0, stuckTurns 0, attemptLogged false, pendingCheck false) and records the item id.
   - From there: `CommitRecord.next`, then `sessions.help_state`, then the next turn's `decide`, then `mustNotReveal`.
5. **No solution rung for practice items.** `SKILL_CAP.practice = 3` stays. While the help state holds a practice item's key, the ladder uses the practice cap whatever skill the turn selected.
6. **No `packages/contracts` change.** `PedagogyDecision`, `TurnContext` and `TurnEvent` are untouched. The new HelpState fields are optional, so a blob saved before this parses unchanged.

## Alternatives

- **Keep model-written items and pull the key out of the reply.** Not chosen: the harness can't verify the key, and the item has already streamed before the key is known.
- **Put the active item on `PedagogyDecision` or `TurnContext`.** Not chosen: it needs a contracts change and carries the key on types that reach the model and the client.
- **`decide` picks the item before generate and compose shows it.** In-turn protection would be trivial, but item choice would move into policy and the item text into a new compose slot. Revisit if tool calls prove unreliable with real models.
- **Put the key in the tool result and trust the pack.** Not chosen: the key would be in the model's context on the turn it matters most.
- **Edit `set@1.0.0` in place.** Not chosen: it breaks replay of traces that recorded set 1.0.0.

## Consequences

- A topic with no bank item and no generator template shows "no item ready". Bank coverage becomes content work (5.11, 8.x).
- On later turns the model sees the key in the do-not-say block (compose.ts:220, the 3.6 design). "Never model-visible" holds only for the turn that issues the item. The client never sees the key.
- An MCQ key that is a bare label ("B") makes the gate trip whenever the options are shown again, and fails any later MCQ tool output (`answer_key`). A code-output key appears in its own prompt. Both kinds stay out of the served bank until the matcher has an answer-context-only key mode (follow-up task).
- If a new item's prompt contains the previous key, the call fails closed and the student sees "no item ready".
- Updates and re-runs: the content snapshot, seed drift for databases already seeded, and the pedagogy, leak and locked eval suites.
- Changing any of this takes a new pack version, a new set and an ADR that supersedes this one.

## Reviewers

architect, security-reviewer, typescript-reviewer; named human sign-off for the pack (B-26). Logged risk: high.
```

## 2. Q-A to Q-D and the Decision 1 verdict

- **Q-A `topicId`: the harness fills it; the model passes no ids.** Module: this turn's top retrieved chunk, which `TurnContextSchema` has already checked against the entitlement; else the active item's module; else the first allowed module. Topic: the bank picks it (lowest `profile.mastery`). Exclude list: item ids kept in HelpState. A model-passed label would need fuzzy matching and opens an injection path. The model also never sees item ids on later turns, so drop the draft's "pass ids in exclude" and "ask it for the topic" lines.
- **Q-B solution rung: never give a practice item's final answer, and never put the key in context.** For skill `practice`, `solution` already can't be reached (ladder.ts:12, cap 3). The real gap: a free-text follow-up with no `turn.skill` picks coach (skills.ts:44, cap 4). With `finalAnswers: allowed` that reaches `solution`, policy.ts:133 empties `mustNotReveal`, and the model solves the item itself. Fix it in 5.6 Phase C: apply the practice cap while a practice key is held.
- **Q-C question-bank answers: not a live leak.**
  - `chunk_kind` is material, transcript or teacher_note. seed.ts inserts no documents or chunks. The recall corpus chunks only `modules/*/notes.md`. `question-bank/` and `rubric-answers/` are read only by @edmate/content.
  - Latent paths: future bank ingestion (5.11, 8.x), worksheets with answers uploaded as `material`, and teacher corrections stored as teacher_note chunks.
  - Smallest fix: buildContext drops (and reports) any retrieved chunk where `revealsAnswerKey(chunk.text, help.answerKey)` is true, plus an ingest rule that the bank is never chunked.
  - Make it a separate task (5.6a, before 5.11), not part of 5.6.
- **Q-D MCQ ban: keep it.** Ruling an option out gives away part of the answer, and the key matcher can't see it. Two eliminations out of four options leave a coin flip, and practice never climbs past rung 3, so there is no later rung to relax it at. Allow only nudges that name no option ("check each option against the rule").
- **Decision 1: approved, with five conditions.** None of them needs a `packages/contracts` change: `Tool<I,O>` covers the tool, and RegisteredTool, HelpState (an opaque blob under ADR-0005), GenerateResult and CommitRecord are all harness-internal.
  - [CRITICAL] packages/harness/src/pipeline/generate/toolLoop.ts:229 — the model gets the checked tool output exactly as returned, so the plan's output schema with `answerKey` shows it the key. Fix: keep the key out of the output and look it up server-side by item id through a harness hook.
  - [HIGH] packages/harness/src/pipeline/steps/generate.ts:123 — on the turn that issues the item, the gate and postGuard check only the old key list, so a model that works out an arithmetic answer leaks it. Fix: add the new key to both as soon as the tool returns.
  - [HIGH] docs/tasks/5.6/plan.md:82 — `PracticeBank.pick` reads with no teacher or module scope, but RegisteredTool requires reads scoped to `ctx.entitlement`. Fix: pass and enforce teacherId and allowedModuleIds.
  - [MEDIUM] docs/tasks/5.6/plan.md:53 — the key is saved only on `replied`, but the item's `skill` event may already have reached the client on other outcomes. Fix: save on every outcome where the event went out, take the union for several items, and reset the per-problem ladder fields.
  - [MEDIUM] docs/tasks/5.6/plan.md:80 — a bare MCQ label key, or a code-output key that appears in its own prompt, trips the gate whenever the item is shown again. Fix: keep both kinds out of the served bank for now.