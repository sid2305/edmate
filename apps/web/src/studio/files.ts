// Task 8.2 Phase 3: what a teacher may upload. One fixed table maps each allowed content type to
// the worker's file kind, the document's retrieval kind, a size cap and a file extension. The
// storage key is always built here, on the server; its extension names the upload type, so the
// complete route learns the type from the key it stored, never from the client.
import { randomUUID } from 'node:crypto';
import type { FileChunkKind } from '@edmate/db';
import { WHISPER_MAX_UPLOAD_BYTES } from '@edmate/gateway';
import type { IngestFileKind } from '@edmate/queue';

/** Ingest's own document limit (`MAX_DOCUMENT_BYTES` in @edmate/ingest): 20 MB. */
export const MAX_DOCUMENT_UPLOAD_BYTES = 20 * 1024 * 1024;
/**
 * Audio and video: 500 MB, below the Whisper transcriber's 600 MB download cap so a file that
 * uploads can always be fetched for transcription.
 */
export const MAX_MEDIA_UPLOAD_BYTES = 500 * 1024 * 1024;
/**
 * Task 11.4 Phase B (Q3): the worker composes `createWhisperTranscriber` with no chunker, so only
 * WAV and MP3 over `WHISPER_MAX_UPLOAD_BYTES` can be split before transcription. An M4A, MP4 or
 * WebM over this cap uploads today (the 500 MB media cap) and then fails minutes later as
 * `input_too_large`, after the download. This equals `@edmate/gateway`'s own Whisper cap, so the
 * two caps can never drift apart; a test pins the number too. A real fix is an ffmpeg chunker in
 * the worker image, tracked as board task 11.4d (M13; needs an ADR for the new system binary).
 */
export const MAX_UNSPLIT_MEDIA_BYTES = WHISPER_MAX_UPLOAD_BYTES;

/**
 * The retrieval kind an uploaded file can have: never `teacher_note` (those rows have no file).
 * Task 8.2o: the db package names it once (`documents.startReplace` takes the same type).
 */
export type { FileChunkKind };

export interface UploadType {
  contentType: string;
  ext: string;
  fileKind: IngestFileKind;
  chunkKind: FileChunkKind;
  maxBytes: number;
  /**
   * Task 8.2n: whether the worker must transcribe the file (audio and video) before it can be
   * read. The ingest job carries the stored media type only for these. A caption file is already
   * text, so it is a transcript by chunk kind but needs no transcription.
   */
  transcribe: boolean;
}

const doc = (contentType: string, ext: string, fileKind: IngestFileKind): UploadType => ({
  contentType,
  ext,
  fileKind,
  chunkKind: 'material',
  maxBytes: MAX_DOCUMENT_UPLOAD_BYTES,
  transcribe: false,
});
/** `splittable`: whether the worker's Whisper transcriber can split this type when it is large. */
const media = (
  contentType: string,
  ext: string,
  fileKind: IngestFileKind,
  splittable: boolean,
): UploadType => ({
  contentType,
  ext,
  fileKind,
  chunkKind: 'transcript',
  maxBytes: splittable ? MAX_MEDIA_UPLOAD_BYTES : MAX_UNSPLIT_MEDIA_BYTES,
  transcribe: true,
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
  transcribe: false,
});

export const UPLOAD_TYPES: readonly UploadType[] = [
  doc('application/pdf', 'pdf', 'pdf'),
  doc('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', 'docx'),
  doc('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx', 'pptx'),
  doc('text/markdown', 'md', 'markdown'),
  media('audio/mpeg', 'mp3', 'audio', true),
  media('audio/wav', 'wav', 'audio', true),
  media('audio/mp4', 'm4a', 'audio', false),
  media('video/mp4', 'mp4', 'video', false),
  media('video/webm', 'webm', 'video', false),
  // Task 8.2c: no IANA type exists for SubRip; `application/x-subrip` is the common convention
  // (decisions, risk: low). The client falls back to the extension when the browser reports none.
  caption('text/vtt', 'vtt', 'vtt'),
  caption('application/x-subrip', 'srt', 'srt'),
];

/** The upload type for an exact content type, or null (anything not on the list). */
export function uploadTypeFor(contentType: string): UploadType | null {
  return UPLOAD_TYPES.find((t) => t.contentType === contentType) ?? null;
}

/**
 * Task 11.4 Phase B: whether a type may carry `liveClassId` -- captions, audio and video, the
 * same types a class recording can be (the transcript-kind rows). A plain document (PDF, DOCX,
 * PPTX, Markdown) never links to a live class.
 */
export function isRecordingType(type: UploadType): boolean {
  return type.chunkKind === 'transcript';
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
