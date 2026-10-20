// pdf.js failures that are hard to produce from a hand-made file (a password, an internal fault)
// are simulated by mocking the library; every one must surface as an IngestError with no detail.
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ error: undefined as unknown, destroyed: 0 }));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: () => ({
    promise: Promise.reject(state.error),
    destroy: () => {
      state.destroyed += 1;
      return Promise.resolve();
    },
  }),
}));

const { parsePdf } = await import('../../src/parse/pdf.js');

afterEach(() => {
  state.destroyed = 0;
});

describe('parsePdf, library failures', () => {
  it('a password-protected PDF says so', async () => {
    state.error = Object.assign(new Error('No password given'), { name: 'PasswordException' });
    const err = await parsePdf(new Uint8Array([1]), 'Locked').catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'IngestError', code: 'validation' });
    expect((err as Error).message).toMatch(/password/);
    expect(state.destroyed).toBe(1);
  });

  it('any other failure is a plain "could not be read", with no library text kept', async () => {
    state.error = 'secret internal detail';
    const err = await parsePdf(new Uint8Array([1]), 'Odd').catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'IngestError', code: 'validation' });
    expect(JSON.stringify(err)).not.toContain('secret');
    expect(state.destroyed).toBe(1);
  });
});
