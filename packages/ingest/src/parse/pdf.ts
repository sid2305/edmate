// PDF → one unit per page, located "page N" (N is the real page number, so a blank page is skipped
// without shifting later ones). Text comes from pdf.js's text layer: runs are joined in reading
// order and a run marked end-of-line ends the line. A PDF with no text layer (a scan) is refused:
// OCR is not part of ingestion.
//
// pdf.js 6 has no eval path at all; it is loaded with no font faces, no system fonts, no fetching
// and no rendering, only the text layer.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { IngestError } from '../errors.js';
import type { ParsedDocument } from '../types.js';
import { numberedUnits, requireTitle } from './sections.js';

/** The slice of a pdf.js text item read here (marked-content items only come when asked for). */
interface TextRun {
  readonly str: string;
  readonly hasEOL: boolean;
}

function pageLines(items: readonly TextRun[]): string[] {
  let text = '';
  for (const item of items) {
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text.split('\n');
}

function unreadable(error: unknown): IngestError {
  if (error instanceof Error && error.name === 'PasswordException') {
    return new IngestError('validation', false, 'the PDF is password-protected');
  }
  return new IngestError('validation', false, 'the file could not be read as a PDF');
}

export async function parsePdf(bytes: Uint8Array, sourceTitle: string): Promise<ParsedDocument> {
  const title = requireTitle(sourceTitle);
  const task = getDocument({
    // A plain Uint8Array copy: pdf.js refuses a Buffer and detaches the array it is given.
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  try {
    const pages: string[][] = [];
    try {
      const pdf = await task.promise;
      for (let n = 1; n <= pdf.numPages; n++) {
        const content = await (await pdf.getPage(n)).getTextContent();
        pages.push(pageLines(content.items as readonly TextRun[]));
      }
    } catch (error) {
      throw unreadable(error);
    }
    return numberedUnits(title, 'page', pages);
  } finally {
    await task.destroy();
  }
}
