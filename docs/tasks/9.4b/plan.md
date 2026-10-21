# Plan 9.4b: chat markdown with react-markdown + remark-gfm

## Spec

Board (`docs/board/tasks.yaml`, id `9.4b`, milestone M9, deps `9.4`, status `todo`):
> Chat markdown with react-markdown + remark-gfm (human answer B-32): allowlisted elements only, no
> raw HTML, no images, links safe; replaces the small renderer from 9.4; maths later with KaTeX.

**Acceptance (verbatim):** lists, bold, tables and code render; raw HTML and images in a reply
render as text or not at all; no-raw-html test still passes.

**How it will be shown:** green `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...`,
with `apps/web/src/chat/renderReply.test.tsx` (updated) and `apps/web/src/chat/no-raw-html.test.ts`
(unchanged, still green) in the run; a short manual note in the handoff listing the exact markdown
inputs tried (a table, a bulleted list, `**bold**`, a fenced code block, a safe `https://` link, an
unsafe `javascript:` link, a `![x](...)` image, a raw `<script>`/`<img onerror>`/`<iframe>`) and
what each renders as.

## What 9.4 built (read first)

`apps/web/src/chat/renderReply.tsx` is a hand-rolled, no-dependency renderer (9.4 Phase B): splits
text into paragraph/fenced-code blocks by hand, inline `` `code` `` by a regex split, and returns
only `<p>`/`<pre><code>`/`<code>`/plain-text React nodes — no links, no images, no raw HTML, TeX
left literal. Its own comment says this interface (`renderReply(text): ReactNode`) was written so
"a markdown library (plan Q1) can be swapped in later under the same tests" — this task is that
swap. `MessageBubble.tsx` already wraps the call in `<div className="bubble-text">{renderReply(text)}</div>`
(9.4 Phase C's note: "wrap it in a `<div>`, not a `<p>`"), so no caller change is needed.
`renderReply.test.tsx` (19 cases) and `no-raw-html.test.ts` (3 cases, a source scan banning
`dangerouslySetInnerHTML`, `inner/outerHTML`, `insertAdjacentHTML` and `rehype-raw` under
`src/chat`, `app/learn`, `app/teacher`, `src/studio`) are both 9.4's XSS-safety backstop
(4.6b safety review) and must stay green. 9.4's handoff (`docs/tasks/9.4/handoff.md`, Follow-ups)
lists "Markdown library (Q1): still open with the human" — B-32 closes it.

## Files to create/modify

- `apps/web/package.json` — add `react-markdown` and `remark-gfm` to `dependencies` (runtime,
  shipped in the chat bundle, not devDependencies).
- `pnpm-lock.yaml` (repo root) — updated by `pnpm install`.
- `apps/web/src/chat/renderReply.tsx` — rewritten: `renderReply(text): ReactNode` now renders
  `<ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: ... }]]} components={{...}} disallowedElements={['img']} unwrapDisallowed>{text}</ReactMarkdown>`
  (exact props confirmed by the tests below — see Open questions on the one option that needs a
  decision). Keep the same exported signature and the same file-level comment style explaining what
  is and isn't supported.
- `apps/web/src/chat/renderReply.test.tsx` — rewritten/extended. Keep every safety invariant from
  the current 19 cases (no `script`/`img`/`iframe`/`object`/`embed`/`svg`/`style`/`link`/`meta`/
  `form`/`input`/`video`/`audio` element anywhere, no `on*` attribute, no unsafe `href`, no HTML
  comment nodes, streamed/split tags stay inert, TeX stays literal, empty text renders nothing,
  `[message withheld: guard_blocked]` renders as plain text) and add the new accept-criteria cases:
  a GFM table, a bulleted and a numbered list, `**bold**`/`_em_`, a fenced code block (unchanged
  behaviour), a safe `https://` link (renders as `<a href>`, safe `rel`), an unsafe link
  (`javascript:`, `data:`) (renders with no `href`/the link stripped to text), and the strikethrough
  case the lockedMatch note below asks for.
- No change expected to `apps/web/src/chat/no-raw-html.test.ts` (it already bans `rehype-raw`,
  which this task must not add) or to `MessageBubble.tsx`, `ChatView.tsx`, `sendTurn.ts`,
  `turnState.ts`, `sse.ts`, `loadChat.ts` or any API route.
- `docs/tasks/9.4b/handoff.md` (written by the builder, not here).

## Files out of bounds

Everything under `apps/web` other than the five files above, all of `packages/*`, `apps/cli`,
`apps/worker`, `content/**`, `evals/**`. No contracts change, no prompt-pack change, no
`src/auth/**` or `src/turn/**` edit, no new API route, no `.github/**`/`.claude/**` edit.

## Tests first (red → green)

1. Run the current suite once to confirm the baseline is green, then edit
   `renderReply.test.tsx` to the new expected behaviour (some old assertions, e.g. "a markdown
   image shows literally" with the exact source text as `textContent`, must change to match the
   accept criterion's looser wording "render as text or not at all" — react-markdown's default
   handling of raw inline HTML and of disallowed `img` nodes may strip the node rather than leave
   its literal source text visible; the test should assert the *safety* invariants, not a specific
   "literal source text" outcome, unless the builder confirms react-markdown does show it literally).
2. Add the new cases (table, lists, bold, safe link, unsafe link, strikethrough) — red first
   (current hand-rolled renderer doesn't support them).
3. Implement the react-markdown version until all of `renderReply.test.tsx` and
   `no-raw-html.test.ts` are green.
4. `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` green; coverage floor
   held (web is currently ~98%; `src/chat` ~99%). `python3 .githooks/secret-scan.py --all` clean.

## Design decisions the builder must make and log (not open questions — defaults given)

- **`img`**: disallow entirely (`disallowedElements={['img']}` or `components={{ img: () => null }}`)
  — the accept criterion is "no images", so no `<img>` element, whichever way react-markdown's
  default handles the stripped node's surrounding text.
- **`a` (links)**: a custom `components.a` that parses the `href` and only renders a real `<a>`
  (with `rel="noopener noreferrer" target="_blank"`) for `http:`, `https:` and `mailto:`; any other
  protocol (`javascript:`, `data:`, `vbscript:`, a bare `//`, or no recognisable protocol) renders
  the link text only, with no `href` attribute anywhere in the output. This keeps
  `renderReply.test.tsx`'s existing "no element anywhere has an `href` attribute" style assertion
  true for every *unsafe* link, while allowing it for safe ones (the assertion needs splitting into
  two cases).
- **Raw HTML** (`<script>`, `<img onerror>`, `<iframe>`, `<svg onload>`, an HTML comment): do not
  add `rehype-raw` (the no-raw-html scan already bans it, and skipping it is what keeps raw HTML
  inert — react-markdown's own README calls this its default XSS-safe behaviour). Confirm via the
  existing test cases whether the result is literal escaped text or a dropped node; either is
  accepted by this task's acceptance text, but keep the current test's naming/comment accurate to
  whichever it is.
- **Allowed elements**: paragraphs, headings are **not** requested by the accept criteria — keep
  scope to what's asked (paragraphs, emphasis/strong, lists (ordered/unordered, incl. GFM task
  list checkboxes read-only), tables (`table`/`thead`/`tbody`/`tr`/`th`/`td`), code (fenced +
  inline), blockquote, links, strikethrough (`del`), horizontal rule). No headings, no embeds
  beyond that. If a human-approved spec implies headings are wanted, log it as a decision rather
  than guessing silently.

## Open question: remark-gfm's `singleTilde` vs lockedMatch's rendered reading (4.6c)

`packages/harness/src/guardrails/lockedMatch.ts` tokenises on `[\p{L}\p{M}\p{N}_]+`, so `~`/`~~`/`**`/
backtick are already non-token characters today — but task **4.6c** (`m4/4.6c-lockedleak-followups`,
board status `review`, not yet merged, no `docs/tasks/4.6c/` written) is adding a markdown
"rendered" reading (mirroring `foldMarkup`'s HTML `rendered` reading) that pads *markdown* emphasis
runs so `l**o**op` folds to `loop` instead of `lo`/`o`/`p` (the known-miss the 4.6c title names:
"markdown emphasis inside words (`l**o**op`, `~~`, backticks) padded in the rendered reading"). If
that reading's parser disagrees with what the student's UI actually renders as strikethrough
(single `~word~` vs. double `~~word~~`), the leak guard's assumption about what counts as "markdown
formatting" (padded away) vs. "literal text" (kept as tokens) stops matching what 9.4b's GFM
renderer actually treats as strikethrough syntax — the two should agree on where token boundaries
fall.

- **Recommendation:** use remark-gfm's default (`singleTilde: true` — matches github.com's actual,
  more permissive behaviour, which is also the GFM parser default), and record it as a decision in
  `docs/tasks/9.4b/handoff.md` rather than leaving it implicit.
- Because 4.6c isn't merged yet, the two tasks could land with mismatched assumptions. This isn't a
  reason to block 9.4b (4.6c is a backstop refinement to an already-conservative guard, not a
  prerequisite — 9.4b's own tests don't depend on lockedMatch at all), but the lead should either
  sequence 4.6c before/alongside 9.4b's merge, or add a short follow-up decision once both are in
  reconciling the two (confirm 4.6c's markdown-rendered reading treats single-tilde the same way
  remark-gfm's `singleTilde: true` does). Flagging this in `.claude/blockers.md` per
  CLAUDE.local.md is not needed now (no one is actually blocked — both tasks can proceed in
  parallel); it's listed here so the lead can check it when reviewing 4.6c's PR or before signing
  off the M9 chat slice as done.

## Question: does adding `react-markdown` + `remark-gfm` need an ADR?

CLAUDE.md rule 2 says `packages/contracts`, the tech stack and prompt-pack behaviour change only
with an ADR reviewed by `architect`, `security-reviewer` and `typescript-reviewer`. I read
`docs/adr/0001-tech-stack.md`: it fixes frameworks/infra/ORM/queue/auth-library-level choices (one
per concern), not every individual UI utility library within an already-chosen framework (e.g.
`@playwright/test` was added to `apps/web/package.json` in 9.4 Phase D with no ADR).

**My recommendation: no ADR needed.** This is a library choice inside the already-fixed Next.js/
React stack, not a new category of infrastructure, and the human already made the choice directly
(board's human answer B-32 names the exact library pair) — that already satisfies "ask, don't
guess" (rule 7) for the one open decision (Q1) 9.4's handoff flagged. The builder should still log
it as a `## Decisions` entry in the handoff (citing B-32), `risk: low`, not `risk: high`, and not
open a `docs/adr/` file. Given this replaces a safety-reviewed XSS boundary (4.6b), I recommend the
lead optionally ask `security-reviewer` to glance at the diff even though no risk-paths.txt glob
requires it (see below) — a recommendation, not a gate requirement.

## Risky paths touched

Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
- `apps/web/package.json`, `apps/web/src/chat/renderReply.tsx`,
  `apps/web/src/chat/renderReply.test.tsx`, `pnpm-lock.yaml`, `docs/tasks/9.4b/**` — none match any
  glob in risk-paths.txt (not under `packages/harness/src/guardrails/**`,
  `packages/harness/src/pedagogy/**`, `packages/harness/src/access/**`, `packages/payments/**`,
  `apps/web/app/api/**`, `apps/web/src/auth/**`, `packages/db/**`, `packages/gateway/src/keys/**`,
  `packages/contracts/**`, `docs/adr/**`, `.claude/**`, `.github/**`, `.githooks/**`).
- **None (checked against risk-paths.txt).** No `risk: high` decision entry is required by the
  gate; the handoff should still log the library choice and the `singleTilde` choice at `risk: low`
  per usual practice.

## Size

One phase. Five files touched (two new deps in one `package.json`, one lockfile, one rewritten
source file, one rewritten test file) plus the handoff — well under the ~8-file/one-package
threshold. Estimated well under 60 builder tool calls (read 9.4's renderer/tests once, install the
two deps, TDD the test file, implement, run typecheck/lint/test/coverage/secret-scan, write the
handoff).

## Testing strategy

- Unit tests only (`renderReply.test.tsx`, unchanged `no-raw-html.test.ts`); no new e2e needed —
  `apps/web/e2e/chat.spec.ts`'s existing "html-in-tokens" case already exercises `renderReply`
  end-to-end and must stay green (manual/local run, not in CI yet per 9.4's Phase D note — don't
  wire CI here, that's 9.7).
- Coverage floor: keep `src/chat` at or above 9.4's current numbers (99.34/98.87/100/100 statements
  /branches/functions/lines, per the 9.4 handoff); react-markdown/remark-gfm are third-party code so
  they don't count against `src/chat`'s own coverage, but every branch in the new `components.a`
  sanitiser must be covered (safe protocol, each unsafe protocol, malformed URL).

## Risks & mitigations

- **Risk:** react-markdown's exact default handling of raw inline HTML (shown as literal text vs.
  silently dropped) is not something I can confirm without running the library.
  **Mitigation:** tests-first; let the real library's behaviour decide the exact assertion, as long
  as the safety invariant (no dangerous element, no dangerous attribute) holds either way, which the
  accept text already allows ("render as text or not at all").
- **Risk:** a permissive link sanitiser could still be bypassed by whitespace/case tricks in the
  protocol (e.g. `JaVaScRiPt:`, `java\tscript:`).
  **Mitigation:** normalise (trim, strip control/format characters, lower-case) before checking the
  protocol allowlist; add a test case for at least one such trick.
- **Risk:** the 4.6c/remark-gfm `singleTilde` mismatch (above) — not a build risk for 9.4b itself,
  but a cross-task consistency risk for the guard. **Mitigation:** documented above for the lead;
  not blocking.

## Success criteria

- [ ] `react-markdown` + `remark-gfm` are runtime dependencies of `@edmate/web`.
- [ ] Lists, bold/emphasis, GFM tables and fenced/inline code render as real elements.
- [ ] Raw HTML (`script`, `img onerror`, `iframe`, `svg onload`, HTML comments) never produces a
      live/dangerous element or attribute.
- [ ] Markdown images (`![x](...)`) never produce an `<img>` element.
- [ ] Links render only for `http:`/`https:`/`mailto:`; every other protocol is stripped to text.
- [ ] `no-raw-html.test.ts` passes unchanged (no `rehype-raw`, no `dangerouslySetInnerHTML`, no
      `inner/outerHTML`, no `insertAdjacentHTML`).
- [ ] `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` green; secret scan clean.
- [ ] Handoff logs: the B-32/no-ADR decision, the `img`/link/raw-HTML allowlist choices, and the
      `singleTilde` choice with the 4.6c coordination note.
