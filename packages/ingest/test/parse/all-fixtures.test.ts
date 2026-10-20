// Task 5.1's acceptance test: all 20 fixtures (4 each of PDF, DOCX, PPTX, Markdown and web page)
// parse through the public entry points, and every unit keeps its page, slide or heading.
// Markdown, PDF, DOCX and PPTX go through parseDocument; web pages through parseWebLink with a
// stub fetcher (no network). Each file's full locator list is pinned, in order.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseDocument,
  parseWebLink,
  type DocumentKind,
  type ParsedDocument,
} from '../../src/index.js';
import { stubWebFetcher } from '../../src/testing/index.js';

const TITLE = 'Fixture';

const EXPECTED: Record<string, readonly string[]> = {
  'pdf/photosynthesis-three-pages.pdf': ['page 1', 'page 2', 'page 3'],
  'pdf/fractions-one-page.pdf': ['page 1'],
  'pdf/forces-blank-middle.pdf': ['page 1', 'page 3'],
  'pdf/measurement-symbols.pdf': ['page 1', 'page 2'],
  'docx/solar-system-headings.docx': [
    'The Solar System',
    'The Solar System > Inner planets',
    'The Solar System > Outer planets',
    'Moons',
  ],
  'docx/grammar-table.docx': ['Parts of Speech', 'Parts of Speech > Adjectives'],
  'docx/rocks-no-heading.docx': [TITLE],
  'docx/electricity-breaks.docx': ['Electricity > Simple circuits', 'Electricity > Safety'],
  'pptx/habitats-three-slides.pptx': ['slide 1', 'slide 2', 'slide 3'],
  'pptx/counting-twelve-slides.pptx': Array.from(
    { length: 12 },
    (_, i) => `slide ${String(i + 1)}`,
  ),
  'pptx/weather-reordered.pptx': ['slide 1', 'slide 2', 'slide 3'],
  'pptx/shapes-blank-slide.pptx': ['slide 1', 'slide 3'],
  'markdown/algebra-nested.md': [
    TITLE,
    'Introduction',
    'Introduction > Variables',
    'Introduction > Variables > Naming variables',
    'Introduction > Expressions',
    'Practice',
  ],
  'markdown/fractions-flat.md': ['Introduction to Fractions', 'Equivalent Fractions'],
  'markdown/geometry-long.md': [
    'Shapes and Angles',
    'Shapes and Angles > Right angles',
    'Shapes and Angles > Triangles',
    'Shapes and Angles > Quadrilaterals',
    'Shapes and Angles > Summary',
  ],
  'markdown/water-cycle-no-heading.md': [TITLE],
  'html/decimals-flat.html': ['Place value', 'Comparing decimals'],
  'html/magnets-no-heading.html': [TITLE],
  'html/plants-article.html': [
    'How Plants Make Food',
    'How Plants Make Food > What plants need',
    'How Plants Make Food > What plants need > The role of chlorophyll',
    'How Plants Make Food > What plants make',
  ],
  'html/times-tables-lists.html': ['Times Tables > Patterns', 'Times Tables > Table of nines'],
};

const KIND: Record<string, DocumentKind | 'web'> = {
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
  markdown: 'markdown',
  html: 'web',
};

const LOCATOR: Record<string, RegExp> = {
  pdf: /^page [1-9]\d*$/,
  pptx: /^slide [1-9]\d*$/,
};

const FIXTURES = new URL('../fixtures/', import.meta.url);
const onDisk = Object.keys(KIND).flatMap((dir) =>
  readdirSync(new URL(`${dir}/`, FIXTURES)).map((name) => `${dir}/${name}`),
);

function parse(rel: string): Promise<ParsedDocument> {
  const dir = rel.slice(0, rel.indexOf('/'));
  const bytes = new Uint8Array(readFileSync(new URL(rel, FIXTURES)));
  const kind = KIND[dir];
  if (kind === 'web') {
    const url = `https://lessons.example.org/${rel}`;
    return parseWebLink(url, stubWebFetcher({ [url]: new TextDecoder().decode(bytes) }), TITLE);
  }
  return parseDocument({ kind: kind!, bytes, sourceTitle: TITLE });
}

describe('all 20 fixtures', () => {
  it('there are exactly 20 fixture files, 4 per format, and each one is pinned here', () => {
    expect(onDisk.sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(onDisk).toHaveLength(20);
    for (const dir of Object.keys(KIND)) {
      expect(onDisk.filter((f) => f.startsWith(`${dir}/`))).toHaveLength(4);
    }
  });

  it.each(Object.entries(EXPECTED))(
    '%s parses and every unit keeps its place',
    async (rel, locators) => {
      const doc = await parse(rel);
      expect(doc.sourceTitle).toBe(TITLE);
      expect(doc.units.map((u) => u.locator)).toEqual(locators);
      const pattern = LOCATOR[rel.slice(0, rel.indexOf('/'))];
      for (const unit of doc.units) {
        expect(unit.text.trim()).not.toBe('');
        expect(unit.text).not.toMatch(/\n\s*\n/);
        expect(unit.locator.trim()).not.toBe('');
        if (pattern !== undefined) expect(unit.locator).toMatch(pattern);
      }
    },
  );
});
