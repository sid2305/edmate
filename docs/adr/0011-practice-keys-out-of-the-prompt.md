# ADR-0011: Practice keys stay out of the model's prompt; the stream gate and postGuard alone guard them

## Status

Proposed. Amends ADR-0010 (Consequences bullet 2, and §4's last link: "then `mustNotReveal`" now means the guards, not the prompt).

## Date

2026-10-20

## Context

ADR-0010 keeps a practice item's answer key on the server. On the turn that issues the item, the model never sees the key. On every later turn, though, the composer renders `mustNotReveal` into the model's do-not-say block (compose.ts, the 3.6 design), so the raw key is in the system prompt. The answer matcher (pipeline/generate/answerKey.ts) can miss a key the model spells out ("s-e-v-e-n") or writes another way ("VII"). A prompt injection that asks the model to spell its do-not-say list could then get the key past the stream gate and postGuard. This was raised in the 5.6 review (security-reviewer, MEDIUM compose.ts:220), and ADR-0010 Consequences bullet 2 names this follow-up.

A second gap (5.6 review, LOW runner.ts:1135): when a new item replaces one the student never solved, the runner overwrites `HelpState.answerKey` with the new item's keys. On the next turn the skipped item's answer is not guarded at all.

Task 5.6c acceptance: "no practice key text appears in any model request". Prompt-pack behaviour changes need an ADR (CLAUDE.md non-negotiable 2). The pack files do not change here, but what the composer puts in the prompt on practice turns does.

## Decision

1. **The prompt gets `promptKeys`; the guards get `mustNotReveal`.** `PolicyResult` gains `promptKeys: string[]`. The composer renders the do-not-say block from `promptKeys` only, and never reads `mustNotReveal`. `promptKeys` is always a subset of `mustNotReveal`. It is empty whenever the help state holds a practice key (`holdsPracticeKey`) or a carried key. Otherwise it is `mustNotReveal` minus any carried key. `decide` still copies the full `mustNotReveal` into `PedagogyDecision`. The stream gate, postGuard (answerLeak and grounding), the skill-event and tool-output checks, and the practice tool's held-keys check read only that full list. No guard reads `promptKeys`.
2. **A skipped item's key is carried for one turn.** `HelpState` gains an optional `practiceCarriedKey: string[]` (at most 64 entries). The runner alone sets it, and only on a turn that issues an item while the loaded state holds a practice key. Its value is the loaded `answerKey` minus this turn's issued keys, and the field is left out when that is empty. Every other saved state leaves it out. `answerKey` holds only the new items' keys, so attempt grading (`classifyAttempt`) sees only the active item. The JSON of `answerKey` plus `practiceCarriedKey` stays within `PRACTICE_KEYS_MAX_JSON`, and the practice tool's cap counts held keys, so the saved state always fits.
3. **A carried key is guarded and never released.** `decidePolicy` (every move, including `solution`) and `fallbackPolicy` (both its branches, distress included) put the carried key into `mustNotReveal`. A carried key is never in `promptKeys`, and `classifyAttempt` and `holdsPracticeKey` never read it. On the turn it is carried, buildContext drops retrieved chunks that hold it, using the same rule and the same short-number exemption as `answerKey` (5.6a).
4. **Other answer keys keep the 3.6 behaviour.** A non-practice key is still rendered in the do-not-say block on teaching turns. No current path sets one, so in practice the block no longer appears.
5. **Scope of "no practice key in any model request".** The harness never supplies a practice key or a carried key as text in any model request on any tier (main, fallback, small rewrite and judge, classifier): not in the system prompt, the messages, the tools or retrieved material. Three things are out of scope:
   - the student's own message, which is the student's text and not something the harness supplies;
   - the small-tier rewrite of a draft in which the model itself wrote the key. answerLeak sends that draft to its one bounded rewrite, and the rewrite's instruction names no key. Closing this means answerLeak skips the rewrite while a practice key is held, which is a `guardrails/**` change for a later task;
   - retrieved chunks holding a short whole-number key (1–2 digits, or the same number in words), which 5.6a's lead answer lets through to the model on purpose.
6. **What the builder must meet.**
   - Practice keys and carried keys are never rendered. A runner test with the real `decide` step and the fixture packs captures every request on every tier and finds no issued, held or carried key in any of them. The test uses student text and chunks without the key.
   - The guards are unchanged. When the scripted model writes a held or carried key, the student gets the safe hint.
   - `copyHelp` keeps the field, and decide's paths return `copyHelp(help)`. So the runner removes `practiceCarriedKey` explicitly on every saved state that is not the issuing turn, including the issuing branch's `...base.help`. It must not rely on `practiceFields` leaving the field out.
   - A turn that saves no state leaves the stored carried key in place. This fails closed: the key is guarded for longer, never shorter.
   - `parseSessionHelp` keeps the field. A blob saved before this change still parses. The "every practice limit" state, now with a carried key, still serialises.
   - The compose snapshot for a non-practice key is unchanged.
7. **No contracts, pack or set change.** `PedagogyDecision.mustNotReveal`, `TurnContext` and `TurnEvent` are untouched. `practice@1.1.0`, `frame@1.0.0`, `safety@1.0.0` and `set@1.1.0` stay byte-for-byte the same.

## Alternatives

- **Drop the do-not-say block for every key.** Not chosen: it changes the 3.6 behaviour for non-practice keys with no current need. Revisit when another source of `answerKey` is added.
- **Merge the carried key into `answerKey`.** Not chosen: `classifyAttempt` needs every key part to match, so the student's answer to the new item would grade wrong.
- **Hash or mask the keys in the prompt.** Not chosen: a list the model cannot read does not help it avoid the answer, and it still hands an injection something to echo.
- **A new pack version and set.** Not chosen: the pack text is unchanged, and every turn's composed `systemPrompt` is stored on its decision, so replay does not depend on composing the prompt again.
- **Carry a skipped key for the rest of the session.** Not chosen: it adds to the held keys turn after turn (gate false positives, more items refused by validateItem) for little gain. One turn covers the immediate "what was the answer to the last one?" request.

## Consequences

- On practice turns the model is no longer told the answer it must not give. Against a direct leak it relies on the pack rules (it was never told the key on the issuing turn either), and the client relies on the stream gate and postGuard. An injection can no longer read the key out of the prompt.
- The model coaches without the key. The harness grades attempts, and the policy picks the move, so correct and wrong attempts are still told apart. The model's hints for an item whose answer it cannot work out itself may be weaker. Pedagogy evals measure this; it is not a safety gap.
- A model that works out an answer and spells it is still a matcher gap (5.6b). This ADR removes the prompt as a source of the key; it does not widen the matcher.
- A skipped item's key is guarded for one more turn. If that turn saves no state, it is guarded until a later turn saves one.
- The safety and frame packs still mention "the do-not-say list". When the list is absent those lines do nothing. The jailbreak eval cases that check `[[DO-NOT-SAY]]` is never echoed still hold.
- Replaying a `set@1.1.0` turn recorded before this change would compose a different prompt. The recorded `systemPrompt` is the source of truth.
- Rolling the code back past this change makes a stored help state that holds `practiceCarriedKey` unreadable to the older strict schema. That session then fails closed (no material, held replies, see 4.6b) until a state is saved again. Before rolling back, clear the field or accept that cost.
- Changing which keys reach the prompt, or how long a key is carried, takes a new ADR that amends or supersedes this one.

## Reviewers

architect, security-reviewer, typescript-reviewer. The lead approves it and logs it risk: high.
