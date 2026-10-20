---
reviewed_by: pending
---
# practice@1.0.0 -> practice@1.1.0 (task 5.6 Phase D, draft, revised per ADR-0010)

Semver: minor bump (1.0.0 -> 1.1.0). This changes how items are delivered, not how the agent teaches. The one teaching change is that practice never gives the final answer (item 5).

## Why
1.0.0 told the model to write a new item itself when the bank had none. The harness never knows the answer to an item the model wrote, so `mustNotReveal`, the stream gate and the post-guard can't protect it: it leaks by design (plan Decision 2). In 1.1.0 the harness picks or generates every item through `practice.next_item` and keeps its answer key on the server.

## What changed
1. Replaced: "use the question bank first; write a new item only when none fits" now reads "call `practice.next_item` for every new item, including a transfer question." The model sends no topic and no item ids; the harness fills them in. The only input is an optional `level` (1, 2 or 3), which the model may leave out. The tool does the bank-first choice.
2. Added: never write an item, question or answer yourself, and never set a question taken from the retrieved material, including the teacher's question bank, as an item.
3. Added: show the item exactly as returned (MCQ options with their labels, in the order given), with no hint, tip or first step added.
4. Added: when the tool returns no item or an error, or isn't offered, say no item is ready, offer help the decision allows, and never invent or describe a replacement.
5. Changed (ADR-0010): never give the final answer to a practice item at any rung, before or after an attempt. Practice stops at rung 3, and the key is never in the model's context on the turn the item is issued. Wording for insistent requests is taken from coach@1.0.0.
6. Added, MCQ: never show which option is right or wrong, and never rule an option in or out, at any rung. Only nudges that name no option are allowed ("check each option against the rule"). "Is it B?" is handled as a bare answer.
7. Added, `code_output`: show the code exactly as given. Never run, trace or predict the item's code, or say its output, whether it fails, or variable values. A worked example uses different code. Text the item itself shows is allowed (the 19 Oct exception).

## Dormant for now
The MCQ (6) and `code_output` (7) rules are dormant: the harness serves only numeric and arithmetic items for now (lead's answer to Q1). The wording is kept so those kinds can be turned on without another pack change, but it can't be tested end to end until they are served.

## Not changed
Wait for the answer, specific praise, asking how they got a bare answer, help only at the decision's rung, never the answer, short replies, and the `[[SKILL:practice]]` marker.

## Before merge
- ADR-0010: reviewed by architect, security-reviewer and typescript-reviewer, logged `risk: high`.
- Named human sign-off replaces `reviewed_by: pending` (B-26).
- Bump the set manifest (`set@1.0.0.yaml` pins `practice: 1.0.0`) so 1.1.0 is actually loaded.
- Re-run the pedagogy, leak and locked eval suites.
