// Media schemas for the Transcriber port (ADR-0005).
import { z } from 'zod';
import { count } from './formats.js';
import { LangSchema } from './shared.js';

/**
 * `https://host[:port]` then an optional path, query or fragment: lower-case scheme, no userinfo,
 * no whitespace or backslash in the authority, nothing around the URL (fix round 1).
 */
const HTTPS_URL = /^https:\/\/[^\s/?#@\\]+(?:[/?#]\S*)?$/;
/** A top-level type, `/` and a non-empty RFC 6838 subtype, without parameters. */
const MEDIA_MIME = /^(?:audio|video)\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;

/**
 * A recording to transcribe: an https signed URL to Edmate's own storage. The URL is a bearer
 * credential: it never appears in logs, traces or errors (redact to scheme://host/path). The host
 * allowlist is not a contract: the Transcriber adapter takes `allowedHosts: readonly string[]`
 * from the composition root's config, matches the parsed URL's host exactly, follows no redirect to
 * another host, and refuses everything when the list is empty (ADR-0005).
 */
export const TranscribeInputSchema = z.strictObject({
  // The shape check runs first: `z.url` trims its input, so on its own it would accept " https://…".
  url: z
    .string()
    .regex(HTTPS_URL, 'https://host/path, no userinfo')
    .pipe(z.url({ protocol: /^https$/ })),
  mimeType: z.string().regex(MEDIA_MIME, 'audio/<subtype> or video/<subtype>'),
  languageHint: LangSchema.exactOptional(),
});
export type TranscribeInput = z.infer<typeof TranscribeInputSchema>;

export const TranscriptSegmentSchema = z.strictObject({
  startMs: count(),
  endMs: count(),
  text: z.string().min(1),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

/** Never empty: at least one segment, starts in order, every segment inside the duration. */
export const TranscriptSchema = z
  .strictObject({
    text: z.string().min(1),
    language: LangSchema.exactOptional(),
    durationMs: count(),
    segments: z.array(TranscriptSegmentSchema).min(1),
  })
  .superRefine((t, ctx) => {
    t.segments.forEach((s, i) => {
      if (s.endMs < s.startMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['segments', i, 'endMs'],
          message: 'endMs must be at least startMs',
        });
      }
      const prev = t.segments[i - 1];
      if (prev !== undefined && s.startMs < prev.startMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['segments', i, 'startMs'],
          message: 'segment starts must not go backwards',
        });
      }
      // Every end, not only the last: overlapping segments can end after a later one.
      if (s.endMs > t.durationMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['segments', i, 'endMs'],
          message: 'segments must end within durationMs',
        });
      }
    });
  });
export type Transcript = z.infer<typeof TranscriptSchema>;
