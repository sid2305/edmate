# Handoff 9.4b: chat markdown with react-markdown + remark-gfm

**Status:** DONE
**Branch:** `m9/9.4b-chat-markdown` (built on local `work-9.4b`, pushed to the task branch)
**Worktree:** `.claude/worktrees/agent-ac2647c64bbb5dace`

## Summary

`renderReply(text): ReactNode` now renders through `react-markdown` 10.1.0 + `remark-gfm` 4.0.1
(human answer B-32). The signature didn't change, so `MessageBubble.tsx` needed no edit. Every 9.4 XSS
invariant still holds:
- No raw-HTML plugin. react-markdown turns raw HTML into plain text nodes.
- There's an element allowlist. Elements outside it are unwrapped to their text.
- Images are never rendered.
- Links are real `<a>` elements only for absolute `http:`/`https:`/`mailto:` URLs.
`no-raw-html.test.ts` is unchanged and green.

## Files

- `apps/web/package.json`: added `react-markdown` 10.1.0 and `remark-gfm` 4.0.1 as runtime `dependencies` (exact pins).
- `pnpm-lock.yaml`: updated by `pnpm add`.
- `apps/web/src/chat/renderReply.tsx`: rewritten. It contains the `ALLOWED` element list, `safeHref` with the `SafeLink` component, the task-list `input` shown as text, the pre-wrap `p`, and `protectMath`, which keeps TeX literal.
- `apps/web/src/chat/renderReply.test.tsx`: extended from 19 to 54 cases, with all the old safety invariants kept.

