import { describe, expect, it } from 'vitest';
import {
  CHUNK_MAX_CHARS,
  CHUNK_MAX_WORDS,
  chunkDocument,
  LOCATOR_MAX_LENGTH,
} from '../../src/chunk/chunker.js';
import { parseMarkdown } from '../../src/parse/markdown.js';
import type { ParsedDocument } from '../../src/types.js';

const words = (s: string): number => s.split(/\s+/).filter((w) => w !== '').length;
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** n sentences of 10 words each, numbered so a lost or doubled one is visible. */
function sentences(n: number, tag = 's'): string {
  return Array.from(
    { length: n },
    (_, i) => `${tag}${String(i)} one two three four five six seven eight nine.`,
  ).join(' ');
}

function doc(units: { text: string; locator: string }[]): ParsedDocument {
  return { sourceTitle: 'Notes', units };
}

describe('chunkDocument', () => {
  it('keeps a short unit as one chunk with its exact locator', () => {
    const drafts = chunkDocument(doc([{ text: 'Plants make food.', locator: 'page 1' }]));
    expect(drafts).toEqual([{ ord: 0, text: 'Plants make food.', locator: 'page 1' }]);
  });

  it('never crosses a unit: each unit starts a new chunk, ords run on in order', () => {
    const drafts = chunkDocument(
      doc([
        { text: 'First page.', locator: 'page 1' },
        { text: 'Second page.', locator: 'page 2' },
        { text: 'Third slide.', locator: 'slide 3' },
      ]),
    );
    expect(drafts.map((d) => [d.ord, d.locator, d.text])).toEqual([
      [0, 'page 1', 'First page.'],
      [1, 'page 2', 'Second page.'],
      [2, 'slide 3', 'Third slide.'],
    ]);
  });

  it(`splits a long unit at paragraphs, no chunk over ${String(CHUNK_MAX_WORDS)} words`, () => {
    const paras = Array.from({ length: 8 }, (_, i) => sentences(10, `p${String(i)}-`)); // 100 words each
    const text = paras.join('\n');
    const drafts = chunkDocument(doc([{ text, locator: 'page 4' }]));
    expect(drafts.length).toBe(3); // 300 + 300 + 200, packed at paragraph edges
    for (const d of drafts) {
      expect(words(d.text)).toBeLessThanOrEqual(CHUNK_MAX_WORDS);
      expect(d.locator).toBe('page 4');
    }
    // A paragraph is never cut when it fits whole.
    expect(drafts[0]?.text).toBe(paras.slice(0, 3).join('\n'));
    expect(squash(drafts.map((d) => d.text).join(' '))).toBe(squash(text));
  });

  it('splits a paragraph longer than the limit at sentences', () => {
    const text = sentences(45); // one 450-word paragraph
    const drafts = chunkDocument(doc([{ text, locator: 'slide 2' }]));
    expect(drafts.length).toBe(2);
    expect(drafts.map((d) => words(d.text))).toEqual([300, 150]);
    expect(drafts[1]?.text.startsWith('s30 ')).toBe(true);
    expect(squash(drafts.map((d) => d.text).join(' '))).toBe(squash(text));
  });

  it('cuts a sentence with no stop at the word limit', () => {
    const text = Array.from({ length: 650 }, (_, i) => `w${String(i)}`).join(' ');
    const drafts = chunkDocument(doc([{ text, locator: 'page 1' }]));
    expect(drafts.map((d) => words(d.text))).toEqual([300, 300, 50]);
    expect(squash(drafts.map((d) => d.text).join(' '))).toBe(text);
  });

  it(`cuts a run of characters with no spaces at ${String(CHUNK_MAX_CHARS)} characters`, () => {
    const blob = 'x'.repeat(CHUNK_MAX_CHARS * 2 + 10);
    const drafts = chunkDocument(doc([{ text: `Start ${blob} end`, locator: 'page 1' }]));
    for (const d of drafts) expect(d.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    expect(drafts.map((d) => d.text.length)).toEqual([5, CHUNK_MAX_CHARS, CHUNK_MAX_CHARS, 14]);
    expect(drafts.map((d) => d.text.replace(/\s+/g, '')).join('')).toBe(`Start${blob}end`);
  });

  it('keeps every word once across a mixed document (nothing lost or duplicated)', () => {
    const units = [
      { text: `${sentences(31)}\n${sentences(5, 'q')}`, locator: 'A > B' },
      { text: 'Short one.', locator: 'page 9' },
      { text: sentences(70, 'r'), locator: 'C' },
    ];
    const drafts = chunkDocument(doc(units));
    const got = drafts.map((d) => d.text).join(' ');
    expect(squash(got)).toBe(squash(units.map((u) => u.text).join(' ')));
    for (const d of drafts) expect(words(d.text)).toBeLessThanOrEqual(CHUNK_MAX_WORDS);
    expect(drafts.map((d) => d.ord)).toEqual(drafts.map((_, i) => i));
  });

  it('drops a whitespace-only unit instead of writing an empty chunk', () => {
    const drafts = chunkDocument(
      doc([
        { text: ' \n\t ', locator: 'page 1' },
        { text: 'Kept.', locator: 'page 2' },
      ]),
    );
    expect(drafts).toEqual([{ ord: 0, text: 'Kept.', locator: 'page 2' }]);
  });

  it('shortens a locator over the column limit, keeping its most specific end', () => {
    const long = `${'Part '.repeat(150)}> Leaf heading`;
    const [d] = chunkDocument(doc([{ text: 'Body.', locator: long }]));
    expect(d?.locator.length).toBe(LOCATOR_MAX_LENGTH);
    expect(d?.locator.startsWith('…')).toBe(true);
    expect(d?.locator.endsWith('> Leaf heading')).toBe(true);
  });

  describe('heading line (heading-located documents)', () => {
    const md = [
      '# Photosynthesis',
      'Plants make their own food.',
      '## Light',
      sentences(35, 'l'),
      '## Water',
      'Roots take in water.',
    ].join('\n\n');

    it('puts the heading line verbatim on the first chunk of each section only', () => {
      const parsed = parseMarkdown(md, 'Science notes');
      const drafts = chunkDocument(parsed, { headings: true });
      expect(drafts.map((d) => d.locator)).toEqual([
        'Photosynthesis',
        'Photosynthesis > Light',
        'Photosynthesis > Light',
        'Photosynthesis > Water',
      ]);
      expect(drafts[0]?.text).toBe('Photosynthesis\nPlants make their own food.');
      expect(drafts[1]?.text.startsWith('Light\nl0 ')).toBe(true);
      expect(drafts[2]?.text.startsWith('Light')).toBe(false);
      expect(drafts[3]?.text).toBe('Water\nRoots take in water.');
      // The heading counts toward the limit.
      for (const d of drafts) expect(words(d.text)).toBeLessThanOrEqual(CHUNK_MAX_WORDS);
      // Apart from the heading lines, the text is exactly the units' text.
      const body = drafts
        .map((d, i) =>
          i === 0 || drafts[i - 1]?.locator !== d.locator ? d.text.replace(/^[^\n]*\n/, '') : d.text,
        )
        .join(' ');
      expect(squash(body)).toBe(squash(parsed.units.map((u) => u.text).join(' ')));
    });

    it('adds no heading to text before the first heading (located by the source title)', () => {
      const parsed = parseMarkdown('Intro words.\n\n# Topic\n\nBody.', 'Science notes');
      const drafts = chunkDocument(parsed, { headings: true });
      expect(drafts.map((d) => d.text)).toEqual(['Intro words.', 'Topic\nBody.']);
    });

    it('adds nothing for page and slide documents (headings off by default)', () => {
      const drafts = chunkDocument(doc([{ text: 'Body.', locator: 'page 1' }]));
      expect(drafts[0]?.text).toBe('Body.');
    });

    it('skips a heading too long to share a chunk', () => {
      const heading = Array.from({ length: CHUNK_MAX_WORDS }, () => 'h').join(' ');
      const drafts = chunkDocument(doc([{ text: 'Body.', locator: heading }]), { headings: true });
      expect(drafts[0]?.text).toBe('Body.');
      const blank = chunkDocument(doc([{ text: 'Body.', locator: 'Topic >  ' }]), {
        headings: true,
      });
      expect(blank[0]?.text).toBe('Body.');
    });
  });
});
