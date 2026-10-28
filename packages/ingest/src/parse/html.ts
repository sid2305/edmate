// HTML → units located by heading path: the parser for web links, and (Phase C) for DOCX through
// mammoth's HTML. The DOM is walked in document order; block elements end a line, <br> splits one,
// table rows become "cell | cell", <pre> keeps its spacing, and page chrome (navigation, footers,
// asides, scripts, styles, forms) is dropped. Uses cheerio/slim (htmlparser2), which loads no
// network code.
import { load } from 'cheerio/slim';
import type { ParsedDocument } from '../types.js';
import { collapse, SectionBuilder } from './sections.js';

/** The structural slice of a parsed node this walk needs (domhandler's shape). */
interface DomNode {
  readonly type: string;
  readonly name?: string;
  /** Set on text and comment nodes; absent on element nodes and directives. */
  readonly data?: string;
  readonly children?: readonly DomNode[];
}

/** A checked narrowing in place of an unchecked double cast: any object with a `type` tag
 * structurally satisfies the walker's needs (every domhandler node has one). */
function isDomNode(node: unknown): node is DomNode {
  return typeof node === 'object' && node !== null && 'type' in node;
}

const SKIP = new Set([
  'head',
  'title',
  'script',
  'style',
  'noscript',
  'template',
  'nav',
  'footer',
  'aside',
  'svg',
  'iframe',
  'object',
  'form',
  'button',
  'select',
]);
const BLOCK = new Set([
  'html',
  'body',
  'main',
  'article',
  'section',
  'header',
  'div',
  'p',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'blockquote',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'caption',
  'address',
  'details',
  'summary',
  'hr',
]);
const HEADING = /^h([1-6])$/;

function textOf(node: DomNode): string {
  if (node.type === 'text') return node.data ?? '';
  if (node.name !== undefined && SKIP.has(node.name)) return '';
  return (node.children ?? []).map(textOf).join('');
}

class Walker {
  #buffer = '';

  constructor(private readonly sections: SectionBuilder) {}

  walk(node: DomNode): void {
    if (node.type === 'text') {
      this.#buffer += node.data ?? '';
      return;
    }
    const name = node.name;
    if (name === undefined) {
      // The document root (or a comment/directive, which has no children).
      for (const child of node.children ?? []) this.walk(child);
      return;
    }
    if (SKIP.has(name)) return;
    if (name === 'br') {
      this.#buffer += '\n';
      return;
    }
    const heading = HEADING.exec(name);
    if (heading !== null) {
      this.flush();
      this.sections.heading(Number(heading[1]), textOf(node));
      return;
    }
    if (name === 'tr') {
      this.flush();
      const cells = (node.children ?? [])
        .filter((c) => c.name === 'td' || c.name === 'th')
        .map((c) => collapse(textOf(c)));
      this.sections.line(cells.join(' | '));
      return;
    }
    if (name === 'pre') {
      this.flush();
      const lines = textOf(node)
        .replace(/^\n+/, '')
        .split('\n')
        .map((l) => l.trimEnd());
      this.sections.line(lines.join('\n').replace(/\s+$/, ''));
      return;
    }
    const block = BLOCK.has(name);
    if (block) this.flush();
    for (const child of node.children ?? []) this.walk(child);
    if (block) this.flush();
  }

  flush(): void {
    for (const part of this.#buffer.split('\n')) this.sections.line(collapse(part));
    this.#buffer = '';
  }
}

export function parseHtml(html: string, sourceTitle: string): ParsedDocument {
  const sections = new SectionBuilder(sourceTitle);
  const $ = load(html);
  const body = $('body')[0] ?? $.root()[0];
  if (!isDomNode(body)) throw new Error('cheerio produced no document node');
  const walker = new Walker(sections);
  walker.walk(body);
  walker.flush();
  return sections.finish();
}

/** The page's <title>, whitespace collapsed; undefined when missing or blank. */
export function htmlTitle(html: string): string | undefined {
  const title = collapse(load(html)('title').first().text());
  return title === '' ? undefined : title;
}