## Tests (acceptance evidence)

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` → `Tasks: 34 successful, 34 total`
- `corepack pnpm vitest run` in apps/web → `Test Files 48 passed | 1 skipped (49)`, `Tests 767 passed | 4 skipped (771)`
- `vitest run src/chat/` → `Tests 84 passed (84)` (includes `no-raw-html.test.ts`, 3 cases, file unchanged)
- Coverage: web `All files` 98.4 / 98.24 / 96.05 / 99.15; `src/chat` 99.46 / 99.12 / 100 / 100 (at or above 9.4's numbers). Note: coverage `include` only covers `*.ts`, so `renderReply.tsx` isn't measured. Every `safeHref` branch has a direct test anyway: non-string input, a control char, a zero-width char, a malformed URL, a non-allowlisted protocol, and the allowed protocols.
- `python3 .githooks/secret-scan.py --all` → exit 0
- Red first: with the old renderer, 12 of the new cases failed (table, lists, bold/em, del, task list, links, images).

### Manual note: inputs tried and what they render as

All of these are asserted in `renderReply.test.tsx` under jsdom.

| Input | Renders as |
|---|---|
| `\| Step \| Result \|` + `\| :--- \| ---: \|` + rows | `<table><thead><th>…<tbody><tr><td>` (bold/code inside cells work) |
| `- one\n- two` / `1. first\n2. second` | `<ul><li>` / `<ol><li>` |
| `- [x] done\n- [ ] todo` | `<li>` with the text `[x] done` / `[ ] todo`, and no `<input>` |
| `**bold** and _em_` | `<strong>` / `<em>` |
| `~~wrong~~` | `<del>` |
| `l~o~op and ~one~` | literal text, no `<del>` (lead decision) |
| fenced code block | `<pre><code>` with the text kept exactly, plus CommonMark's trailing `\n` |
| `[docs](https://example.org/a?b=1)` | `<a href rel="noopener noreferrer" target="_blank">` |
| `[click](javascript:alert(1))`, `JaVaScRiPt:`, `jav&#x09;ascript:`, `data:`, `vbscript:`, `//host`, `/path`, `#top`, empty, reference to `javascript:` | the text `click` only, with no `href` anywhere |
| `![x](https://example.invalid/a.png)` (inline, reference, `javascript:` src) | nothing: no `<img>`, and neither the alt text nor the URL is shown |
| `<script>alert(1)</script>`, `<img src=x onerror=…>`, `<iframe>`, `<svg onload>`, `<style>`, `<object>`, `<form><input>`, `<meta refresh>`, `<!-- c -->` | literal escaped text, with no element, no `on*` attribute and no comment node |
| raw HTML inside a table cell | literal text inside the `<td>` |
| `# Title` | the text `Title`, with no `<h1>` |
| `$x_1 * y_2$`, `\(\frac{a}{b}\)`, `$$\n\sum_{i=1}^n i\n$$`, `\[a_b \cdot c_d\]` | literal TeX, with no emphasis and no backslashes lost |

## Deviations

- **Fenced code text has a trailing newline.** react-markdown follows CommonMark, which keeps the final newline of a code block (9.4 stripped it). Four old assertions now expect the `\n`. It doesn't show on screen.
- **TeX protection (`protectMath`).** Without it, markdown backslash escapes would turn `\(` into `(` and `\,` into `,`, and `_…_` inside TeX would become emphasis. That would break 9.4's "TeX stays literal" invariant, which the plan says to keep. `protectMath` backslash-escapes ASCII punctuation inside `$…$`, `$$…$$`, `\(…\)` and `\[…\]`, but only outside fenced and inline code. That is a display no-op apart from turning markdown off inside maths. Known limit: an indented (4-space) code block holding TeX would show the added backslashes. Fenced code is handled. It goes away when KaTeX arrives.
- **New exports.** `safeHref` and `protectMath` are exported from `renderReply.tsx` so they can be tested directly.

## Decisions

- **No ADR for adding react-markdown + remark-gfm.** The planner judged this a library choice inside the fixed Next.js/React stack (ADR 0001 fixes frameworks and infrastructure, not each UI utility), and the human already picked these exact libraries in B-32. Planner recommendation · risk: low.
- **remark-gfm `singleTilde: false`.** Only `~~x~~` is strikethrough. A single `~` stays literal, so `l~o~op` reads the same to the student and to the locked-content guard (4.6c lists in-word single `~` as a known miss). A test covers it. This overrides the plan's `singleTilde: true` recommendation. Decided by lead · risk: low.
- **Allowlist, not a denylist.** `allowedElements` = p, br, strong, em, del, code, pre, blockquote, hr, ul, ol, li, input, table, thead, tbody, tr, th, td, a, with `unwrapDisallowed`. Headings, footnote `section`/`sup` and anything else become their plain text. Headings weren't asked for, so they're left out. Builder · risk: low.
- **Images render not at all.** `img` isn't in the allowlist and has no children, so it disappears along with its alt text. The acceptance text allows "render as text or not at all". Builder · risk: low.
- **Links.** A real `<a>` only for absolute `http:`/`https:`/`mailto:` URLs, opened with `target="_blank" rel="noopener noreferrer"`. Control, format and whitespace characters are removed before the protocol check. Relative, fragment and protocol-relative links render as text. This sits on top of react-markdown's own `defaultUrlTransform`. Builder · risk: low.
- **Task-list checkboxes become the text `[x]` / `[ ]`**, not a read-only `<input>`. That keeps the old "no `input` element anywhere" invariant. Builder · risk: low.
- **Paragraphs keep `white-space: pre-wrap`** so single newlines in a reply stay visible, as in 9.4. Builder · risk: low.
- **TeX kept literal with `protectMath`** (see Deviations). Builder · risk: low.

## Follow-ups (for the lead)

- Optional: ask `security-reviewer` to look over `renderReply.tsx`, since it replaces the 4.6b-reviewed XSS boundary. No risk-path glob requires it.
- When 4.6c merges, check that its markdown "rendered" reading also treats only `~~` as strikethrough.
- The KaTeX task should remove `protectMath` and use remark-math/rehype-katex instead.
- The e2e `html-in-tokens` case in `apps/web/e2e/chat.spec.ts` should still pass: its joined text is an HTML block that react-markdown shows as literal text. It wasn't run here because e2e isn't in CI (9.7).
