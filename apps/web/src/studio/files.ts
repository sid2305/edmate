// Task 8.2 Phase 3: what a teacher may upload. One fixed table maps each allowed content type to
// the worker's file kind, the document's retrieval kind, a size cap and a file extension. The
// storage key is always built here, on the server; its extension names the upload type, so the
// complete route learns the type from the key it stored, never from the client.
import { randomUUID } from 'node:crypto';
import type { ChunkKind } from '@edmate/contracts';
import type { IngestFileKind } from '@edmate/queue';

/** Ingest's own document limit (`MAX_DOCUMENT_BYTES` in @edmate/ingest): 20 MB. */
export const MAX_DOCUMENT_UPLOAD_BYTES = 20 * 1024 * 1024;
/**
 * Audio and video: 500 MB, below the Whisper transcriber's 600 MB download cap so a file that
 * uploads can always be fetched for transcription.
 */
export const MAX_MEDIA_UPLOAD_BYTES = 500 * 1024 * 1024;

export interface UploadType {
  contentType: string;
  ext: string;
  fileKind: IngestFileKind;
  chunkKind: ChunkKind;
  maxBytes: number;
}

const doc = (contentType: string, ext: string, fileKind: IngestFileKind): UploadType => ({
  contentType,
  ext,
  fileKind,
  chunkKind: 'material',
  maxBytes: MAX_DOCUMENT_UPLOAD_BYTES,
});
const media = (contentType: string, ext: string, fileKind: IngestFileKind): UploadType => ({
  contentType,
  ext,
  fileKind,
  chunkKind: 'transcript',
  maxBytes: MAX_MEDIA_UPLOAD_BYTES,
});
/**
 * Task 8.2c, Phase C: a caption file (.vtt or .srt) the teacher exports from YouTube Studio.
 * Chunk kind `transcript` (Q2): a citation reads as a recording with a timestamp, the same as
 * audio and video. Cap is the ordinary 20 MB document limit (Q3): a third, smaller limit would
 * add complexity a usually-sub-1 MB caption file doesn't need.
 */
const caption = (contentType: string, ext: string, fileKind: IngestFileKind): UploadType => ({
  contentType,
  ext,
  fileKind,
  chunkKind: 'transcript',
  maxBytes: MAX_DOCUMENT_UPLOAD_BYTES,
});

export const UPLOAD_TYPES: readonly UploadType[] = [
  doc('application/pdf', 'pdf', 'pdf'),
  doc('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', 'docx'),
  doc('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx', 'pptx'),
  doc('text/markdown', 'md', 'markdown'),
  media('audio/mpeg', 'mp3', 'audio'),
  media('audio/wav', 'wav', 'audio'),
  media('audio/mp4', 'm4a', 'audio'),
  media('video/mp4', 'mp4', 'video'),
  media('video/webm', 'webm', 'video'),
  // Task 8.2c: no IANA type exists for SubRip; `application/x-subrip` is the common convention
  // (decisions, risk: low). The client falls back to the extension when the browser reports none.
  caption('text/vtt', 'vtt', 'vtt'),
  caption('application/x-subrip', 'srt', 'srt'),
];

/** The upload type for an exact content type, or null (anything not on the list). */
export function uploadTypeFor(contentType: string): UploadType | null {
  return UPLOAD_TYPES.find((t) => t.contentType === contentType) ?? null;
}

/** `teachers/<teacherId>/documents/<documentId>/<random>.<ext>`, built only on the server. */
export function newStorageKey(teacherId: string, documentId: string, type: UploadType): string {
  return `teachers/${teacherId}/documents/${documentId}/${randomUUID()}.${type.ext}`;
}

/** The upload type a key was built for (by its extension), or null. */
export function uploadTypeOfKey(key: string): UploadType | null {
  const dot = key.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = key.slice(dot + 1);
  return UPLOAD_TYPES.find((t) => t.ext === ext) ?? null;
}

/**
 * Task 8.2f: a web link's storage key. `.link` is not in `UPLOAD_TYPES`, so `uploadTypeOfKey`
 * returns null for it -- `complete` already refuses a link (400) with no change, and `.link` can
 * never collide with a file extension. No random part: a document has at most one link, keyed by
 * its own id (the random part on file keys is there only to let a replace's old and new key
 * differ while `storageKey` is briefly both).
 */
export function newLinkKey(teacherId: string, documentId: string): string {
  return `teachers/${teacherId}/documents/${documentId}.link`;
}

/** Whether a storage key is a web link's (not an uploaded file's). */
export function isLinkKey(key: string): boolean {
  return key.endsWith('.link');
}
