import type { ModelGateway, TranscribeInput, Transcriber, Transcript } from '@edmate/contracts';
import { manualClock, ScriptedGateway, type GatewayScript } from '@edmate/harness/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IngestError } from '../../src/errors.js';
import {
  EMBED_BATCH_SIZE,
  EMBEDDING_DIMENSIONS,
  indexDocument,
  MAX_CHUNKS_PER_DOCUMENT,
  WRITE_BATCH_SIZE,
} from '../../src/index/indexDocument.js';
import type { ChunkDraft, ChunkWriter } from '../../src/index/types.js';
import { hashedEmbedder, hashedEmbedding } from '../../src/testing/hashedEmbedder.js';
import type { ParsedDocument } from '../../src/types.js';

const scope = { teacherId: 'teacher-a' };
const scripted = (script: GatewayScript): ScriptedGateway =>
  new ScriptedGateway(script, manualClock());
const LOCKED_TEXT = 'locked-answer-text-do-not-leak';

interface RecordingWriter extends ChunkWriter {
  inserts: { scope: { teacherId: string }; documentId: string; drafts: ChunkDraft[] }[];
  embeddings: { id: string; embedding: number[] }[][];
}

function recordingWriter(): RecordingWriter {
  const w: RecordingWriter = {
    inserts: [],
    embeddings: [],
    insertMany(s, documentId, drafts) {
      w.inserts.push({ scope: s, documentId, drafts });
      return Promise.resolve({
        ids: drafts.map((d) => `${documentId}-c${String(d.ord).padStart(4, '0')}`),
      });
    },
    setEmbeddings(_s, items) {
      w.embeddings.push(items);
      return Promise.resolve({ updated: items.length });
    },
  };
  return w;
}

/** A parsed document of n one-sentence pages, so it chunks to exactly n drafts. */
function pages(n: number): { kind: 'parsed'; document: ParsedDocument; headings: false } {
  return {
    kind: 'parsed',
    headings: false,
    document: {
      sourceTitle: 'Deck',
      units: Array.from({ length: n }, (_, i) => ({
        text: `Fact number ${String(i)}.`,
        locator: `page ${String(i + 1)}`,
      })),
    },
  };
}

function countingEmbedder(inner: Pick<ModelGateway, 'embed'>) {
  const calls: number[] = [];
  return {
    calls,
    embed(texts: string[]) {
      calls.push(texts.length);
      return inner.embed(texts);
    },
  };
}

const recording: TranscribeInput = {
  url: 'https://storage.edmate.invalid/recordings/live-class.mp3?X-Amz-Signature=fake0sig',
  mimeType: 'audio/mpeg',
};

function transcript(
  segments: readonly { startMs: number; endMs: number; text: string }[],
  durationMs: number,
): Transcript {
  return {
    text: segments.map((s) => s.text).join(' '),
    language: 'en',
    durationMs,
    segments: [...segments],
  };
}

