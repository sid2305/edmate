// Task 5.3 Phase D: @edmate/ingest's ChunkWriter is a local structural interface (ingest never
// imports db). This pins, at type level, that the chunks repository satisfies it as it is: if
// either side drifts, `tsc --noEmit` (the typecheck task) fails here.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ChunkWriter } from '@edmate/ingest';
import { createRepositories, type Repositories } from '../src/index.js';

/** Compiles only while the repository is assignable to the port. */
const asWriter = (chunks: Repositories['chunks']): ChunkWriter => chunks;

describe('ChunkWriter (ingest) and the chunks repository (db)', () => {
  it('the chunks repository is a ChunkWriter', () => {
    expectTypeOf<Repositories['chunks']>().toExtend<ChunkWriter>();
    // Building repositories runs no SQL; the handle is never touched.
    const writer = asWriter(createRepositories({} as never).chunks);
    expect(typeof writer.insertMany).toBe('function');
    expect(typeof writer.setEmbeddings).toBe('function');
  });
});
