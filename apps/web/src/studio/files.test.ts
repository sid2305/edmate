import { IngestJobSchema } from '@edmate/queue';
import { describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_UPLOAD_BYTES,
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_UNSPLIT_MEDIA_BYTES,
  UPLOAD_TYPES,
  isLinkKey,
  isRecordingType,
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

  it('maps caption files to transcript chunks at the document cap (task 8.2c)', () => {
    expect(uploadTypeFor('text/vtt')).toMatchObject({
      fileKind: 'vtt',
      chunkKind: 'transcript',
      maxBytes: MAX_DOCUMENT_UPLOAD_BYTES,
    });
    expect(uploadTypeFor('application/x-subrip')).toMatchObject({
      fileKind: 'srt',
      chunkKind: 'transcript',
      maxBytes: MAX_DOCUMENT_UPLOAD_BYTES,
    });
  });

  it('transcribe is true exactly for audio and video (task 8.2n: the rule lives on the type)', () => {
    for (const t of UPLOAD_TYPES) {
      expect(t.transcribe, t.contentType).toBe(t.fileKind === 'audio' || t.fileKind === 'video');
    }
    expect(uploadTypeFor('text/vtt')?.transcribe).toBe(false);
    expect(uploadTypeFor('application/x-subrip')?.transcribe).toBe(false);
    expect(uploadTypeFor('audio/mp4')?.transcribe).toBe(true);
  });

  it("every row's transcribe flag agrees with the queue's mimeType rule (task 8.2o)", () => {
    // `complete` builds the ingest job from `transcribe`; the queue's IngestJobSchema requires
    // `mimeType` exactly for audio/video. A row that disagrees would fail at run time as
    // enqueue_failed, so this pins every row to the queue's own parse.
    for (const t of UPLOAD_TYPES) {
      const base = { teacherId: 'tch_1', documentId: 'doc_1', fileKind: t.fileKind };
      const asBuilt = { ...base, ...(t.transcribe ? { mimeType: t.contentType } : {}) };
      expect(IngestJobSchema.safeParse(asBuilt).success, t.contentType).toBe(true);
      const flipped = { ...base, ...(t.transcribe ? {} : { mimeType: t.contentType }) };
      expect(IngestJobSchema.safeParse(flipped).success, t.contentType).toBe(false);
    }
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

describe('the fail-fast cap for media the worker cannot split (task 11.4 Phase B, Q3)', () => {
  it('pins MAX_UNSPLIT_MEDIA_BYTES to 24 MB', () => {
    expect(MAX_UNSPLIT_MEDIA_BYTES).toBe(24 * 1024 * 1024);
  });

  it('keeps the mp3/wav cap at 500 MB; m4a/mp4/webm get the 24 MB cap', () => {
    expect(uploadTypeFor('audio/mpeg')?.maxBytes).toBe(MAX_MEDIA_UPLOAD_BYTES);
    expect(uploadTypeFor('audio/wav')?.maxBytes).toBe(MAX_MEDIA_UPLOAD_BYTES);
    expect(uploadTypeFor('audio/mp4')?.maxBytes).toBe(MAX_UNSPLIT_MEDIA_BYTES);
    expect(uploadTypeFor('video/mp4')?.maxBytes).toBe(MAX_UNSPLIT_MEDIA_BYTES);
    expect(uploadTypeFor('video/webm')?.maxBytes).toBe(MAX_UNSPLIT_MEDIA_BYTES);
  });

  it('isRecordingType is true exactly for the transcript-kind types', () => {
    for (const t of UPLOAD_TYPES) {
      expect(isRecordingType(t)).toBe(t.chunkKind === 'transcript');
    }
    expect(isRecordingType(uploadTypeFor('application/pdf')!)).toBe(false);
    expect(isRecordingType(uploadTypeFor('text/vtt')!)).toBe(true);
    expect(isRecordingType(uploadTypeFor('audio/mpeg')!)).toBe(true);
    expect(isRecordingType(uploadTypeFor('video/mp4')!)).toBe(true);
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
