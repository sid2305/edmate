// Task 9.6 Phase B, plan Q2: a small text-only PDF 1.4 writer -- no new dependency. US Letter pages
// (612x792 pt), 54 pt margins, the standard (not embedded) Helvetica and Helvetica-Bold fonts with
// WinAnsiEncoding, word wrap by the Helvetica AFM widths, uncompressed content streams, Latin-1
// bytes out. Read back in tests with `@edmate/ingest`'s `parsePdf` (no PDF reader of our own).
//
// Every `(`, `)` and `\` in shown text is backslash-escaped before it reaches a PDF string literal,
// so a note containing `) Tj ET BT (` can never break out of its literal and inject new PDF
// operators (acceptance: no PDF injection).

/** A line of text at one of the two standard weights. `li` indents under a bullet. */
export interface PdfBlock {
  kind: 'h1' | 'h2' | 'p' | 'li';
  text: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const TOP_Y = PAGE_HEIGHT - MARGIN;
const BOTTOM_Y = MARGIN;

const STYLE: Record<PdfBlock['kind'], { font: 'F1' | 'F2'; size: number; before: number; indent: number }> = {
  h1: { font: 'F2', size: 16, before: 6, indent: 0 },
  h2: { font: 'F2', size: 13, before: 10, indent: 0 },
  p: { font: 'F1', size: 11, before: 6, indent: 0 },
  li: { font: 'F1', size: 11, before: 2, indent: 14 },
};
const LINE_HEIGHT_FACTOR = 1.35;
const DEFAULT_WIDTH = 556;

// Helvetica AFM widths (units per 1000 em), ASCII 32..126. Public metric data, not copyrighted
// expression; used here only to word-wrap, not to embed the font.
const HELVETICA_WIDTHS: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** WinAnsi 0x95: the bullet `layout()` injects itself (never reachable through `toWinAnsi`, which
 * strips the whole 0x80-0x9F range that code point sits in before this function ever sees it). The
 * width is the standard Helvetica AFM value for the bullet glyph. */
const BULLET_CODE = 0x95;
const BULLET_WIDTH = 350;
const BULLET_CHAR = String.fromCharCode(BULLET_CODE);

function widthOf(code: number): number {
  if (code >= 32 && code <= 126) return HELVETICA_WIDTHS[code - 32]!;
  if (code === BULLET_CODE) return BULLET_WIDTH;
  // Latin-1 supplement (0xA0-0xFF) passes `toWinAnsi` unchanged (WinAnsiEncoding matches Latin-1
  // there), but this module has no per-glyph AFM width table for it. `DEFAULT_WIDTH` is used as a
  // documented, deliberately approximate fallback: wrapping stays close enough for a notes PDF and
  // never overflows the page margin by more than a character or two.
  return DEFAULT_WIDTH;
}

function textWidthPt(text: string, size: number): number {
  let units = 0;
  for (const ch of text) units += widthOf(ch.codePointAt(0) ?? 32);
  return (units / 1000) * size;
}

/** Strips control characters, keeps printable ASCII, and maps anything else (emoji, most maths
 * symbols, non-Latin scripts -- outside WinAnsi) to `?`. Latin-1 supplement (128..255) passes
 * through: WinAnsiEncoding matches Latin-1 there for the characters this pilot cares about. */
function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    // The C1 control range. WinAnsiEncoding reuses these byte values for printable glyphs
    // (curly quotes, dashes, and the bullet `layout()` injects itself at 0x95) -- a real Unicode
    // control character landing here must be dropped, never passed through as one of those
    // glyphs.
    if (code >= 0x80 && code <= 0x9f) continue;
    out += code <= 0xff ? ch : '?';
  }
  return out;
}

/** Word-wraps already-`toWinAnsi`'d text. `firstLineReserve` (pt) shrinks only the first line's
 * budget, for a prefix (the bullet and its space) added after wrapping, by `layout()`. */
