// @vitest-environment jsdom
// Task 9.4 Phase B: the reply renderer never renders raw model HTML (4.6b safety review). HTML in
// the text shows literally as text; fenced code becomes <pre><code>; TeX stays literal (KaTeX is
// parked). Swapping in a markdown library later must keep these tests green.
import type { TurnEvent } from '@edmate/contracts';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderReply } from './renderReply';
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
    ['a markdown image', '![x](https://example.invalid/a.png)'],
  ])('%s shows literally and makes no element', (_name, text) => {
    const el = show(text);
    assertInert(el);
    expect(el.textContent).toContain(text);
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
    expect(el.querySelector('pre > code')?.textContent).toBe('<script>alert(1)</script>');
  });

  it('a fenced code block becomes <pre><code> with its text kept exactly', () => {
    const el = show('Try this:\n\n```ts\nconst x = 1;\n  if (x) {}\n```\n\nThen run it.');
    const code = el.querySelector('pre > code');
    expect(code?.textContent).toBe('const x = 1;\n  if (x) {}');
    expect(el.querySelectorAll('p')).toHaveLength(2);
    expect(el.querySelectorAll('p')[0]?.textContent).toBe('Try this:');
    expect(el.querySelectorAll('p')[1]?.textContent).toBe('Then run it.');
  });

  it('an unclosed fence (still streaming) renders the rest as code', () => {
    const el = show('Code:\n```\nlet a = 2;');
    expect(el.querySelector('pre > code')?.textContent).toBe('let a = 2;');
  });

  it('text right before a fence without a blank line is its own paragraph', () => {
    const el = show('Here:\n```\nx\n```\nDone');
    expect(Array.from(el.querySelectorAll('p'), (p) => p.textContent)).toEqual(['Here:', 'Done']);
    expect(el.querySelector('pre > code')?.textContent).toBe('x');
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

  it('empty or blank text renders nothing', () => {
    expect(show('').childNodes).toHaveLength(0);
    expect(show('\n\n  \n').childNodes).toHaveLength(0);
  });

  it('withheld history text renders as plain text', () => {
    const el = show('[message withheld: guard_blocked]');
    expect(el.textContent).toBe('[message withheld: guard_blocked]');
  });
});
