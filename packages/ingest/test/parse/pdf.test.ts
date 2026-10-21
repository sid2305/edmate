import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IngestError } from '../../src/errors.js';
import { parsePdf } from '../../src/parse/pdf.js';
import { makePdf } from '../fixtures/make-fixtures.js';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/pdf/${name}`, import.meta.url)));

describe('parsePdf', () => {
  it('multi-page: one unit per page, located "page 1", "page 2", ...', async () => {
    const doc = await parsePdf(fixture('photosynthesis-three-pages.pdf'), 'Photosynthesis notes');
    expect(doc).toEqual({
      sourceTitle: 'Photosynthesis notes',
      units: [
        {
          locator: 'page 1',
          text: 'Photosynthesis\nGreen plants make sugar from light, water and carbon dioxide.',
        },
        {
          locator: 'page 2',
          text: 'Where it happens\nChloroplasts in leaf cells hold the green pigment chlorophyll.',
        },
        {
          locator: 'page 3',
          text: 'What comes out\nPlants release oxygen into the air as a by-product.',
        },
      ],
    });
  });

  it('a one-page PDF gives one unit with every line', async () => {
    const doc = await parsePdf(fixture('fractions-one-page.pdf'), 'Fractions');
    expect(doc.units).toEqual([
      {
        locator: 'page 1',
        text:
          'Adding fractions\n' +
          'To add 1/4 and 2/4, keep the denominator and add the numerators.\n' +
          'The answer is 3/4.',
      },
    ]);
  });

  it('a blank page gives no unit, and later pages keep their real page number', async () => {
    const doc = await parsePdf(fixture('forces-blank-middle.pdf'), 'Forces');
    expect(doc.units.map((u) => u.locator)).toEqual(['page 1', 'page 3']);
    expect(doc.units[1]?.text).toBe(
      'Friction\nFriction is a force that slows moving surfaces that touch.',
    );
  });

  it('keeps symbols and joins runs drawn on one line', async () => {
    const doc = await parsePdf(fixture('measurement-symbols.pdf'), 'Measurement');
    expect(doc.units).toEqual([
      {
        locator: 'page 1',
        text: 'Area of a rectangle\nArea = length × width\nA 3 m by 4 m floor has area 12 m².',
      },
      {
        locator: 'page 2',
        text: 'Angles (in degrees)\nA right angle measures 90°.\nHalf of 180° is 180 ÷ 2 = 90°.',
      },
    ]);
  });

  it('does not detach or change the caller’s bytes', async () => {
    const bytes = fixture('fractions-one-page.pdf');
    const copy = bytes.slice();
    await parsePdf(bytes, 'Fractions');
    expect(bytes).toEqual(copy);
  });

  it('a PDF with no text (e.g. a scan) is an IngestError, never an empty document', async () => {
    const err = await parsePdf(makePdf([[], []]), 'Scan').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect(err).toMatchObject({ code: 'validation', retryable: false });
    expect((err as Error).message).toMatch(/no text/);
  });

  it.each([
    ['random bytes', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])],
    ['a header and nothing else', new TextEncoder().encode('%PDF-1.4\n%%EOF\n')],
    ['the first half of a real PDF', fixture('photosynthesis-three-pages.pdf').slice(0, 300)],
  ])('a corrupt PDF (%s) is IngestError("validation")', async (_label, bytes) => {
    await expect(parsePdf(bytes, 'Broken')).rejects.toMatchObject({
      name: 'IngestError',
      code: 'validation',
    });
  });

  it('a blank source title is refused before any parsing', async () => {
    await expect(parsePdf(fixture('fractions-one-page.pdf'), '  ')).rejects.toMatchObject({
      code: 'validation',
    });
  });
});
