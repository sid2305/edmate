// The heading-tracked locator strategy shared by Markdown, HTML and (Phase C) DOCX: every line of
// text belongs to the nearest heading above it, named as its heading path ("H1 > H2 > H3"). Text
// before any heading is located by the source title. A new heading closes the current section.
import { IngestError } from '../errors.js';
import type { ParsedDocument, ParsedUnit } from '../types.js';

/** Collapses runs of whitespace to one space and trims. */
export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function requireTitle(sourceTitle: string): string {
  const title = collapse(sourceTitle);
  if (title === '') throw new IngestError('validation', false, 'the source title is empty');
  return title;
}

export class SectionBuilder {
  readonly #title: string;
  /** Heading text by level 1–6; a lower level heading clears every deeper one. */
  readonly #path: (string | undefined)[] = [];
  readonly #units: ParsedUnit[] = [];
  #lines: string[] = [];

  constructor(sourceTitle: string) {
    this.#title = requireTitle(sourceTitle);
  }

  /** An empty heading changes nothing: it would only produce a locator with a blank step. */
  heading(level: number, text: string): void {
    const name = collapse(text);
    if (name === '') return;
    this.#flush();
    this.#path.length = level - 1;
    this.#path[level - 1] = name;
  }

  /** Adds one line of text; a blank line is dropped. */
  line(text: string): void {
    if (text.trim() !== '') this.#lines.push(text);
  }

  finish(): ParsedDocument {
    this.#flush();
    if (this.#units.length === 0) {
      throw new IngestError('validation', false, 'the document has no text to learn from');
    }
    return { sourceTitle: this.#title, units: this.#units };
  }

  #flush(): void {
    if (this.#lines.length === 0) return;
    const named = this.#path.filter((p): p is string => p !== undefined);
    this.#units.push({
      text: this.#lines.join('\n'),
      locator: named.length === 0 ? this.#title : named.join(' > '),
    });
    this.#lines = [];
  }
}