function wrap(text: string, size: number, maxWidth: number, firstLineReserve = 0): string[] {
  const words = toWinAnsi(text).split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  let onFirstLine = true;
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const limit = maxWidth - (onFirstLine ? firstLineReserve : 0);
    if (current && textWidthPt(candidate, size) > limit) {
      lines.push(current);
      current = word;
      onFirstLine = false;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

interface LaidOutLine {
  font: 'F1' | 'F2';
  size: number;
  x: number;
  /** The baseline y, already decided by `layout()` so page breaks and rendering never disagree. */
  y: number;
  text: string;
}

/** Blocks laid out into pages of positioned lines (top margin down); always at least one page. */
function layout(blocks: readonly PdfBlock[]): LaidOutLine[][] {
  const pages: LaidOutLine[][] = [[]];
  let page = pages[0]!;
  let y = TOP_Y;

  function newPage() {
    page = [];
    pages.push(page);
    y = TOP_Y;
  }

  for (const block of blocks) {
    const style = STYLE[block.kind];
    const lineHeight = style.size * LINE_HEIGHT_FACTOR;
    const maxWidth = CONTENT_WIDTH - style.indent;
    const bulletPrefix = `${BULLET_CHAR} `;
    const bulletReserve = block.kind === 'li' ? textWidthPt(bulletPrefix, style.size) : 0;
    const lines = wrap(block.text, style.size, maxWidth, bulletReserve);
    y -= style.before;
    for (const [i, lineText] of lines.entries()) {
      if (y - lineHeight < BOTTOM_Y) newPage();
      const prefix = block.kind === 'li' && i === 0 ? bulletPrefix : '';
      y -= lineHeight;
      page.push({
        font: style.font,
        size: style.size,
        x: MARGIN + style.indent,
        y,
        text: prefix + lineText,
      });
    }
  }
  return pages;
}

function escapeLiteral(text: string): string {
  return text.replace(/[\\()]/g, '\\$&');
}

function contentStreamFor(lines: readonly LaidOutLine[]): string {
  const ops: string[] = [];
  for (const line of lines) {
    ops.push('BT');
    ops.push(`/${line.font} ${line.size} Tf`);
    ops.push(`${line.x} ${Math.round(line.y)} Td`);
    ops.push(`(${escapeLiteral(line.text)}) Tj`);
    ops.push('ET');
  }
  return ops.join('\n');
}

/** Renders a minimal, uncompressed, text-only PDF 1.4 document from a laid-out block list. */
export function renderPdf(blocks: readonly PdfBlock[]): Uint8Array {
  // A page with no text at all gives pdf.js's text layer nothing to extract (and `@edmate/ingest`'s
  // `parsePdf` refuses a document with no text), so an empty notes document still gets one real
  // character of content rather than a blank page no reader could confirm.
  const pages = layout(blocks.length > 0 ? blocks : [{ kind: 'p', text: '.' }]);
  let buf = '%PDF-1.4\n';
  const offsets: number[] = [];
  let nextId = 1;
  const reserve = () => nextId++;
  const write = (id: number, body: string) => {
    offsets[id] = buf.length;
    buf += `${id} 0 obj\n${body}\nendobj\n`;
  };

  const pagesId = reserve();
  const catalogId = reserve();
  const fontId = reserve();
  const boldFontId = reserve();
  write(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  write(
    boldFontId,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );

  const kids: number[] = [];
  for (const pageLines of pages) {
    const contentId = reserve();
    const pageId = reserve();
    const stream = contentStreamFor(pageLines);
    write(contentId, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    write(
      pageId,
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    kids.push(pageId);
  }
  write(pagesId, `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  write(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const maxId = nextId - 1;
  const xrefOffset = buf.length;
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxId; i++) {
    xref += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  buf += xref;
  buf += `trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const bytes = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) bytes[i] = buf.charCodeAt(i) & 0xff;
  return bytes;
}
