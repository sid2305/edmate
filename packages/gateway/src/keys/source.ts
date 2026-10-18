// Where provider keys come from. The environment now; a secret manager later implements the
// same interface (no vendor is chosen yet). The caller passes the env in, so src reads no global.

export interface KeySource {
  /** Shown in errors, for example "could not read provider keys from environment". */
  readonly name: string;
  /** Returns the requested variables only; an unset variable is undefined. */
  read(variables: readonly string[]): Promise<Readonly<Record<string, string | undefined>>>;
}

/** A KeySource over an env object (the app passes its process environment). It copies only the variables asked for. */
export function envKeySource(env: Readonly<Record<string, string | undefined>>): KeySource {
  return Object.freeze({
    name: 'environment',
    read(variables: readonly string[]): Promise<Readonly<Record<string, string | undefined>>> {
      const out: Record<string, string | undefined> = {};
      for (const variable of variables) {
        out[variable] = Object.hasOwn(env, variable) ? env[variable] : undefined;
      }
      return Promise.resolve(Object.freeze(out));
    },
  });
}
