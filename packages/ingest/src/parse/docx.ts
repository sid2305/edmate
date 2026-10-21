// DOCX → units located by heading path. mammoth turns Word's Heading 1–6 styles into <h1>–<h6>,
// tables into <table> and line breaks into <br>; parseHtml then walks that HTML exactly as it walks
// a web page, so DOCX and web links share one locator rule.
//
// Before mammoth sees the file, every entry is inflated once against the unzipped-bytes budget
// (mammoth inflates without a cap). Images are replaced by an empty <img> (no bytes read or
// inlined), and mammoth may not open files the document links to.
import mammoth from 'mammoth';
import { IngestError } from '../errors.js';
import type { ParsedDocument } from '../types.js';
import { parseHtml } from './html.js';
import { requireTitle } from './sections.js';
import { openZip } from './zip.js';

const noImage = mammoth.images.imgElement(() => Promise.resolve({ src: '' }));

export async function parseDocx(bytes: Uint8Array, sourceTitle: string): Promise<ParsedDocument> {
  const title = requireTitle(sourceTitle);
  await (await openZip(bytes, 'DOCX')).checkAll();
  let html: string;
  try {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes) },
      { convertImage: noImage, externalFileAccess: false },
    );
    html = result.value;
  } catch {
    throw new IngestError('validation', false, 'the file could not be read as a DOCX');
  }
  return parseHtml(html, title);
}
