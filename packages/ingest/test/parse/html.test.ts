import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IngestError } from '../../src/errors.js';
import { htmlTitle, parseHtml } from '../../src/parse/html.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/html/${name}`, import.meta.url), 'utf8');

describe('parseHtml', () => {
  it('tracks nested headings and skips page chrome (nav, footer, script, style, noscript)', () => {
    const doc = parseHtml(fixture('plants-article.html'), 'Plants sample');
    expect(doc).toEqual({
      sourceTitle: 'Plants sample',
      units: [
        {
          locator: 'How Plants Make Food',
          text: 'Plants make their own food in a process called photosynthesis.',
        },
        {
          locator: 'How Plants Make Food > What plants need',
          text:
            'A plant needs sunlight, water and carbon dioxide.\n' +
            'Sunlight is caught by the leaves.\nWater comes up from the roots.',
        },
        {
          locator: 'How Plants Make Food > What plants need > The role of chlorophyll',
          text: 'Chlorophyll is the green substance\nthat absorbs light.',
        },
        {
          locator: 'How Plants Make Food > What plants make',
          text: 'Plants make sugar for energy and give off oxygen.',
        },
      ],
    });
  });

  it('flat h2 sections; preformatted text keeps its own spacing', () => {
    const doc = parseHtml(fixture('decimals-flat.html'), 'Decimals sample');
    expect(doc.units).toEqual([
      {
        locator: 'Place value',
        text: 'In 3.45 the 4 is in the tenths place and the 5 is in the hundredths place.',
      },
      {
        locator: 'Comparing decimals',
        text: 'Line up the decimal points, then compare digits from left to right.\n  0.50\n  0.45',
      },
    ]);
  });

  it('a page with no heading is one unit located by its source title', () => {
    const doc = parseHtml(fixture('magnets-no-heading.html'), 'Magnets sample');
    expect(doc.units).toEqual([
      {
        locator: 'Magnets sample',
        text:
          'A magnet pulls on objects made of iron.\n' +
          'Every magnet has a north pole and a south pole. Opposite poles attract.',
      },
    ]);
  });

  it('nested lists, table rows and an empty heading; aside and template are dropped', () => {
    const doc = parseHtml(fixture('times-tables-lists.html'), 'Times tables sample');
    expect(doc.units).toEqual([
      {
        locator: 'Times Tables > Patterns',
        text: 'Multiples of 5 end in 0 or 5.\n5, 10, 15, 20\nMultiples of 10 end in 0.',
      },
      {
        locator: 'Times Tables > Table of nines',
        text: 'Sum | Answer\n9 x 2 | 18\n9 x 3 | 27\nPractise a little every day.',
      },
    ]);
  });

  it('decodes entities and keeps loose text that sits outside any block', () => {
    const doc = parseHtml(
      '<body>Loose &amp; free<h4>Q&amp;A</h4><div><span>a</span> <span>b</span></div></body>',
      'Loose',
    );
    expect(doc.units).toEqual([
      { locator: 'Loose', text: 'Loose & free' },
      { locator: 'Q&A', text: 'a b' },
    ]);
  });

  it('comments, scripts inside headings and cells, and stray row content are ignored', () => {
    const doc = parseHtml(
      '<body><!-- note --><h2>Hi<script>x()</script></h2>' +
        '<table><tr> <th>a</th> <!-- c --> <td>b<style>td{}</style></td></tr></table><p></p></body>',
      'Odd',
    );
    expect(doc.units).toEqual([{ locator: 'Hi', text: 'a | b' }]);
  });

  it('a fragment with no <body> still parses', () => {
    expect(parseHtml('<h1>T</h1><p>x</p>', 'Fragment').units).toEqual([
      { locator: 'T', text: 'x' },
    ]);
  });

  it.each([
    ['empty input', ''],
    ['only chrome', '<body><nav>menu</nav><script>x()</script></body>'],
    ['only headings', '<h1>One</h1><h2>Two</h2>'],
  ])('%s throws IngestError(validation)', (_label, html) => {
    expect(() => parseHtml(html, 'Empty')).toThrowError(
      expect.objectContaining({ name: 'IngestError', code: 'validation' }) as Error,
    );
  });

  it('a blank source title is refused', () => {
    expect(() => parseHtml('<p>x</p>', '')).toThrow(IngestError);
  });
});

describe('htmlTitle', () => {
  it('returns the collapsed <title> text, or undefined when absent or blank', () => {
    expect(htmlTitle(fixture('plants-article.html'))).toBe('How Plants Make Food');
    expect(htmlTitle('<title>  Two\n words </title>')).toBe('Two words');
    expect(htmlTitle('<title> </title>')).toBeUndefined();
    expect(htmlTitle('<p>no title</p>')).toBeUndefined();
  });
});
