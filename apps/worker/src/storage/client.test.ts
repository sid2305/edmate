// Task 8.2 Phase 2: no real S3/network calls (rule 4) — `send` is a fake, and the sign function
// is injectable so no crypto or real client config is required either.
import { DeleteObjectCommand, GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { createStorageClient, ObjectTooLargeError } from './client.js';

/** A fake S3 body: an async iterable of `parts`, recording how many parts were pulled. */
function fakeBody(parts: Uint8Array[]) {
  const state = { pulled: 0, destroyed: false };
  const body = {
    async *[Symbol.asyncIterator]() {
      for (const p of parts) {
        state.pulled += 1;
        yield p;
      }
    },
    destroy() {
      state.destroyed = true;
    },
    transformToByteArray: () => Promise.reject(new Error('must stream, not buffer')),
  };
  return { body, state };
}

function streamClient(res: { Body?: unknown; ContentLength?: number }) {
  return { send: vi.fn(async () => res) } as unknown as S3Client;
}

function fakeClient(objects = new Map<string, Uint8Array>()) {
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof GetObjectCommand) {
      const bytes = objects.get(command.input.Key ?? '');
      if (bytes === undefined) return {};
      return { Body: fakeBody([bytes]).body };
    }
    if (command instanceof DeleteObjectCommand) {
      objects.delete(command.input.Key ?? '');
      return {};
    }
    throw new Error(`unexpected command ${String(command)}`);
  });
  return { send } as unknown as S3Client;
}

describe('createStorageClient', () => {
  describe('getObjectBytes', () => {
    it('returns the stored bytes', async () => {
      const objects = new Map([['docs/a.pdf', new TextEncoder().encode('hello')]]);
      const storage = createStorageClient(fakeClient(objects), 'edmate-dev');
      const bytes = await storage.getObjectBytes('docs/a.pdf', 100);
      expect(new TextDecoder().decode(bytes)).toBe('hello');
    });

    it('throws when the response has no body', async () => {
      const storage = createStorageClient(fakeClient(), 'edmate-dev');
      await expect(storage.getObjectBytes('docs/missing.pdf', 100)).rejects.toThrow('no body');
    });

    it('joins a multi-part stream, accepting exactly the cap', async () => {
      const { body } = fakeBody([new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3, 4])]);
      const storage = createStorageClient(streamClient({ Body: body }), 'b');
      expect([...(await storage.getObjectBytes('k', 4))]).toEqual([1, 2, 3, 4]);
    });

    it('refuses a ContentLength over the cap before reading any of the body', async () => {
      const { body, state } = fakeBody([new Uint8Array(10)]);
      const storage = createStorageClient(streamClient({ Body: body, ContentLength: 11 }), 'b');
      const err = await storage.getObjectBytes('k', 10).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ObjectTooLargeError);
      expect(state.pulled).toBe(0);
      expect(state.destroyed).toBe(true);
    });

    it('stops streaming once the running count passes the cap (no or a lying ContentLength)', async () => {
      for (const ContentLength of [undefined, 3]) {
        const parts = [new Uint8Array(4), new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)];
        const { body, state } = fakeBody(parts);
        const storage = createStorageClient(
          streamClient({ Body: body, ...(ContentLength === undefined ? {} : { ContentLength }) }),
          'b',
        );
        const err = await storage.getObjectBytes('k', 6).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ObjectTooLargeError);
        expect((err as ObjectTooLargeError).maxBytes).toBe(6);
        expect(state.pulled).toBe(2);
        expect(state.destroyed).toBe(true);
      }
    });

    it('never names the key or bucket in the too-large message', async () => {
      const storage = createStorageClient(
        streamClient({ Body: fakeBody([]).body, ContentLength: 99 }),
        'bucket-x',
      );
      const err = (await storage.getObjectBytes('uploads/secret.pdf', 1).catch((e: unknown) => e)) as Error;
      expect(err.message).not.toMatch(/secret|bucket-x/);
    });

    it('refuses a body that is not a stream', async () => {
      const storage = createStorageClient(streamClient({ Body: { nope: true } }), 'b');
      await expect(storage.getObjectBytes('k', 10)).rejects.toThrow('not a stream');
    });
  });

  describe('deleteObject', () => {
    it('sends a DeleteObjectCommand for the bucket and key', async () => {
      const client = fakeClient();
      const storage = createStorageClient(client, 'edmate-dev');
      await storage.deleteObject('docs/a.pdf');
      expect(client.send).toHaveBeenCalledWith(
        expect.objectContaining({ input: { Bucket: 'edmate-dev', Key: 'docs/a.pdf' } }),
      );
    });
  });

  describe('getSignedDownloadUrl', () => {
    it('signs a GetObjectCommand for the bucket, key and ttl through the injected signer', async () => {
      const client = fakeClient();
      const sign = vi.fn(async () => 'https://signed.example/docs/a.pdf?sig=1');
      const storage = createStorageClient(client, 'edmate-dev', sign);
      const url = await storage.getSignedDownloadUrl('docs/a.pdf', 300);
      expect(url).toBe('https://signed.example/docs/a.pdf?sig=1');
      expect(sign).toHaveBeenCalledTimes(1);
      const [signedClient, command, opts] = sign.mock.calls[0] as unknown as [
        unknown,
        GetObjectCommand,
        { expiresIn: number },
      ];
      expect(signedClient).toBe(client);
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(command.input).toEqual({ Bucket: 'edmate-dev', Key: 'docs/a.pdf' });
      expect(opts).toEqual({ expiresIn: 300 });
    });
  });
});
