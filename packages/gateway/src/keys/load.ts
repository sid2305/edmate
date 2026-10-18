// Loads provider keys once, at startup, from a KeySource. Every value is checked; every
// problem is collected; then one KeyConfigError is thrown that names the variables but never
// shows a value, a length or a fragment. Rotating a key means a restart.
import { PROVIDER_KEYS, type KeysFor, type ProviderId } from './providers.js';
import { keyProblem, type KeyProblem } from './schema.js';
import { Secret } from './secret.js';
import type { KeySource } from './source.js';

export type KeyProblemCode = KeyProblem | 'unknown_provider';

export interface KeyConfigProblem {
  /** The variable name, or the provider id for `unknown_provider`. Never a value. */
  readonly variable: string;
  readonly problem: KeyProblemCode;
}

const WORDS: Readonly<Record<KeyProblemCode, string>> = {
  missing: 'is missing',
  empty: 'is empty',
  whitespace: 'contains whitespace',
  quoted: 'is wrapped in quotes',
  placeholder: 'looks like a placeholder',
  too_short: 'is too short to be a key',
  unknown_provider: 'is not a known provider',
};

export class KeyConfigError extends Error {
  override readonly name = 'KeyConfigError';
  readonly problems: readonly KeyConfigProblem[];

  constructor(message: string, problems: readonly KeyConfigProblem[] = []) {
    super(message);
    this.problems = Object.freeze(
      problems.map((p) => Object.freeze({ variable: p.variable, problem: p.problem })),
    );
  }
}

export interface ProviderKeys {
  has(provider: ProviderId): boolean;
  /** Throws KeyConfigError if the provider was not loaded. */
  get<P extends ProviderId>(provider: P): KeysFor<P>;
  providers(): readonly ProviderId[];
  /** Provider names only, never keys. */
  toJSON(): { providers: readonly ProviderId[] };
}

export interface LoadProviderKeysOptions {
  source: KeySource;
  /** Providers that must have valid keys. Any other provider whose variables are set is loaded too. */
  required: readonly ProviderId[];
}

const ALL_PROVIDERS = Object.keys(PROVIDER_KEYS) as ProviderId[];

function fieldsOf(provider: ProviderId): [string, string][] {
  return Object.entries(PROVIDER_KEYS[provider]).map(([field, d]) => [field, d.variable]);
}

function isUnset(value: unknown): boolean {
  return String(value ?? '').trim() === '';
}

export async function loadProviderKeys(opts: LoadProviderKeysOptions): Promise<ProviderKeys> {
  const { source } = opts;
  const required = new Set<string>(opts.required);
  const variables = ALL_PROVIDERS.flatMap((p) => fieldsOf(p).map(([, variable]) => variable));

  let values: Readonly<Record<string, string | undefined>>;
  try {
    values = await source.read(variables);
  } catch {
    // The original error is dropped on purpose, not even kept as `cause`: it may hold a value.
    throw new KeyConfigError(`could not read provider keys from ${source.name}`);
  }

  const problems: KeyConfigProblem[] = [];
  const loaded = new Map<ProviderId, Readonly<Record<string, Secret>>>();
  for (const provider of ALL_PROVIDERS) {
    const fields = fieldsOf(provider);
    // An optional provider with nothing set is skipped; one with anything set must be valid.
    if (!required.has(provider) && fields.every(([, variable]) => isUnset(values[variable])))
      continue;
    const secrets: Record<string, Secret> = {};
    for (const [field, variable] of fields) {
      const raw = values[variable];
      const problem = keyProblem(raw);
      if (problem === undefined) secrets[field] = Secret.of(raw as string);
      else problems.push({ variable, problem });
    }
    loaded.set(provider, Object.freeze(secrets));
  }
  for (const provider of required) {
    if (!Object.hasOwn(PROVIDER_KEYS, provider))
      problems.push({ variable: provider, problem: 'unknown_provider' });
  }

  if (problems.length > 0) {
    const list = problems
      .map(({ variable, problem }) => `${variable} ${WORDS[problem]}`)
      .join('; ');
    const setIt = problems.length === 1 ? 'Set it' : 'Set them';
    throw new KeyConfigError(
      `Provider keys are not configured correctly: ${list}. ` +
        `${setIt} in the environment or the secret manager (see docker/env.example).`,
      problems,
    );
  }
  return providerKeys(loaded);
}

function providerKeys(
  loaded: ReadonlyMap<ProviderId, Readonly<Record<string, Secret>>>,
): ProviderKeys {
  const ids: readonly ProviderId[] = Object.freeze([...loaded.keys()]);
  const keys = Object.create(null) as ProviderKeys & { toString(): string };
  keys.has = (provider) => loaded.has(provider);
  keys.get = <P extends ProviderId>(provider: P): KeysFor<P> => {
    const found = loaded.get(provider);
    if (found === undefined) throw new KeyConfigError(`no keys loaded for ${provider}`);
    return found as KeysFor<P>;
  };
  keys.providers = () => ids;
  keys.toJSON = () => ({ providers: ids });
  keys.toString = () => `ProviderKeys(${ids.join(', ')})`;
  return Object.freeze(keys);
}
