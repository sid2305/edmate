import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocx } from '../../src/parse/docx.js';
import { makeDocx, zip } from '../fixtures/make-fixtures.js';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/docx/${name}`, import.meta.url)));

describe('parseDocx', () => {
  it('Word headings become heading-path locators, as for HTML', async () => {
    const doc = await parseDocx(fixture('solar-system-headings.docx'), 'Solar system');
    expect(doc).toEqual({
      sourceTitle: 'Solar system',
      units: [
        {
          locator: 'The Solar System',
          text: 'The Sun is a star at the centre of our solar system.',
        },
        {
          locator: 'The Solar System > Inner planets',
          text: 'Mercury, Venus, Earth and Mars are rocky planets.',
        },
        {
          locator: 'The Solar System > Outer planets',
          text: 'Jupiter and Saturn are gas giants.\nUranus and Neptune are ice giants.',
        },
        { locator: 'Moons', text: 'A moon is a natural object that orbits a planet.' },
      ],
    });
  });

  it('tables become "cell | cell" rows under their heading; bold runs join their sentence', async () => {
    const doc = await parseDocx(fixture('grammar-table.docx'), 'Grammar');
    expect(doc.units).toEqual([
      {
        locator: 'Parts of Speech',
        text: 'Each word in a sentence has a job.\nPart | Example\nNoun | river\nVerb | runs',
      },
      {
        locator: 'Parts of Speech > Adjectives',
        text: 'An adjective describes a noun, as in a wide river.',
      },
    ]);
  });

  it('a document with no headings is one unit located by the source title', async () => {
    const doc = await parseDocx(fixture('rocks-no-heading.docx'), 'Rocks');
    expect(doc.units).toEqual([
      {
        locator: 'Rocks',
        text:
          'Igneous rock forms when melted rock cools.\n' +
          'Sedimentary rock forms from layers of sand and mud.\n' +
          'Metamorphic rock forms under heat and pressure.',
      },
    ]);
  });

  it('a skipped heading level, a split run and a line break', async () => {
    const doc = await parseDocx(fixture('electricity-breaks.docx'), 'Electricity');
    expect(doc.units).toEqual([
      {
        locator: 'Electricity > Simple circuits',
        text: 'A circuit needs a power source,\nwires and a bulb.',
      },
      { locator: 'Electricity > Safety', text: 'Never touch a plug with wet hands.' },
    ]);
  });

  it('an image adds no text (as in web pages) and is never inlined; the text around it stays', async () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const drawing =
      '<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
      '<wp:docPr id="1" name="Picture 1" descr="A labelled leaf"/>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill>' +
      '<a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdImg"/>' +
      '</pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    const bytes = await zip([
      [
        '_rels/.rels',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          '</Relationships>',
      ],
      [
        'word/_rels/document.xml.rels',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/leaf.png"/>' +
          '</Relationships>',
      ],
      ['word/media/leaf.png', 'not really a png'],
      [
        'word/document.xml',
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Look at the leaf.</w:t></w:r></w:p>` +
          `<w:p>${drawing}</w:p></w:body></w:document>`,
      ],
    ]);
    const doc = await parseDocx(bytes, 'Leaves');
    expect(doc.units).toEqual([{ locator: 'Leaves', text: 'Look at the leaf.' }]);
  });

  it('a document with headings only is IngestError("validation")', async () => {
    const bytes = await makeDocx([{ h: 1, text: 'Just a title' }]);
    await expect(parseDocx(bytes, 'Empty')).rejects.toMatchObject({ code: 'validation' });
  });

  it.each([
    ['not a zip', Promise.resolve(new Uint8Array([0x50, 0x4b, 1, 2, 3]))],
    ['a zip without word/document.xml', zip([['hello.txt', 'hi']])],
  ])('%s is IngestError("validation")', async (_label, bytes) => {
    await expect(parseDocx(await bytes, 'Broken')).rejects.toMatchObject({
      name: 'IngestError',
      code: 'validation',
    });
  });

  it('a blank source title is refused', async () => {
    await expect(parseDocx(fixture('rocks-no-heading.docx'), ' ')).rejects.toMatchObject({
      code: 'validation',
    });
  });
});
