import { describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_UPLOAD_BYTES,
  MAX_MEDIA_UPLOAD_BYTES,
  UPLOAD_TYPES,
  isLinkKey,
  newLinkKey,
  newStorageKey,
  uploadTypeFor,
  uploadTypeOfKey,
} from './files';

describe('upload types', () => {
  it('maps every allowed content type to a file kind, a chunk kind and a cap', () => {
    expect(uploadTypeFor('application/pdf')).toMatchObject({
      fileKind: 'pdf',
      chunkKind: 'material',
      maxBytes: MAX_DOCUMENT_UPLOAD_BYTES,
    });
    expect(uploadTypeFor('text/markdown')?.fileKind).toBe('markdown');
    expect(uploadTypeFor('audio/mpeg')).toMatchObject({
      fileKind: 'audio',
      chunkKind: 'transcript',
      maxBytes: MAX_MEDIA_UPLOAD_BYTES,
    });
    expect(uploadTypeFor('video/mp4')?.fileKind).toBe('video');
  });

  it('refuses anything not on the list, including near misses', () => {
    for (const t of ['text/html', 'image/svg+xml', 'application/PDF', 'application/pdf; x=1', '']) {
      expect(uploadTypeFor(t)).toBeNull();
    }
  });

  it('has a unique extension per type, so a key names its type', () => {
    const exts = UPLOAD_TYPES.map((t) => t.ext);
    expect(new Set(exts).size).toBe(exts.length);
  });

  it('keeps the document cap at the ingest limit (20 MB)', () => {
    expect(MAX_DOCUMENT_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_MEDIA_UPLOAD_BYTES).toBeLessThan(600_000_000);
  });
});

describe('storage keys', () => {
  it('are built on the server under the teacher and document, with a fresh random part', () => {
    const type = uploadTypeFor('application/pdf')!;
    const a = newStorageKey('t_1', 'doc_1', type);
    const b = newStorageKey('t_1', 'doc_1', type);
    expect(a).toMatch(/^teachers\/t_1\/documents\/doc_1\/[0-9a-f-]{36}\.pdf$/);
    expect(a).not.toBe(b);
  });

  it('read back their upload type, and refuse anything else', () => {
    const type = uploadTypeFor('video/webm')!;
    expect(uploadTypeOfKey(newStorageKey('t_1', 'd', type))).toBe(type);
    expect(uploadTypeOfKey('teachers/t_1/documents/d/x.exe')).toBeNull();
    expect(uploadTypeOfKey('noextension')).toBeNull();
  });
});

describe('link keys (task 8.2f)', () => {
  it('builds a stable key under the teacher and document, with no upload type', () => {
    const key = newLinkKey('t_1', 'doc_1');
    expect(key).toBe('teachers/t_1/documents/doc_1.link');
    expect(uploadTypeOfKey(key)).toBeNull();
  });

  it('is recognised by isLinkKey and nothing else is', () => {
    expect(isLinkKey(newLinkKey('t_1', 'doc_1'))).toBe(true);
    const fileType = uploadTypeFor('application/pdf')!;
    expect(isLinkKey(newStorageKey('t_1', 'doc_1', fileType))).toBe(false);
    expect(isLinkKey('noextension')).toBe(false);
  });
});
