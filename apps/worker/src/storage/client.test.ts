// Task 8.2 Phase 2: no real S3/network calls (rule 4) — `send` is a fake, and the sign function
// is injectable so no crypto or real client config is required either.
import { DeleteObjectCommand, GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { createStorageClient } from './client.js';

function fakeClient(objects = new Map<string, Uint8Array>()) {
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof GetObjectCommand) {
      const bytes = objects.get(command.input.Key ?? '');
      if (bytes === undefined) return {};
      return { Body: { transformToByteArray: async () => bytes } };
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
      const bytes = await storage.getObjectBytes('docs/a.pdf');
      expect(new TextDecoder().decode(bytes)).toBe('hello');
    });

    it('throws when the response has no body', async () => {
      const storage = createStorageClient(fakeClient(), 'edmate-dev');
      await expect(storage.getObjectBytes('docs/missing.pdf')).rejects.toThrow('no body');
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
