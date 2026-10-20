// Task 5.3: ParsedDocument → chunk drafts. A chunk never crosses a unit, so its locator stays the
// unit's exact page, slide or heading path. A unit is split at lines (paragraphs), then sentences,
// then words, then (for a run with no spaces) characters, and the pieces are packed greedily up to
// CHUNK_MAX_WORDS words and CHUNK_MAX_CHARS characters. There is no overlap: the module text that
// leakCheck joins must read as the source does. In heading-located documents the first chunk of a
// section starts with its heading line (still source text; it helps full-text recall).
import type { ChunkDraft } from '../index/types.js';
import type { ParsedDocument } from '../types.js';

export const CHUNK_MAX_WORDS = 300;
/** Bounds a chunk of very long "words" (URLs, formulas) well inside the embedding input limit. */
export const CHUNK_MAX_CHARS = 4_000;
/** The store's locator column limit; a longer heading path keeps its most specific end. */
export const LOCATOR_MAX_LENGTH = 500;
/** A heading longer than this is body text set as a heading; it is not repeated. */
const HEADING_MAX_WORDS = 30;

export interface ChunkOptions {
  /**
   * The document is located by heading path (Markdown, HTML, DOCX, web pages): the first chunk of
   * each section starts with its heading line. Off for page and slide documents.
   */
  readonly headings?: boolean;
}

const splitWords = (s: string): string[] => s.split(/\s+/).filter((w) => w !== '');
const countWords = (s: string): number => splitWords(s).length;

function fitLocator(locator: string): string {
  return locator.length <= LOCATOR_MAX_LENGTH
    ? locator
    : `…${locator.slice(locator.length - LOCATOR_MAX_LENGTH + 1)}`;
}

/** The heading line of a heading-located unit, if it has one worth repeating. */
function headingOf(locator: string, sourceTitle: string): string | undefined {
  // Text before the first heading is located by the source title: it has no heading line.
  if (locator === sourceTitle) return undefined;
  const step = locator.lastIndexOf(' > ');
  const heading = (step < 0 ? locator : locator.slice(step + 3)).trim();
  const words = countWords(heading);
  if (words === 0 || words > HEADING_MAX_WORDS) return undefined;
  return heading;
}

/** Splits one unit's text into chunk texts; the heading (if any) leads the first one. */
function packUnit(text: string, heading: string | undefined): string[] {
  const out: string[] = [];
  const lead = heading === undefined ? '' : `${heading}\n`;
  const leadWords = heading === undefined ? 0 : countWords(heading);
  let cur = '';
  let curWords = 0;

  const room = (): { words: number; chars: number } =>
    out.length === 0
      ? { words: CHUNK_MAX_WORDS - leadWords, chars: CHUNK_MAX_CHARS - lead.length }
      : { words: CHUNK_MAX_WORDS, chars: CHUNK_MAX_CHARS };
  const fits = (piece: string, words: number, sep: string): boolean => {
    const r = room();
    const chars = cur === '' ? piece.length : cur.length + sep.length + piece.length;
    return curWords + words <= r.words && chars <= r.chars;
  };
  const put = (piece: string, words: number, sep: string): void => {
    cur = cur === '' ? piece : `${cur}${sep}${piece}`;
    curWords += words;
  };
  const flush = (): void => {
    if (cur === '') return;
    out.push(out.length === 0 ? `${lead}${cur}` : cur);
    cur = '';
    curWords = 0;
  };

  // level 0: a line, 1: a sentence, 2: a word, 3: a slice of a word.
  const add = (piece: string, sep: string, level: number): void => {
    const words = countWords(piece);
    if (fits(piece, words, sep)) return put(piece, words, sep);
    flush();
    if (fits(piece, words, sep) || level === 3) return put(piece, words, sep);
    if (level === 0) {
      for (const s of piece.split(/(?<=[.!?])\s+/)) add(s, ' ', 1);
    } else if (level === 1) {
      for (const w of splitWords(piece)) add(w, ' ', 2);
    } else {
      const size = room().chars;
      for (let i = 0; i < piece.length; i += size) add(piece.slice(i, i + size), '', 3);
    }
  };

  for (const line of text.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed.trim() !== '') add(trimmed, '\n', 0);
  }
  flush();
  return out;
}

/** Chunks a parsed document; `ord` runs 0, 1, 2… across the whole document. */
export function chunkDocument(doc: ParsedDocument, opts: ChunkOptions = {}): ChunkDraft[] {
  const drafts: ChunkDraft[] = [];
  for (const unit of doc.units) {
    const heading = opts.headings === true ? headingOf(unit.locator, doc.sourceTitle) : undefined;
    const locator = fitLocator(unit.locator);
    for (const text of packUnit(unit.text, heading)) {
      drafts.push({ ord: drafts.length, text, locator });
    }
  }
  return drafts;
}
