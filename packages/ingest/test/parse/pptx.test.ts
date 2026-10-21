import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePptx } from '../../src/parse/pptx.js';
import { makePptx, slides, zip } from '../fixtures/make-fixtures.js';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/pptx/${name}`, import.meta.url)));

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A deck whose relationships know only rId2 → slide1, with the given slide list entries. */
const slideList = (ids: string): Promise<Uint8Array> =>
  zip([
    [
      'ppt/presentation.xml',
      `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`,
    ],
    [
      'ppt/_rels/presentation.xml.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId2" Type="x/slide" Target="slides/slide1.xml"/></Relationships>',
    ],
    ['ppt/slides/slide1.xml', `<p:sld xmlns:p="${P}"/>`],
  ]);

describe('parsePptx', () => {
  it('one unit per slide, located "slide N", each paragraph a line', async () => {
    const doc = await parsePptx(fixture('habitats-three-slides.pptx'), 'Habitats');
    expect(doc).toEqual({
      sourceTitle: 'Habitats',
      units: [
        { locator: 'slide 1', text: 'Habitats\nA habitat is the home of a plant or animal.' },
        {
          locator: 'slide 2',
          text: 'Deserts\nDeserts get very little rain.\nCamels store fat in their humps.',
        },
        { locator: 'slide 3', text: 'Oceans\nOceans cover most of the Earth.' },
      ],
    });
  });

  it('without presentation.xml, slides go in numeric file order, not zip or text order', async () => {
    const doc = await parsePptx(fixture('counting-twelve-slides.pptx'), 'Counting');
    expect(doc.units).toEqual(
      Array.from({ length: 12 }, (_, i) => ({
        locator: `slide ${String(i + 1)}`,
        text: `Counting in twos: ${String((i + 1) * 2)}`,
      })),
    );
  });

  it('the show order in presentation.xml wins over file names', async () => {
    const doc = await parsePptx(fixture('weather-reordered.pptx'), 'Weather');
    expect(doc.units).toEqual([
      { locator: 'slide 1', text: 'Weather words\nToday we learn three weather words.' },
      { locator: 'slide 2', text: 'Clouds\nClouds are made of tiny water droplets.' },
      { locator: 'slide 3', text: 'Rain\nRain falls when droplets grow heavy.' },
    ]);
  });

  it('a blank slide gives no unit but keeps its number; runs join, a soft break splits', async () => {
    const doc = await parsePptx(fixture('shapes-blank-slide.pptx'), 'Shapes');
    expect(doc.units).toEqual([
      { locator: 'slide 1', text: 'Shapes\nA triangle has three sides.\nA square has four.' },
      { locator: 'slide 3', text: 'Circles\nA circle has no corners.' },
    ]);
  });

  it('decodes XML entities and keeps number-like text as written', async () => {
    const bytes = await makePptx(slides([[[['Salt & pepper < 3 > 1'], ['007']]]]), [1]);
    const doc = await parsePptx(bytes, 'Entities');
    expect(doc.units).toEqual([{ locator: 'slide 1', text: 'Salt & pepper < 3 > 1\n007' }]);
  });

  it('reads absolute relationship targets and ignores non-slide relationships', async () => {
    const bytes = await zip([
      [
        'ppt/presentation.xml',
        `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="rId7"/></p:sldIdLst></p:presentation>`,
      ],
      [
        'ppt/_rels/presentation.xml.rels',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="x/theme" Target="theme/theme1.xml"/>' +
          '<Relationship Id="rId7" Type="x/slide" Target="/ppt/slides/slide9.xml"/>' +
          '</Relationships>',
      ],
      [
        'ppt/slides/slide9.xml',
        `<p:sld xmlns:p="${P}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>Only slide</a:t></a:r></a:p></p:sld>`,
      ],
    ]);
    const doc = await parsePptx(bytes, 'Absolute');
    expect(doc.units).toEqual([{ locator: 'slide 1', text: 'Only slide' }]);
  });

  it.each([
    ['not a zip', Promise.resolve(new Uint8Array([9, 9, 9]))],
    ['a zip with no slides', zip([['readme.txt', 'nothing here']])],
    ['a deck whose only slide is blank', makePptx(slides([[]]), [1])],
    [
      'a slide list pointing at a missing slide',
      zip([
        [
          'ppt/presentation.xml',
          `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`,
        ],
        [
          'ppt/_rels/presentation.xml.rels',
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId2" Type="x/slide" Target="slides/slide4.xml"/></Relationships>',
        ],
      ]),
    ],
    [
      'a slide list without its relationships part',
      zip([
        [
          'ppt/presentation.xml',
          `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="rId5"/></p:sldIdLst></p:presentation>`,
        ],
      ]),
    ],
    ['a slide list with an unknown relationship id', slideList('<p:sldId id="256" r:id="rId5"/>')],
    ['a slide list entry with no relationship id', slideList('<p:sldId id="256"/>')],
    ['a slide list entry with no attributes', slideList('<p:sldId/>')],
    [
      'a slide list with no slides in it',
      zip([
        ['ppt/presentation.xml', `<p:presentation xmlns:p="${P}"><p:sldIdLst/></p:presentation>`],
      ]),
    ],
    [
      'a slide with a DOCTYPE (entity expansion)',
      zip([
        [
          'ppt/slides/slide1.xml',
          '<?xml version="1.0"?><!DOCTYPE p:sld [<!ENTITY a "aaaaaaaa">]>' +
            `<p:sld xmlns:p="${P}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>&a;&a;</a:t></a:r></a:p></p:sld>`,
        ],
      ]),
    ],
    [
      'a slide that is not well-formed XML',
      zip([['ppt/slides/slide1.xml', '<p:sld><a:p><a:t>open']]),
    ],
  ])('%s is IngestError("validation")', async (_label, bytes) => {
    await expect(parsePptx(await bytes, 'Broken')).rejects.toMatchObject({
      name: 'IngestError',
      code: 'validation',
    });
  });

  it('a blank source title is refused', async () => {
    await expect(parsePptx(fixture('habitats-three-slides.pptx'), '')).rejects.toMatchObject({
      code: 'validation',
    });
  });
});
