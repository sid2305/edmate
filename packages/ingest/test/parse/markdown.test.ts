import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IngestError } from '../../src/errors.js';
import { parseMarkdown } from '../../src/parse/markdown.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/markdown/${name}`, import.meta.url), 'utf8');

describe('parseMarkdown', () => {
  it('flat headings: each section carries its own heading as the locator', () => {
    const doc = parseMarkdown(fixture('fractions-flat.md'), 'Fractions sample');
    expect(doc).toEqual({
      sourceTitle: 'Fractions sample',
      units: [
        {
          locator: 'Introduction to Fractions',
          text:
            'A fraction names a part of a whole. The top number is the numerator and the bottom number is the denominator.\n' +
            'If a pizza is cut into eight equal slices and you eat three, you have eaten 3/8 of it.',
        },
        {
          locator: 'Equivalent Fractions',
          text: 'Two fractions are equivalent when they name the same amount, such as 1/2 and 2/4.',
        },
      ],
    });
  });

  it('nested headings join as "H1 > H2 > H3"; text before any heading uses the source title', () => {
    const doc = parseMarkdown(fixture('algebra-nested.md'), 'Algebra sample');
    expect(doc.units).toEqual([
      {
        locator: 'Algebra sample',
        text: 'Algebra uses letters to stand for numbers we do not know yet.',
      },
      { locator: 'Introduction', text: 'This unit starts with the idea of an unknown.' },
      {
        locator: 'Introduction > Variables',
        text:
          'A variable is a letter, such as x, that stands for a number.\n' +
          'x can stand for any number\n' +
          'the same letter means the same number in one problem',
      },
      {
        locator: 'Introduction > Variables > Naming variables',
        text: 'Pick a letter that reminds you of the quantity, like t for time.',
      },
      {
        locator: 'Introduction > Expressions',
        text: 'An expression combines numbers and variables:\n2x + 3',
      },
      {
        locator: 'Practice',
        text: 'Write an expression for "five more than a number".\nEvaluate 2x + 3 when x = 4.',
      },
    ]);
  });

  it('a document with no heading is one unit located by its source title', () => {
    const doc = parseMarkdown(fixture('water-cycle-no-heading.md'), 'Water cycle sample');
    expect(doc.units).toEqual([
      {
        locator: 'Water cycle sample',
        text:
          'The water cycle is the path water takes as it moves around the Earth.\n' +
          'Water evaporates from oceans and lakes, rises as vapour, cools into clouds and falls back as rain or snow.\n' +
          'Remember: the same water has been going round this cycle for a very long time.',
      },
    ]);
  });

  it('skipped levels, tables, images and raw HTML; an empty heading changes nothing', () => {
    const doc = parseMarkdown(fixture('geometry-long.md'), 'Geometry sample');
    expect(doc.units).toEqual([
      {
        locator: 'Shapes and Angles',
        text: 'Geometry is the study of shapes, sizes and the space they take up.',
      },
      {
        locator: 'Shapes and Angles > Right angles',
        text: 'A right angle measures exactly 90 degrees. The corner of a page is a good example.',
      },
      {
        locator: 'Shapes and Angles > Triangles',
        text:
          'A triangle has three sides and three angles. Its angles always add up to 180 degrees.\n' +
          'Type | Sides equal\nEquilateral | 3\nIsosceles | 2\nScalene | 0',
      },
      {
        locator: 'Shapes and Angles > Quadrilaterals',
        text:
          'A quadrilateral has four sides. Squares, rectangles and kites are all quadrilaterals.\n' +
          'A square drawn on grid paper',
      },
      {
        locator: 'Shapes and Angles > Summary',
        text: 'Shapes are described by their sides and angles.',
      },
    ]);
  });

  it('accepts bytes with a BOM and CRLF line ends, and drops inline HTML tags', () => {
    const bytes = new TextEncoder().encode('\uFEFF# Heat\r\n\r\nHot air <b>rises</b>.\r\n');
    expect(parseMarkdown(bytes, 'Heat sample').units).toEqual([
      { locator: 'Heat', text: 'Hot air rises.' },
    ]);
  });

  it('a heading reused later starts a separate unit; never a merged one', () => {
    const doc = parseMarkdown('# A\n\none\n\n# B\n\ntwo\n\n# A\n\nthree\n', 'Repeat');
    expect(doc.units.map((u) => [u.locator, u.text])).toEqual([
      ['A', 'one'],
      ['B', 'two'],
      ['A', 'three'],
    ]);
  });

  it('heading text keeps its inline content but not its markup', () => {
    const doc = parseMarkdown('# The `x`   **axis**\n\nflat line\n', 'Axis');
    expect(doc.units).toEqual([{ locator: 'The x axis', text: 'flat line' }]);
  });

  it.each([
    ['empty input', ''],
    ['only whitespace', '   \n\n  '],
    ['only headings', '# One\n\n## Two\n'],
    ['only raw HTML', '<div>\nhidden\n</div>\n'],
  ])('%s throws IngestError(validation), never an empty document', (_label, md) => {
    expect(() => parseMarkdown(md, 'Empty')).toThrowError(
      expect.objectContaining({ name: 'IngestError', code: 'validation' }) as Error,
    );
  });

  it('a blank source title is refused, since it is the fallback locator', () => {
    expect(() => parseMarkdown('text', '  ')).toThrow(IngestError);
  });
});
