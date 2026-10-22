import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IngestError, MAX_DOCUMENT_BYTES, parseDocument, parseWebLink } from '../../src/index.js';
import { stubWebFetcher } from '../../src/testing/index.js';

const bytesOf = (rel: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/${rel}`, import.meta.url)));
const PAGE = 'https://lessons.example.org/plants';

describe('parseDocument', () => {
  it('dispatches markdown bytes to the heading-tracked parser', async () => {
    const doc = await parseDocument({
      kind: 'markdown',
      bytes: bytesOf('markdown/fractions-flat.md'),
      sourceTitle: 'Fractions sample',
    });
    expect(doc.units.map((u) => u.locator)).toEqual([
      'Introduction to Fractions',
      'Equivalent Fractions',
    ]);
  });

  it('dispatches pdf bytes to the page-numbered parser', async () => {
    const doc = await parseDocument({
      kind: 'pdf',
      bytes: bytesOf('pdf/forces-blank-middle.pdf'),
      sourceTitle: 'Forces',
    });
    expect(doc.units.map((u) => u.locator)).toEqual(['page 1', 'page 3']);
  });

  it('dispatches docx bytes to the heading-tracked parser', async () => {
    const doc = await parseDocument({
      kind: 'docx',
      bytes: bytesOf('docx/grammar-table.docx'),
      sourceTitle: 'Grammar',
    });
    expect(doc.units.map((u) => u.locator)).toEqual([
      'Parts of Speech',
      'Parts of Speech > Adjectives',
    ]);
  });

  it('dispatches pptx bytes to the slide-numbered parser', async () => {
    const doc = await parseDocument({
      kind: 'pptx',
      bytes: bytesOf('pptx/shapes-blank-slide.pptx'),
      sourceTitle: 'Shapes',
    });
    expect(doc.units.map((u) => u.locator)).toEqual(['slide 1', 'slide 3']);
  });

  it('dispatches vtt bytes to the caption parser', async () => {
    const doc = await parseDocument({
      kind: 'vtt',
      bytes: new TextEncoder().encode(
        'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello from a caption file.\n',
      ),
      sourceTitle: 'Captions',
    });
    expect(doc.units).toEqual([{ text: 'Hello from a caption file.', locator: '0:00' }]);
  });

  it('dispatches srt bytes to the caption parser', async () => {
    const doc = await parseDocument({
      kind: 'srt',
      bytes: new TextEncoder().encode(
        '1\n00:00:00,000 --> 00:00:01,000\nHello from an srt file.\n',
      ),
      sourceTitle: 'Captions',
    });
    expect(doc.units).toEqual([{ text: 'Hello from an srt file.', locator: '0:00' }]);
  });

  it('refuses empty input and input over the size cap before parsing', async () => {
    await expect(
      parseDocument({ kind: 'markdown', bytes: new Uint8Array(0), sourceTitle: 'x' }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      parseDocument({
        kind: 'markdown',
        bytes: new Uint8Array(MAX_DOCUMENT_BYTES + 1),
        sourceTitle: 'x',
      }),
    ).rejects.toMatchObject({ code: 'input_too_large' });
  });

  it('refuses an empty vtt and an over-size srt file before parsing', async () => {
    await expect(
      parseDocument({ kind: 'vtt', bytes: new Uint8Array(0), sourceTitle: 'x' }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      parseDocument({
        kind: 'srt',
        bytes: new Uint8Array(MAX_DOCUMENT_BYTES + 1),
        sourceTitle: 'x',
      }),
    ).rejects.toMatchObject({ code: 'input_too_large' });
  });

  it('refuses an unknown kind', async () => {
    await expect(
      parseDocument({
        kind: 'exe' as unknown as 'pdf',
        bytes: new Uint8Array([1]),
        sourceTitle: 'x',
      }),
    ).rejects.toBeInstanceOf(IngestError);
  });
});

describe('parseWebLink', () => {
  const html = new TextDecoder().decode(bytesOf('html/plants-article.html'));

  it('fetches through the injected fetcher and parses with heading locators', async () => {
    const doc = await parseWebLink(PAGE, stubWebFetcher({ [PAGE]: html }), 'Plants');
    expect(doc.sourceTitle).toBe('Plants');
    expect(doc.units[0]).toEqual({
      locator: 'How Plants Make Food',
      text: 'Plants make their own food in a process called photosynthesis.',
    });
  });

  it('without a title it uses the page <title>, then the host', async () => {
    const titled = await parseWebLink(PAGE, stubWebFetcher({ [PAGE]: html }));
    expect(titled.sourceTitle).toBe('How Plants Make Food');
    const bare = await parseWebLink(PAGE, stubWebFetcher({ [PAGE]: '<p>x</p>' }), '  ');
    expect(bare).toEqual({
      sourceTitle: 'lessons.example.org',
      units: [{ locator: 'lessons.example.org', text: 'x' }],
    });
  });

  it('passes a fetch failure through unchanged', async () => {
    await expect(parseWebLink(PAGE, stubWebFetcher({}))).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
