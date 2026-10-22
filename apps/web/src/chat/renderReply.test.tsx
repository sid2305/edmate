// @vitest-environment jsdom
// Task 9.4 Phase B / 9.4b: the reply renderer never renders raw model HTML (4.6b safety review).
// Raw HTML in the text shows literally as text (react-markdown with no raw-HTML plugin); markdown images
// render not at all; links only for http/https/mailto; TeX stays literal (KaTeX is parked).
// 9.4b swapped in react-markdown + remark-gfm (B-32) under these tests.
import type { TurnEvent } from '@edmate/contracts';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { protectMath, renderReply, safeHref } from './renderReply';
import { initialTurn, reduceTurn } from './turnState';

function show(text: string): HTMLElement {
  const { container } = render(<div>{renderReply(text)}</div>);
  return container.firstElementChild as HTMLElement;
}

const DANGEROUS = 'script, img, iframe, a, object, embed, svg, style, link, meta, form, input, video, audio';

function commentCount(root: Node): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  let n = 0;
  while (walker.nextNode()) n++;
  return n;
}

function assertInert(el: HTMLElement): void {
  expect(el.querySelector(DANGEROUS)).toBeNull();
  expect(commentCount(el)).toBe(0);
  for (const node of el.querySelectorAll('*')) {
    for (const attr of node.getAttributeNames()) {
      expect(attr.startsWith('on'), `${node.tagName} has ${attr}`).toBe(false);
      expect(attr).not.toBe('href');
      expect(attr).not.toBe('src');
    }
  }
}

