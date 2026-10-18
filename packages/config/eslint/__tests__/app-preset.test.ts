// Task 1.3: the apps preset bans @edmate/db/internal everywhere and Auth.js outside src/auth.
// Imports are virtual text linted at fake paths, so no violating file exists in the repo.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import appConfig from '../app.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

async function restricted(code: string, filePath: string) {
  const eslint = new ESLint({ cwd: repoRoot, overrideConfigFile: true, overrideConfig: appConfig });
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, filePath) });
  if (!result) throw new Error('ESLint returned no result');
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports' && m.severity === 2);
}

const ROUTE = 'apps/web/app/api/x/route.ts';
const AUTH = 'apps/web/src/auth/fake.ts';

describe('apps preset', () => {
  it.each([
    [
      '@edmate/db/internal',
      "import { createDb } from '@edmate/db/internal';\nexport { createDb };\n",
    ],
    [
      'a deep db path',
      "import { users } from '@edmate/db/dist/schema/index.js';\nexport { users };\n",
    ],
    [
      'a type-only db/internal import',
      "import type { Db } from '@edmate/db/internal';\nexport type { Db };\n",
    ],
    ['a db/internal re-export', "export * from '@edmate/db/internal';\n"],
  ])('rejects %s in app code and in src/auth', async (_label, code) => {
    expect(await restricted(code, ROUTE)).toHaveLength(1);
    expect(await restricted(code, AUTH)).toHaveLength(1);
  });

  it.each([
    ['next-auth', "import NextAuth from 'next-auth';\nexport { NextAuth };\n"],
    [
      'a next-auth subpath',
      "import Google from 'next-auth/providers/google';\nexport { Google };\n",
    ],
    ['@auth/core', "import { Auth } from '@auth/core';\nexport { Auth };\n"],
  ])('rejects %s outside src/auth and allows it inside', async (_label, code) => {
    const errors = await restricted(code, ROUTE);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('src/auth');
    expect(await restricted(code, AUTH)).toEqual([]);
  });

  it('allows @edmate/db and the auth folder from app code', async () => {
    const code = [
      "import { openDatabase } from '@edmate/db';",
      "import { withRole } from '../../../src/auth/index';",
      'export { openDatabase, withRole };',
      '',
    ].join('\n');
    expect(await restricted(code, ROUTE)).toEqual([]);
  });
});
