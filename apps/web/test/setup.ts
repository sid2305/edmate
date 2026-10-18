// Every web test runs offline (build plan rule 4): the global fetch rejects, so a provider call
// that is not injected fails the test instead of reaching Google. Sign-in env from the shell is
// cleared so Auth.js never infers settings from it.
import { afterEach, beforeEach, vi } from 'vitest';

const AUTH_VARS = [
  'AUTH_SECRET',
  'AUTH_URL',
  'AUTH_TRUST_HOST',
  'AUTH_GOOGLE_ID',
  'AUTH_GOOGLE_SECRET',
  'NEXTAUTH_URL',
  'NEXTAUTH_SECRET',
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      throw new Error(`network disabled in tests: ${String(input)}`);
    }),
  );
  for (const name of AUTH_VARS) vi.stubEnv(name, undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