describe('renderReply', () => {
  it.each([
    ['a script tag', '<script>alert(1)</script>'],
    ['an img with onerror', '<img src=x onerror="alert(1)">'],
    ['a javascript: link', '<a href="javascript:alert(1)">click</a>'],
    ['an iframe', '<iframe src="https://example.invalid"></iframe>'],
    ['an HTML comment', 'before <!-- hidden --> after'],
    ['an svg with onload', '<svg onload="alert(1)"><circle/></svg>'],
    ['a style tag', '<style>body{display:none}</style>'],
    ['an object tag', '<object data="x.swf"></object>'],
    ['a form with an input', '<form action="/x"><input name="a"></form>'],
    ['a meta refresh', '<meta http-equiv="refresh" content="0;url=https://example.invalid">'],
  ])('%s shows literally and makes no element', (_name, text) => {
    const el = show(text);
    assertInert(el);
    expect(el.textContent).toContain(text);
  });

  it.each([
    ['inline', 'See ![x](https://example.invalid/a.png) here'],
    ['reference style', 'See ![x][r] here\n\n[r]: https://example.invalid/a.png'],
    ['javascript src', '![x](javascript:alert(1))'],
  ])('a markdown image (%s) renders not at all', (_name, text) => {
    const el = show(text);
    assertInert(el);
    expect(el.textContent).not.toContain('example.invalid');
  });

  it('raw HTML inside a markdown table cell stays text', () => {
    const el = show('| a | b |\n| - | - |\n| <img src=x onerror=alert(1)> | <script>x</script> |');
    assertInert(el);
    expect(el.querySelectorAll('td')[0]?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('a tag split across tokens shows literally once the turn joins them', () => {
    const tokens = ['Look: <scr', 'ipt>alert(1)</scr', 'ipt> and <im', 'g src=x onerror=alert(1)>'];
    const turn = tokens.reduce(
      (t, text) => reduceTurn(t, { kind: 'event', event: { type: 'token', text } satisfies TurnEvent }),
      initialTurn(),
    );
    const el = show(turn.text);
    assertInert(el);
    expect(el.textContent).toContain('<script>alert(1)</script>');
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('HTML inside a fenced code block stays text', () => {
    const el = show('```html\n<script>alert(1)</script>\n```');
    assertInert(el);
    expect(el.querySelector('pre > code')?.textContent).toBe('<script>alert(1)</script>\n');
  });

  // react-markdown keeps the code block's final newline (CommonMark), unlike 9.4's renderer.
  it('a fenced code block becomes <pre><code> with its text kept exactly', () => {
    const el = show('Try this:\n\n```ts\nconst x = 1;\n  if (x) {}\n```\n\nThen run it.');
    const code = el.querySelector('pre > code');
    expect(code?.textContent).toBe('const x = 1;\n  if (x) {}\n');
    expect(el.querySelectorAll('p')).toHaveLength(2);
    expect(el.querySelectorAll('p')[0]?.textContent).toBe('Try this:');
    expect(el.querySelectorAll('p')[1]?.textContent).toBe('Then run it.');
  });

  it('an unclosed fence (still streaming) renders the rest as code', () => {
    const el = show('Code:\n```\nlet a = 2;');
    expect(el.querySelector('pre > code')?.textContent).toBe('let a = 2;\n');
  });

  it('text right before a fence without a blank line is its own paragraph', () => {
    const el = show('Here:\n```\nx\n```\nDone');
    expect(Array.from(el.querySelectorAll('p'), (p) => p.textContent)).toEqual(['Here:', 'Done']);
    expect(el.querySelector('pre > code')?.textContent).toBe('x\n');
  });

  it('a GFM table renders as table/thead/tbody/tr/th/td', () => {
    const el = show('| Step | Result |\n| :--- | ---: |\n| 1 | **x = 2** |\n| 2 | `y` |');
    expect(Array.from(el.querySelectorAll('thead th'), (c) => c.textContent)).toEqual(['Step', 'Result']);
    expect(el.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(el.querySelector('tbody td strong')?.textContent).toBe('x = 2');
    expect(el.querySelector('tbody td code')?.textContent).toBe('y');
  });

  it('bulleted and numbered lists render as ul/ol with li', () => {
    const el = show('Steps:\n\n- one\n- two\n\n1. first\n2. second\n3. third');
    expect(Array.from(el.querySelectorAll('ul > li'), (li) => li.textContent)).toEqual(['one', 'two']);
    expect(el.querySelectorAll('ol > li')).toHaveLength(3);
  });

  it('a task list shows its checkboxes as plain text, not inputs', () => {
    const el = show('- [x] done\n- [ ] todo');
    assertInert(el);
    expect(Array.from(el.querySelectorAll('li'), (li) => li.textContent)).toEqual(['[x] done', '[ ] todo']);
  });

  it('bold, emphasis, blockquote and a rule render', () => {
    const el = show('**bold** and _em_ and *em2*\n\n> quoted\n\n---\n\nafter');
    expect(el.querySelector('strong')?.textContent).toBe('bold');
    expect(Array.from(el.querySelectorAll('em'), (e) => e.textContent)).toEqual(['em', 'em2']);
    expect(el.querySelector('blockquote')?.textContent?.trim()).toBe('quoted');
    expect(el.querySelector('hr')).not.toBeNull();
  });

  it('double-tilde strikethrough renders as <del>', () => {
    const el = show('this is ~~wrong~~ right');
    expect(el.querySelector('del')?.textContent).toBe('wrong');
  });

  it('a single tilde is not strikethrough (lead decision: matches the locked-content guard)', () => {
    const el = show('l~o~op and ~one~');
    expect(el.querySelector('del')).toBeNull();
    expect(el.textContent).toBe('l~o~op and ~one~');
  });

  it('headings are not rendered as headings; their text stays', () => {
    const el = show('# Title\n\nbody');
    expect(el.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    expect(el.textContent).toContain('Title');
  });

  it.each([
    ['https', '[docs](https://example.org/a?b=1)', 'https://example.org/a?b=1'],
    ['http', '[docs](http://example.org/)', 'http://example.org/'],
    ['mailto', '[mail](mailto:teacher@example.org)', 'mailto:teacher@example.org'],
    ['autolink literal', 'see https://example.org/x', 'https://example.org/x'],
  ])('a safe %s link renders as <a> with a safe rel', (_name, text, href) => {
    const el = show(text);
    const a = el.querySelector('a');
    expect(a?.getAttribute('href')).toBe(href);
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(el.querySelectorAll('[href]')).toHaveLength(1);
  });

  it.each([
    ['javascript', '[click](javascript:alert(1))'],
    ['mixed-case javascript', '[click](JaVaScRiPt:alert(1))'],
    ['entity-encoded javascript', '[click](jav&#x09;ascript:alert(1))'],
    ['data', '[click](data:text/html;base64,PHNjcmlwdD4=)'],
    ['vbscript', '[click](vbscript:msgbox(1))'],
    ['protocol-relative', '[click](//example.invalid/x)'],
    ['relative path', '[click](/api/x)'],
    ['fragment', '[click](#top)'],
    ['empty', '[click]()'],
    ['reference to javascript', '[click][r]\n\n[r]: javascript:alert(1)'],
  ])('an unsafe %s link renders as its text with no href', (_name, text) => {
    const el = show(text);
    assertInert(el);
    expect(el.textContent).toContain('click');
  });

  it('paragraphs split on blank lines and keep single newlines (pre-wrap)', () => {
    const el = show('Line one\nline two\n\n\nNext para');
    const ps = el.querySelectorAll('p');
    expect(ps).toHaveLength(2);
    expect(ps[0]?.textContent).toBe('Line one\nline two');
    expect((ps[0] as HTMLElement).style.whiteSpace).toBe('pre-wrap');
  });

  it('inline code becomes <code> with its text literal', () => {
    const el = show('Use `<b>x</b>` here and `y`.');
    const codes = el.querySelectorAll('p > code');
    expect(Array.from(codes, (c) => c.textContent)).toEqual(['<b>x</b>', 'y']);
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toBe('Use <b>x</b> here and y.');
  });

  it('a lone backtick stays literal', () => {
    expect(show('a ` b').textContent).toBe('a ` b');
  });

  it('TeX stays literal (maths rendering is parked)', () => {
    const tex = 'Solve $x^2 + 2x + 1 = 0$ and \\(\\frac{a}{b}\\) or $$\\int_0^1 x\\,dx$$';
    const el = show(tex);
    expect(el.textContent).toBe(tex);
    expect(el.querySelector('math, svg, span.katex')).toBeNull();
  });

  it.each([
    ['subscripts and stars', 'Let $x_1 * y_2 = a_1 * b_2$ hold', 'Let $x_1 * y_2 = a_1 * b_2$ hold'],
    ['display maths over lines', '$$\n\\sum_{i=1}^n i\n$$', '$$\n\\sum_{i=1}^n i\n$$'],
    ['bracket display', 'so \\[a_b \\cdot c_d\\] ok', 'so \\[a_b \\cdot c_d\\] ok'],
    ['a one-character span', 'take $x$ now', 'take $x$ now'],
    ['TeX with angle brackets', '$a<b>c$', '$a<b>c$'],
  ])('TeX with markdown-like characters stays literal (%s)', (_name, text, shown) => {
    const el = show(text);
    expect(el.textContent).toBe(shown);
    expect(el.querySelector('em, strong, b')).toBeNull();
  });

  it('TeX inside inline code and fenced code is not escaped', () => {
    const el = show('Use `$a_b\\,c$` and\n\n```\n$x_1\\,y$\n```\n\n~~~\n\\(z\\)\n~~~');
    expect(Array.from(el.querySelectorAll('code'), (c) => c.textContent)).toEqual([
      '$a_b\\,c$',
      '$x_1\\,y$\n',
      '\\(z\\)\n',
    ]);
  });

  it('protectMath only escapes maths segments', () => {
    expect(protectMath('a $b_c$ d `$e_f$` g')).toBe('a \\$b\\_c\\$ d `$e_f$` g');
    expect(protectMath('$5 and $ 6 and no maths')).toBe('$5 and $ 6 and no maths');
    expect(protectMath('```\n$a_b$')).toBe('```\n$a_b$');
  });

  it('protectMath still treats a one-character $x$ span as maths (9.4c: the unreachable `\\$\\S\\$` alternative was dropped)', () => {
    expect(protectMath('take $x$ now')).toBe('take \\$x\\$ now');
  });

  it.each([
    ['digit dash digit, no space', '$5-$10'],
    ['digit dash digit inside a sentence', 'price is $5-$10 today'],
    ['two separate amounts joined by "and"', 'costs $5 and $10'],
  ])('protectMath leaves a price range as plain text (%s) (9.4c)', (_name, text) => {
    expect(protectMath(text)).toBe(text);
  });

  it('known limit: protectMath still reads a price range as maths when it uses an en dash (9.4c)', () => {
    // The price-range exclusion only recognises an ASCII hyphen (`-`) right before the closing
    // `$`. An en dash (U+2013, as in "$5\u2013$10") is not excluded, so this still gets escaped as
    // maths. Documented rather than fixed: no clean, narrow rule distinguishes every dash-like
    // character a model might emit from a genuine subtraction such as `$a-b$`.
    const text = 'price $5\u2013$10';
    expect(protectMath(text)).not.toBe(text);
    expect(protectMath(text)).toBe('price \\$5\u2013\\$10');
  });

  it('safeHref allows only absolute http, https and mailto URLs', () => {
    expect(safeHref('https://example.org')).toBe('https://example.org');
    expect(safeHref('MAILTO:a@example.org')).toBe('MAILTO:a@example.org');
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref('java\tscript:alert(1)')).toBeNull();
    expect(safeHref('java\u200bscript:alert(1)')).toBeNull();
    expect(safeHref('https://[bad')).toBeNull();
    expect(safeHref('ftp://example.org')).toBeNull();
  });

  it('safeHref returns the href with invisible and bidi characters removed, not the original (9.4c)', () => {
    expect(safeHref('https://exa\u200bmple.com')).toBe('https://example.com');
    expect(safeHref('https://exa\u202emple.com')).toBe('https://example.com');
    expect(safeHref('https://exa\ufeffmple.com')).toBe('https://example.com');
    expect(safeHref('https://exa\u00admple.com')).toBe('https://example.com');
    // Still refused when the scheme only becomes visible after the invisible characters are
    // dropped: "java<ZWSP>script:" cleans to "javascript:", which is not a safe protocol.
    expect(safeHref('java\u200bscript:alert(1)')).toBeNull();
  });

  it('a U+202E inside an href never reaches the rendered href (9.4c)', () => {
    // safeHref is the only place that decides what `href` SafeLink renders (COMPONENTS.a in
    // renderReply.tsx), so this proves the attribute itself. Going through the full markdown
    // pipeline instead would test micromark's own link-destination percent-encoding, which runs
    // before safeHref and is outside this task's scope (renderReply.tsx's safeHref/protectMath).
    const safe = safeHref('https://example.com/\u202epath');
    expect(safe).toBe('https://example.com/path');
    expect(safe).not.toContain('\u202e');
  });

  it('empty or blank text renders nothing', () => {
    expect(show('').childNodes).toHaveLength(0);
    expect(show('\n\n  \n').childNodes).toHaveLength(0);
  });

  it('withheld history text renders as plain text', () => {
    const el = show('[message withheld: guard_blocked]');
    expect(el.textContent).toBe('[message withheld: guard_blocked]');
  });
});
