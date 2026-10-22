// The one door for uploaded documents and web links: size is checked before any parsing work, and a
// document always comes back with at least one located unit or an IngestError.
import { IngestError } from './errors.js';
import type { WebFetcher } from './fetch/webFetch.js';
import { parseSrt, parseVtt } from './parse/captions.js';
import { parseDocx } from './parse/docx.js';
import { htmlTitle, parseHtml } from './parse/html.js';
import { parseMarkdown } from './parse/markdown.js';
import { parsePdf } from './parse/pdf.js';
import { parsePptx } from './parse/pptx.js';
import { MAX_DOCUMENT_BYTES, type ParsedDocument } from './types.js';

export type DocumentKind = 'pdf' | 'docx' | 'pptx' | 'markdown' | 'vtt' | 'srt';

export interface DocumentInput {
  readonly kind: DocumentKind;
  readonly bytes: Uint8Array;
  readonly sourceTitle: string;
}

export function parseDocument(input: DocumentInput): Promise<ParsedDocument> {
  // Async so a parser's synchronous throw always reaches the caller as a rejection.
  return Promise.resolve().then(() => {
    if (input.bytes.byteLength === 0)
      throw new IngestError('validation', false, 'the document is empty');
    if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) {
      throw new IngestError(
        'input_too_large',
        false,
        `the document is larger than the ${String(MAX_DOCUMENT_BYTES)}-byte limit`,
      );
    }
    switch (input.kind) {
      case 'markdown':
        return parseMarkdown(input.bytes, input.sourceTitle);
      case 'pdf':
        return parsePdf(input.bytes, input.sourceTitle);
      case 'docx':
        return parseDocx(input.bytes, input.sourceTitle);
      case 'pptx':
        return parsePptx(input.bytes, input.sourceTitle);
      case 'vtt':
        return parseVtt(input.bytes, input.sourceTitle);
      case 'srt':
        return parseSrt(input.bytes, input.sourceTitle);
      default:
        throw new IngestError('unsupported', false, 'unknown document kind');
    }
  });
}

/**
 * Fetches a web link through the given fetcher and parses it by heading. The title is the one
 * given, else the page's <title>, else the link's host.
 */
export async function parseWebLink(
  url: string,
  fetcher: WebFetcher,
  sourceTitle?: string,
): Promise<ParsedDocument> {
  const { html } = await fetcher.fetchPage(url);
  const given = sourceTitle?.trim();
  const title =
    given !== undefined && given !== '' ? given : (htmlTitle(html) ?? new URL(url).host);
  return parseHtml(html, title);
}
