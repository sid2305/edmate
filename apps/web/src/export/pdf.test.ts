// @vitest-environment node
// Task 9.6 Phase B, acceptance item 2: the notes PDF reads back with `@edmate/ingest`'s own
// `parsePdf` -- no reader of our own. `pdfjs-dist` (via `@edmate/ingest`) is a real dependency of
// this package already; no new one is added (plan Q2).
import { parsePdf } from '@edmate/ingest';
import { describe, expect, it } from 'vitest';
import { renderPdf, type PdfBlock } from './pdf';

function textOf(bytes: Uint8Array) {
  return parsePdf(bytes, 'notes').then((doc) => doc.units.map((u) => u.text).join('\n'));
}

describe('renderPdf', () => {
  it('starts with the PDF header, has xref offsets pointing at each object, and ends %%EOF', () => {
    const bytes = renderPdf([{ kind: 'p', text: 'hello' }]);
    const str = Buffer.from(bytes).toString('latin1');
    expect(str.startsWith('%PDF-1.4\n')).toBe(true);
    expect(str.endsWith('%%EOF')).toBe(true);
    const xrefStart = Number(/startxref\n(\d+)\n/.exec(str)![1]);
    const xrefBlock = str.slice(xrefStart);
    const entries = [...xrefBlock.matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries.length).toBeGreaterThan(0);
    for (const offset of entries) {
      expect(str.slice(offset, offset + 20)).toMatch(/^\d+ 0 obj/);
    }
  });

  it('includes every topic title, session summary, teacher answer and next step as extracted text', async () => {
    const blocks: PdfBlock[] = [
      { kind: 'h1', text: 'My package - export 2026-10-22' },
      { kind: 'h2', text: 'Fractions' },
      { kind: 'li', text: 'Adding fractions: practising' },
      { kind: 'h2', text: 'Next steps' },
      { kind: 'li', text: 'Try subtracting fractions' },
      { kind: 'h2', text: 'Session summaries' },
      { kind: 'p', text: 'Worked through word problems about pizza slices.' },
      { kind: 'h2', text: 'Answers from your teacher' },
      { kind: 'p', text: 'Why does the denominator matter?' },
      { kind: 'p', text: 'Because it tells you the size of each piece.' },
    ];
    const text = await textOf(renderPdf(blocks));
    for (const b of blocks) expect(text).toContain(b.text);
  });

  it('comes back as literal text for `) Tj ET BT (`, never breaking out of its string literal', async () => {
    const payload = ') Tj ET BT (escaped?';
    const text = await textOf(renderPdf([{ kind: 'p', text: payload }]));
    expect(text).toContain(payload);
  });

  it('maps a character outside WinAnsi to `?`', async () => {
    const text = await textOf(renderPdf([{ kind: 'p', text: 'emoji test \u{1F600} done' }]));
    expect(text).toContain('emoji test ? done');
  });

  it('strips control characters', async () => {
    const text = await textOf(renderPdf([{ kind: 'p', text: 'a\u0007b\u0000c' }]));
    expect(text).toContain('abc');
  });

  it('escapes backslash and parentheses', async () => {
    const text = await textOf(renderPdf([{ kind: 'p', text: 'a (b) \\ c' }]));
    expect(text).toContain('a (b) \\ c');
  });

  it('gives an empty notes document as still one valid page', async () => {
    const doc = await parsePdf(renderPdf([]), 'notes');
    expect(doc.units.length).toBeGreaterThanOrEqual(1);
  });

  it('wraps text past one page into more than one page', async () => {
    const blocks: PdfBlock[] = Array.from({ length: 200 }, (_, i) => ({
      kind: 'p' as const,
      text: `Line number ${i}: a reasonably long sentence to use up vertical space on the page.`,
    }));
    const doc = await parsePdf(renderPdf(blocks), 'notes');
    expect(doc.units.length).toBeGreaterThan(1);
  });
});
