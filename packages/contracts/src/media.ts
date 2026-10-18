// Media schemas for the Transcriber port (ADR-0005).
import { z } from 'zod';
import { count } from './formats.js';
import { LangSchema } from './shared.js';

/**
 * A recording to transcribe: an https signed URL from allowlisted storage (the adapter checks the
 * host; the URL is a bearer credential and never appears in logs or errors).
 */
export const TranscribeInputSchema = z.strictObject({
  url: z.url({ protocol: /^https$/ }),
  mimeType: z.string().regex(/^(audio|video)\//, 'audio/* or video/*'),
  languageHint: LangSchema.exactOptional(),
});
export type TranscribeInput = z.infer<typeof TranscribeInputSchema>;

export const TranscriptSegmentSchema = z.strictObject({
  startMs: count(),
  endMs: count(),
  text: z.string().min(1),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

/** Never empty: at least one segment, in order, inside the recording's duration. */
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
    });
    const last = t.segments.length - 1;
    const lastSegment = t.segments[last];
    if (lastSegment !== undefined && lastSegment.endMs > t.durationMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['segments', last, 'endMs'],
        message: 'last segment must end within durationMs',
      });
    }
  });
export type Transcript = z.infer<typeof TranscriptSchema>;
