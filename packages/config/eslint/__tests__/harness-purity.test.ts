// Build plan rule 3: packages/harness imports only @edmate/contracts, zod, mathjs and its own
// modules. Every violating import below is *virtual text* linted at a fake path, so no impure
// file ever exists inside packages/harness.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import baseConfig from '../base.js';
import harnessConfig from '../harness.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RULE_ID = 'harness-purity/no-external-import';

async function lint(code: string, filePath: string, config = harnessConfig) {
  const eslint = new ESLint({ cwd: repoRoot, overrideConfigFile: true, overrideConfig: config });
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, filePath) });
  if (!result) throw new Error('ESLint returned no result');
  return result.messages;
}

function purityErrors(messages: Awaited<ReturnType<typeof lint>>) {
  return messages.filter((m) => m.ruleId === RULE_ID && m.severity === 2);
}

const HARNESS_FILE = 'packages/harness/src/fake.ts';

describe('harness purity rule', () => {
  it('rejects drizzle-orm imported from packages/harness', async () => {
    const messages = await lint(
      "import { drizzle } from 'drizzle-orm';\nexport { drizzle };\n",
      HARNESS_FILE,
    );
    const errors = purityErrors(messages);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('drizzle-orm');
  });

  it('allows zod, mathjs, @edmate/contracts and relative imports', async () => {
    const code = [
      "import { z } from 'zod';",
      "import * as math from 'mathjs';",
      "import type { Usage } from '@edmate/contracts';",
      "import { helper } from './helper';",
      "import { other } from '../pipeline/other';",
      'export { z, math, helper, other };',
      'export type { Usage };',
      '',
    ].join('\n');
    expect(await lint(code, HARNESS_FILE)).toEqual([]);
  });

  it('allows zod subpaths and @edmate/contracts subpaths', async () => {
    const code = "export { z } from 'zod/v4';\nexport * from '@edmate/contracts/fixtures';\n";
    expect(await lint(code, HARNESS_FILE)).toEqual([]);
  });

  it('does not apply outside packages/harness', async () => {
    const code = "import { drizzle } from 'drizzle-orm';\nexport { drizzle };\n";
    expect(purityErrors(await lint(code, 'packages/gateway/src/fake.ts'))).toEqual([]);
  });

  it('is not part of the base preset', async () => {
    const code = "import { drizzle } from 'drizzle-orm';\nexport { drizzle };\n";
    expect(purityErrors(await lint(code, HARNESS_FILE, baseConfig))).toEqual([]);
  });

  it.each([
    [
      'node: built-in',
      "import { randomUUID } from 'node:crypto';\nexport { randomUUID };\n",
      'node:crypto',
    ],
    ['bare built-in fs', "import fs from 'fs';\nexport { fs };\n", 'fs'],
    ['bare built-in crypto', "import * as c from 'crypto';\nexport { c };\n", 'crypto'],
    [
      'type-only import',
      "import type { NextRequest } from 'next/server';\nexport type { NextRequest };\n",
      'next/server',
    ],
    ['re-export', "export { Worker } from 'bullmq';\n", 'bullmq'],
    ['export all', "export * from 'openai';\n", 'openai'],
    ['dynamic import', "export const load = () => import('ioredis');\n", 'ioredis'],
    ['require call', "export const pg = require('pg');\n", 'pg'],
    ['TS import-equals', "import pg = require('pg');\nexport { pg };\n", 'pg'],
    ['look-alike package', "import { z } from 'zod-extra';\nexport { z };\n", 'zod-extra'],
    [
      'look-alike scope',
      "import x from '@edmate/contracts-evil';\nexport { x };\n",
      '@edmate/contracts-evil',
    ],
    ['mathjs subpath', "import x from 'mathjs/lib/esm';\nexport { x };\n", 'mathjs/lib/esm'],
    ['other workspace package', "import x from '@edmate/db';\nexport { x };\n", '@edmate/db'],
    [
      'relative path escaping the package',
      "import x from '../../../db/src/index';\nexport { x };\n",
      '../../../db/src/index',
    ],
  ])('rejects a %s', async (_label, code, source) => {
    const errors = purityErrors(await lint(code, HARNESS_FILE));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain(`'${source}'`);
  });

  it('rejects a dynamic import with a non-literal source (fails closed)', async () => {
    const code = "const name = 'pg';\nexport const load = () => import(name);\n";
    const errors = purityErrors(await lint(code, HARNESS_FILE));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('non-literal');
  });

  it('rejects a require call with a non-literal source (fails closed)', async () => {
    const code = "const name = 'pg';\nexport const pg = require(name);\n";
    expect(purityErrors(await lint(code, HARNESS_FILE))).toHaveLength(1);
  });

  it('rejects a require call with no argument (fails closed)', async () => {
    expect(purityErrors(await lint('export const x = require();\n', HARNESS_FILE))).toHaveLength(1);
  });

  it('allows a TS namespace alias (import-equals without require)', async () => {
    const code = 'namespace A { export const b = 1; }\nimport B = A.b;\nexport { B };\n';
    expect(purityErrors(await lint(code, HARNESS_FILE))).toEqual([]);
  });

  it('allows vitest only in harness test files', async () => {
    const code = "import { it } from 'vitest';\nit('x', () => {});\n";
    expect(await lint(code, 'packages/harness/src/pipeline/runner.test.ts')).toEqual([]);
    expect(purityErrors(await lint(code, 'packages/harness/src/pipeline/runner.ts'))).toHaveLength(
      1,
    );
  });

  it('exempts tooling config files at the harness package root only', async () => {
    const code =
      "import harness from '@edmate/config/eslint/harness';\nexport default [...harness];\n";
    expect(purityErrors(await lint(code, 'packages/harness/eslint.config.js'))).toEqual([]);
    expect(purityErrors(await lint(code, 'packages/harness/vitest.config.ts'))).toEqual([]);
    expect(purityErrors(await lint(code, 'packages/harness/src/eslint.config.js'))).toHaveLength(1);
    expect(
      purityErrors(await lint(code, 'packages/harness/src/pipeline/app.config.ts')),
    ).toHaveLength(1);
  });

  it.each([
    ['aliased require', "const r = require;\nexport const x = r('ioredis');\n"],
    ['module.require', "export const x = module.require('pg');\n"],
    ['computed module["require"]', "export const x = module['require']('pg');\n"],
    ['globalThis.require', "export const x = (globalThis as any).require('pg');\n"],
    ['require passed as a value', 'export const load = [require];\n'],
    ['typeof require', "export const hasRequire = typeof require === 'function';\n"],
  ])('rejects %s (fails closed)', async (_label, code) => {
    const errors = purityErrors(await lint(code, HARNESS_FILE));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('require');
  });

  it('reports a direct require() call once, not twice', async () => {
    const errors = purityErrors(await lint("export const pg = require('pg');\n", HARNESS_FILE));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("'pg'");
  });

  it('does not flag a local variable or parameter named require', async () => {
    const code = [
      'export function f(require: (s: string) => unknown) {',
      "  const alias = require;\n  return alias('x') ?? require('y');",
      '}',
      'export const o = { require: 1 };',
      '',
    ].join('\n');
    expect(purityErrors(await lint(code, HARNESS_FILE))).toEqual([]);
  });

  it('ignores a require-like call that is not require()', async () => {
    const code = "declare const load: (s: string) => unknown;\nexport const x = load('pg');\n";
    expect(await lint(code, HARNESS_FILE)).toEqual([]);
  });
});