function fakeTranscriber(result: Transcript | Error): Transcriber & { calls: TranscribeInput[] } {
  const calls: TranscribeInput[] = [];
  return {
    calls,
    transcribe(i: TranscribeInput) {
      calls.push(i);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('indexDocument', () => {
  it('parses, chunks, stores and embeds a Markdown document end to end', async () => {
    const writer = recordingWriter();
    const md = '# Fractions\n\nA fraction names part of a whole.\n\n## Halves\n\nTwo equal parts.';
    const result = await indexDocument(
      { writer, embedder: hashedEmbedder() },
      {
        scope,
        documentId: 'doc-1',
        source: { kind: 'markdown', bytes: new TextEncoder().encode(md), sourceTitle: 'Maths' },
      },
    );
    expect(result).toEqual({ chunks: 2, embedded: true, embeddedChunks: 2 });
    expect(writer.inserts).toEqual([
      {
        scope,
        documentId: 'doc-1',
        drafts: [
          { ord: 0, text: 'Fractions\nA fraction names part of a whole.', locator: 'Fractions' },
          { ord: 1, text: 'Halves\nTwo equal parts.', locator: 'Fractions > Halves' },
        ],
      },
    ]);
    expect(writer.embeddings).toEqual([
      [
        { id: 'doc-1-c0000', embedding: hashedEmbedding(writer.inserts[0]?.drafts[0]?.text ?? '') },
        { id: 'doc-1-c0001', embedding: hashedEmbedding(writer.inserts[0]?.drafts[1]?.text ?? '') },
      ],
    ]);
  });

  it(`embeds in batches of ${String(EMBED_BATCH_SIZE)}: 97 chunks are 2 calls (ScriptedGateway)`, async () => {
    const texts = Array.from({ length: 97 }, (_, i) => `Fact number ${String(i)}.`);
    const gateway = scripted({
      embed: [
        { vectors: texts.slice(0, 96).map(hashedEmbedding) },
        { vectors: texts.slice(96).map(hashedEmbedding) },
      ],
    });
    const embedder = countingEmbedder(gateway);
    const writer = recordingWriter();
    const result = await indexDocument(
      { writer, embedder },
      { scope, documentId: 'doc-2', source: pages(97) },
    );
    expect(embedder.calls).toEqual([96, 1]);
    expect(result).toEqual({ chunks: 97, embedded: true, embeddedChunks: 97 });
    expect(writer.embeddings.map((b) => b.length)).toEqual([96, 1]);
    expect(writer.embeddings[1]?.[0]?.id).toBe('doc-2-c0096');
  });

  it(`writes at most ${String(WRITE_BATCH_SIZE)} chunks per call, ords running on`, async () => {
    const writer = recordingWriter();
    const result = await indexDocument(
      { writer },
      { scope, documentId: 'doc-3', source: pages(WRITE_BATCH_SIZE * 2 + 1) },
    );
    expect(writer.inserts.map((c) => c.drafts.length)).toEqual([500, 500, 1]);
    expect(writer.inserts[1]?.drafts[0]?.ord).toBe(500);
    expect(writer.inserts[2]?.drafts[0]?.ord).toBe(1000);
    expect(result).toEqual({ chunks: 1001, embedded: false, embeddedChunks: 0 });
    expect(writer.embeddings).toEqual([]);
  });

  it(`refuses a document over ${String(MAX_CHUNKS_PER_DOCUMENT)} chunks before writing anything`, async () => {
    const writer = recordingWriter();
    const err = await indexDocument(
      { writer },
      { scope, documentId: 'doc-4', source: pages(MAX_CHUNKS_PER_DOCUMENT + 1) },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect((err as IngestError).code).toBe('input_too_large');
    expect(writer.inserts).toEqual([]);
  });

  it('a parse error rejects as the IngestError, nothing written', async () => {
    const writer = recordingWriter();
    const err = await indexDocument(
      { writer },
      {
        scope,
        documentId: 'doc-5',
        source: { kind: 'markdown', bytes: new Uint8Array(), sourceTitle: 'Empty' },
      },
    ).catch((e: unknown) => e);
    expect((err as IngestError).code).toBe('validation');
    expect(writer.inserts).toEqual([]);
  });

  it('a parsed document with only blank text is a validation error, nothing written', async () => {
    const writer = recordingWriter();
    const err = await indexDocument(
      { writer },
      {
        scope,
        documentId: 'doc-5b',
        source: {
          kind: 'parsed',
          headings: true,
          document: { sourceTitle: 'Blank', units: [{ text: ' \n ', locator: 'Blank' }] },
        },
      },
    ).catch((e: unknown) => e);
    expect((err as IngestError).code).toBe('validation');
    expect(writer.inserts).toEqual([]);
  });

  it('5.6a: refuses a question-bank source, writer and embedder never called', async () => {
    const writer = recordingWriter();
    const embedder = countingEmbedder(hashedEmbedder());
    const err = await indexDocument(
      { writer, embedder },
      {
        scope,
        documentId: 'doc-bank',
        source: {
          kind: 'markdown',
          bytes: new TextEncoder().encode('- id: q1\n  question: |\n    What is a loop?\n  answer: |\n    do-not-leak-this-key\n'),
          sourceTitle: 'content/demo-teacher/question-bank/loops.yaml',
        },
      },
    ).catch((e: unknown) => e);
    expect((err as IngestError).code).toBe('validation');
    expect(writer.inserts).toEqual([]);
    expect(embedder.calls).toEqual([]);
    const json = JSON.stringify((err as IngestError).toJSON());
    expect(json).not.toContain('do-not-leak-this-key');
  });

  describe('embedding failure leaves NULL embeddings and never throws', () => {
    const cases: [string, Pick<ModelGateway, 'embed'>, 'embed_failed' | 'embed_malformed'][] = [
      ['rejects', { embed: () => Promise.reject(new Error(LOCKED_TEXT)) }, 'embed_failed'],
      [
        'throws synchronously',
        {
          embed: () => {
            throw new Error(LOCKED_TEXT);
          },
        },
        'embed_failed',
      ],
      ['scripted gateway runs out', scripted({ embed: [] }), 'embed_failed'],
      ['returns too few vectors', { embed: () => Promise.resolve([]) }, 'embed_malformed'],
      ['returns a non-array', { embed: () => Promise.resolve(null as never) }, 'embed_malformed'],
      [
        'returns the wrong dimension',
        { embed: (t) => Promise.resolve(t.map(() => [1, 0, 0])) },
        'embed_malformed',
      ],
      [
        'returns a NaN',
        {
          embed: (t) =>
            Promise.resolve(t.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, () => NaN))),
        },
        'embed_malformed',
      ],
    ];
    for (const [name, embedder, code] of cases) {
      it(`when the embedder ${name}`, async () => {
        const logs = [
          vi.spyOn(console, 'error'),
          vi.spyOn(console, 'warn'),
          vi.spyOn(console, 'log'),
        ];
        const writer = recordingWriter();
        const seen: string[] = [];
        const result = await indexDocument(
          { writer, embedder, onEmbedFailed: (c) => seen.push(c) },
          { scope, documentId: 'doc-6', source: pages(3) },
        );
        expect(result).toEqual({ chunks: 3, embedded: false, embeddedChunks: 0 });
        expect(writer.inserts).toHaveLength(1);
        expect(writer.embeddings).toEqual([]);
        expect(seen).toEqual([code]);
        for (const l of logs) expect(l).not.toHaveBeenCalled();
      });
    }

    it('keeps the batches already embedded when a later one fails', async () => {
      const gateway = scripted({
        embed: [
          { vectors: Array.from({ length: 96 }, (_, i) => hashedEmbedding(String(i))) },
        ],
      });
      const writer = recordingWriter();
      const result = await indexDocument(
        { writer, embedder: gateway },
        { scope, documentId: 'doc-7', source: pages(100) },
      );
      expect(result).toEqual({ chunks: 100, embedded: false, embeddedChunks: 96 });
      expect(writer.embeddings.map((b) => b.length)).toEqual([96]);
    });
  });

  describe('a video source', () => {
    it('transcribes, chunks, stores and embeds like a parsed source', async () => {
      const t = transcript(
        [
          { startMs: 0, endMs: 1_000, text: 'Hello class.' },
          { startMs: 95_000, endMs: 96_000, text: 'Second window now.' },
        ],
        100_000,
      );
      const transcriber = fakeTranscriber(t);
      const writer = recordingWriter();
      const result = await indexDocument(
        { writer, embedder: hashedEmbedder(), transcriber },
        {
          scope,
          documentId: 'vid-1',
          source: { kind: 'video', sourceTitle: 'Live class', recording },
        },
      );
      expect(transcriber.calls).toEqual([recording]);
      expect(result).toEqual({ chunks: 2, embedded: true, embeddedChunks: 2 });
      expect(writer.inserts).toEqual([
        {
          scope,
          documentId: 'vid-1',
          drafts: [
            { ord: 0, text: 'Hello class.', locator: '0:00' },
            { ord: 1, text: 'Second window now.', locator: '1:30' },
          ],
        },
      ]);
    });

    it('no transcriber configured is a clear validation error, nothing written', async () => {
      const writer = recordingWriter();
      const err = await indexDocument(
        { writer },
        {
          scope,
          documentId: 'vid-2',
          source: { kind: 'video', sourceTitle: 'Live class', recording },
        },
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(IngestError);
      expect((err as IngestError).code).toBe('validation');
      expect(writer.inserts).toEqual([]);
    });

    it('a transcriber rejection becomes a fixed, non-leaking IngestError', async () => {
      const transcriber = fakeTranscriber(new Error(`provider said: ${LOCKED_TEXT}`));
      const writer = recordingWriter();
      const err = await indexDocument(
        { writer, transcriber },
        {
          scope,
          documentId: 'vid-3',
          source: { kind: 'video', sourceTitle: 'Live class', recording },
        },
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(IngestError);
      const e = err as IngestError;
      expect(e.code).toBe('provider_error');
      expect(e.retryable).toBe(true);
      expect(e.cause).toBeUndefined();
      expect(e.stack).not.toContain(LOCKED_TEXT);
      expect(JSON.stringify(e)).not.toContain(LOCKED_TEXT);
      expect(writer.inserts).toEqual([]);
    });
  });

  describe('a writer rejection becomes a fixed IngestError with nothing of the cause', () => {
    const fail = (): Promise<never> => Promise.reject(new Error(`db said: ${LOCKED_TEXT}`));
    const cases: [string, (w: RecordingWriter) => void][] = [
      ['insertMany rejects', (w) => (w.insertMany = fail)],
      ['setEmbeddings rejects', (w) => (w.setEmbeddings = fail)],
      [
        'insertMany returns the wrong number of ids',
        (w) => (w.insertMany = () => Promise.resolve({ ids: ['only-one'] })),
      ],
    ];
    for (const [name, breakIt] of cases) {
      it(name, async () => {
        const writer = recordingWriter();
        breakIt(writer);
        const err = await indexDocument(
          { writer, embedder: hashedEmbedder() },
          { scope, documentId: 'doc-8', source: pages(2) },
        ).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(IngestError);
        const e = err as IngestError;
        expect(e.code).toBe('provider_error');
        expect(e.retryable).toBe(false);
        expect(e.message).toBe('ingest: the chunks could not be stored');
        expect(e.cause).toBeUndefined();
        expect(JSON.stringify(e)).not.toContain(LOCKED_TEXT);
      });
    }
  });
});
