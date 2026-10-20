// Reading DOCX and PPTX containers (both are zip files) with a cap on how much may be inflated.
// The 20 MB upload cap bounds the compressed size only; a zip bomb inflates a few kilobytes into
// gigabytes. Every read here streams the entry and stops as soon as the file's shared budget of
// unzipped bytes is spent. Nothing is written to disk, so entry names cannot escape anywhere.
import JSZip from 'jszip';
import { IngestError } from '../errors.js';
import { MAX_DOCUMENT_BYTES } from '../types.js';

/** Five times the document cap: room for real Office files, far below a bomb. */
export const MAX_UNZIPPED_BYTES = 5 * MAX_DOCUMENT_BYTES;

/** jszip's streaming reader: present at runtime, missing from its type declarations. */
interface Streamable {
  internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
}

export interface ZipFile {
  /** Every file entry (no folders), in zip order. */
  names(): string[];
  has(name: string): boolean;
  /** The entry as UTF-8 text; IngestError('validation') if missing or corrupt. */
  text(name: string): Promise<string>;
  /** Inflates every entry against the budget without keeping it (a check before another reader). */
  checkAll(): Promise<void>;
}

export async function openZip(
  bytes: Uint8Array,
  what: string,
  limit: number = MAX_UNZIPPED_BYTES,
): Promise<ZipFile> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new IngestError('validation', false, `the file could not be read as a ${what}`);
  }
  let remaining = limit;
  const files = Object.values(zip.files).filter((f) => !f.dir);

  function inflate(file: JSZip.JSZipObject, keep: boolean): Promise<Uint8Array[]> {
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      const stream = (file as unknown as Streamable).internalStream('uint8array');
      stream
        .on('data', (chunk) => {
          remaining -= chunk.byteLength;
          if (remaining < 0) {
            stream.pause();
            reject(
              new IngestError(
                'input_too_large',
                false,
                `the ${what} file unpacks to more than the ${String(limit)}-byte limit`,
              ),
            );
          } else if (keep) chunks.push(chunk);
        })
        .on('error', () => {
          reject(new IngestError('validation', false, `the ${what} file is damaged`));
        })
        .on('end', () => {
          resolve(chunks);
        })
        .resume();
    });
  }

  return {
    names: () => files.map((f) => f.name),
    has: (name) => files.some((f) => f.name === name),
    async text(name) {
      const file = files.find((f) => f.name === name);
      if (file === undefined) {
        throw new IngestError('validation', false, `the ${what} file is missing a required part`);
      }
      return Buffer.concat(await inflate(file, true)).toString('utf8');
    },
    async checkAll() {
      for (const file of files) await inflate(file, false);
    },
  };
}
