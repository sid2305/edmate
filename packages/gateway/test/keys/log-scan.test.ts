// Task 2.1 acceptance: "a log-scan test proves no key appears in logs, traces or API responses."
// Real ProviderKeys are loaded from an env object holding a fresh fake key, then the keys object,
// the Secret, objects holding them and errors built around them go through every sink: a real
// Pino logger, a real Node Console, a trace recorder and Fetch API responses. Each sink's output
// is scanned for any 8-character fragment of the key. A positive control sends the revealed
// value through the same sinks and the same scan, which must find it, so the scan is not vacuous.
import { Console } from 'node:console';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { beforeAll, describe, expect, it } from 'vitest';
import { KeyConfigError, loadProviderKeys, type ProviderKeys } from '../../src/keys/load.js';
import { PROVIDER_KEYS } from '../../src/keys/providers.js';
import type { Secret } from '../../src/keys/secret.js';
import { envKeySource, type KeySource } from '../../src/keys/source.js';
import { fakeKey, leaks } from '../helpers/fake-key.js';

const VAR = PROVIDER_KEYS['openai-compatible'].apiKey.variable;

type Payload = Readonly<Record<string, unknown>>;
type Sink = (payload: Payload) => Promise<string>;

function memoryStream(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, text: () => chunks.join('') };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** An API error body the way a route handler would build one. */
function errorBody(value: unknown): unknown {
  if (value instanceof Error)
    return { error: { ...value, name: value.name, message: value.message } };
  return { error: String(value) };
}

const sinks: Readonly<Record<string, Sink>> = {
  // Logs: a real Pino logger writing to memory, with its standard err serializer.
  async pino(payload) {
    const { stream, text } = memoryStream();
    const log = pino({ level: 'trace' }, stream);
    log.info(payload);
    for (const [name, value] of Object.entries(payload)) {
      const v = value as object;
      log.info({ [name]: v }, `logging ${name}: %s %o %j`, v, v, v);
      log.error({ err: value }, `failed: ${String(value)}`);
      log.debug({ nested: { deep: [value] } });
    }
    await flush();
    return text();
  },

  // Logs: a real Node Console (the same formatting as console.log/info/warn/error/debug).
  async console(payload) {
    const { stream, text } = memoryStream();
    const c = new Console({ stdout: stream, stderr: stream });
    for (const value of Object.values(payload)) {
      c.log(value);
      c.info('%s %o %O %j', value, value, value, value);
      c.warn({ value });
      c.error(value);
      c.debug(`${String(value)}`);
      c.dir(value, { depth: Infinity, showHidden: true });
    }
    await flush();
    return text();
  },

  // Traces: a TraceSink-style recorder that serialises whatever it is given.
  async trace(payload) {
    const records: string[] = [];
    const recorder = { record: (trace: unknown) => records.push(JSON.stringify(trace)) };
    recorder.record({ turnId: 'turn-1', spans: [{ name: 'model.call', attributes: payload }] });
    return records.join('\n');
  },

  // API responses: Response.json, a hand-built JSON body and error bodies.
  async response(payload) {
    const bodies = [
      await Response.json(payload).text(),
      await new Response(JSON.stringify({ data: payload })).text(),
      ...(await Promise.all(Object.values(payload).map((v) => Response.json(errorBody(v)).text()))),
    ];
    return bodies.join('\n');
  },
};

describe('log scan: no provider key appears in logs, traces or API responses', () => {
  let key: string;
  let keys: ProviderKeys;
  let secret: Secret;
  let safePayload: Payload;

  beforeAll(async () => {
    key = fakeKey();
    keys = await loadProviderKeys({
      source: envKeySource({ [VAR]: key }),
      required: ['openai-compatible'],
    });
    secret = keys.get('openai-compatible').apiKey;

    // An error built carelessly around the secret: template literal and cause.
    const careless = new Error(`provider call failed with key ${secret}`, { cause: secret });
    // A KeyConfigError from a source whose own error held the key.
    const leakySource: KeySource = {
      name: 'secret-manager-test',
      read: () => Promise.reject(new Error(`denied for ${key}`)),
    };
    const configError = await loadProviderKeys({ source: leakySource, required: [] }).catch(
      (e: unknown) => e,
    );
    expect(configError).toBeInstanceOf(KeyConfigError);
    // A KeyConfigError from a malformed key (wrapped in quotes).
    const quotedError = await loadProviderKeys({
      source: envKeySource({ [VAR]: `"${key}"` }),
      required: ['openai-compatible'],
    }).catch((e: unknown) => e);
    expect(quotedError).toBeInstanceOf(KeyConfigError);

    safePayload = {
      keys,
      secret,
      providerKeys: keys.get('openai-compatible'),
      holder: { provider: 'openai-compatible', apiKey: secret, keys, deep: { list: [secret] } },
      careless,
      configError,
      quotedError,
    };
  });

  it.each(Object.keys(sinks))('%s: no fragment of the key in the output', async (name) => {
    const output = await sinks[name]!(safePayload);
    expect(output.length > 0).toBe(true);
    expect(output.includes('[redacted]')).toBe(true);
    expect(leaks(output, key)).toBe(false);
  });

  it.each(Object.keys(sinks))('%s: positive control, a revealed key is caught', async (name) => {
    const output = await sinks[name]!({ leaked: secret.reveal() });
    expect(leaks(output, key)).toBe(true);
  });

  it('the whole corpus is clean, and the same scan flags a deliberate leak in it', async () => {
    const outputs = await Promise.all(Object.values(sinks).map((sink) => sink(safePayload)));
    const corpus = outputs.join('\n');
    expect(leaks(corpus, key)).toBe(false);

    const leakedLine = await sinks['pino']!({ leaked: secret.reveal() });
    expect(leaks(corpus + '\n' + leakedLine, key)).toBe(true);
  });
});
