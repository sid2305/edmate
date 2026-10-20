# 5.5 review — APPROVE

Reviewers: security-reviewer (opus), code-reviewer (sonnet), typescript-reviewer (sonnet)

All reviewers approve with no CRITICAL or HIGH findings, at head c0f21a2. security-reviewer probed the sandbox outside the repo with mathjs 15.2.0 on Node 22. Every escape attempt was refused before mathjs saw it: constructor and member access, calling a function as a value, hex and binary literals, newlines, `;`, `=`, `[`, `{`, quotes and Unicode lookalikes. No allowed input under 200 characters took more than about 3 ms. A 300k-case grammar fuzz left `Object.prototype` and `Function.prototype` unchanged. The calculator is offered only through 5.4's unchanged tool filter, to the coach skill. mathjs is pinned exactly, with a clean audit. typescript-reviewer confirmed the `create(all as FactoryFunctionMap)` cast is required under the strict tsconfig. It also confirmed that harness imports stay within the purity allow-list and that the fuzz test is deterministic and can fail. code-reviewer confirmed the tests drive the real tool loop and the real 5.4 filter.

## Findings
- [MEDIUM] [deferred 5.5a] packages/harness/src/tools/sandbox.ts:136 — implicit multiplication gets past the tokenizer whenever a space or `)` separates the terms: `1 e 2` returns 5.4366, not 100; `2 pi`, `sqrt(4)pi`, `(1)(2)(3)` and `sin(1)(2)` are also accepted. It is wrong arithmetic, not an escape. Refuse a number, constant or `)` followed (after spaces) by a number, name or `(`; add these to the rejection table and the fuzz attack corpus; fix the doc comment.
- [LOW] [deferred 5.5a] packages/harness/src/tools/sandbox.ts:44 — `gcd` and `lcm` give silently wrong answers above 2^53 (`gcd(2^1000,3)` returns 3). Drop both, or refuse arguments above `Number.MAX_SAFE_INTEGER`.
