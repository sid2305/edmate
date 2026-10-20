// Markdown → units located by heading path. markdown-it gives a flat token stream in document order;
// each block's inline text becomes one line, table rows become "cell | cell", and raw HTML is
// dropped (it is markup or hidden notes, not lesson text).
import MarkdownIt from 'markdown-it';
import type { ParsedDocument } from '../types.js';
import { collapse, SectionBuilder } from './sections.js';

type Token = ReturnType<InstanceType<typeof MarkdownIt>['parse']>[number];

const md = new MarkdownIt({ html: true, linkify: false, typographer: false });

function inlineText(children: readonly Token[] | null): string {
  let out = '';
  for (const t of children ?? []) {
    if (t.type === 'text' || t.type === 'code_inline' || t.type === 'image') out += t.content;
    else if (t.type === 'softbreak' || t.type === 'hardbreak') out += ' ';
  }
  return collapse(out);
}

function decode(input: string | Uint8Array): string {
  // TextDecoder drops a leading BOM itself; a string may still carry one.
  return typeof input === 'string' ? input.replace(/^\uFEFF/, '') : new TextDecoder().decode(input);
}

export function parseMarkdown(input: string | Uint8Array, sourceTitle: string): ParsedDocument {
  const sections = new SectionBuilder(sourceTitle);
  let headingLevel: number | undefined;
  let row: string[] | undefined;
  for (const token of md.parse(decode(input), {})) {
    switch (token.type) {
      case 'heading_open':
        headingLevel = Number(token.tag.slice(1));
        break;
      case 'heading_close':
        headingLevel = undefined;
        break;
      case 'tr_open':
        row = [];
        break;
      case 'tr_close':
        if (row !== undefined) sections.line(row.join(' | '));
        row = undefined;
        break;
      case 'fence':
      case 'code_block':
        sections.line(token.content.replace(/\s+$/, ''));
        break;
      case 'inline': {
        const text = inlineText(token.children);
        if (headingLevel !== undefined) sections.heading(headingLevel, text);
        else if (row !== undefined) row.push(text);
        else sections.line(text);
        break;
      }
      default:
        // html_block and the open/close markers of paragraphs, lists and quotes carry no text.
        break;
    }
  }
  return sections.finish();
}
