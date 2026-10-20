import { describe, expect, it } from 'vitest';
import { MAX_UNZIPPED_BYTES, openZip } from '../../src/parse/zip.js';
import { zip } from '../fixtures/make-fixtures.js';

describe('openZip', () => {
  it('lists file entries and reads them as text', async () => {
    const z = await openZip(
      await zip([
        ['a.xml', '<a>one</a>'],
        ['dir/b.xml', 'two'],
      ]),
      'test',
    );
    expect(z.names()).toEqual(['a.xml', 'dir/b.xml']);
    expect(z.has('dir/b.xml')).toBe(true);
    expect(z.has('missing.xml')).toBe(false);
    await expect(z.text('a.xml')).resolves.toBe('<a>one</a>');
  });

  it('a missing entry is a validation error naming the format, not the entry', async () => {
    const z = await openZip(await zip([['a.xml', 'x']]), 'DOCX');
    const err = await z.text('word/document.xml').catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'IngestError', code: 'validation' });
    expect((err as Error).message).toMatch(/DOCX/);
  });

  it('bytes that are not a zip are a validation error', async () => {
    await expect(openZip(new Uint8Array([1, 2, 3, 4]), 'PPTX')).rejects.toMatchObject({
      name: 'IngestError',
      code: 'validation',
      message: expect.stringMatching(/PPTX/) as unknown,
    });
  });

  it('stops inflating once the unzipped-bytes budget is spent (zip bomb)', async () => {
    const bomb = await zip([['big.xml', 'a'.repeat(200_000)]]);
    expect(bomb.byteLength).toBeLessThan(2_000);
    const z = await openZip(bomb, 'DOCX', 50_000);
    await expect(z.text('big.xml')).rejects.toMatchObject({ code: 'input_too_large' });
  });

  it('the budget is shared by every read from one file', async () => {
    const z = await openZip(
      await zip([
        ['one.xml', 'a'.repeat(600)],
        ['two.xml', 'b'.repeat(600)],
      ]),
      'PPTX',
      1_000,
    );
    await expect(z.text('one.xml')).resolves.toHaveLength(600);
    await expect(z.text('two.xml')).rejects.toMatchObject({ code: 'input_too_large' });
  });

  it('checkAll inflates every entry against the budget', async () => {
    const files = await zip([
      ['one.xml', 'a'.repeat(600)],
      ['two.xml', 'b'.repeat(600)],
    ]);
    await expect((await openZip(files, 'DOCX', 2_000)).checkAll()).resolves.toBeUndefined();
    await expect((await openZip(files, 'DOCX', 1_000)).checkAll()).rejects.toMatchObject({
      code: 'input_too_large',
    });
  });

  it('a corrupt entry is a validation error', async () => {
    let x = 7;
    const noise = Array.from({ length: 5_000 }, () => {
      x = (x * 1_103_515_245 + 12_345) % 2_147_483_648;
      return String.fromCharCode(97 + (x % 26));
    }).join('');
    const good = await zip([['a.xml', noise]]);
    // Damage the deflate stream in the middle of the entry, leaving the directory intact.
    const bad = good.slice();
    for (let i = 60; i < 120; i++) bad[i] = 0xff;
    const z = await openZip(bad, 'DOCX');
    await expect(z.text('a.xml')).rejects.toMatchObject({ code: 'validation' });
  });

  it('the default budget is five times the document cap', () => {
    expect(MAX_UNZIPPED_BYTES).toBe(100 * 1024 * 1024);
  });
});
