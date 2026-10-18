// The spec copy in spec-types.ts must stay identical to the build plan's Core contracts block,
// so the type tests (types.test.ts) always compare the schemas against the real spec.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const normalise = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The `ts` block under `## Core contracts` in the build plan. */
export function specBlock(doc: string): string {
  const section = doc.split(/^## Core contracts$/m)[1];
  if (section === undefined) throw new Error('no "## Core contracts" section in the build plan');
  const match = /```ts\n([\s\S]*?)\n```/.exec(section.split(/^## /m)[0] ?? '');
  if (match?.[1] === undefined) throw new Error('no ts block under "## Core contracts"');
  return match[1];
}

/** spec-types.ts without its header (everything up to and including the import line) and `export `. */
export function copyBody(copy: string): string {
  const marker = "import type { ZodType } from 'zod';";
  const at = copy.indexOf(marker);
  if (at === -1) throw new Error('spec-types.ts has no ZodType import line');
  return copy.slice(at + marker.length).replace(/^export /gm, '');
}

describe('spec drift', () => {
  it('spec-types.ts equals the Core contracts block of the build plan', () => {
    const spec = specBlock(read('../../../docs/edmate-harness-build-plan.md'));
    const copy = copyBody(read('./spec-types.ts'));
    expect(normalise(copy)).toBe(normalise(spec));
  });

  it('detects a changed field', () => {
    const spec = specBlock(read('../../../docs/edmate-harness-build-plan.md'));
    const copy = copyBody(read('./spec-types.ts')).replace(
      'amountMinor: number',
      'amountMinor: string',
    );
    expect(normalise(copy)).not.toBe(normalise(spec));
  });

  it('fails loudly when the section or the import line is missing', () => {
    expect(() => specBlock('# nothing here')).toThrow(/Core contracts/);
    expect(() => specBlock('## Core contracts\n\nno code\n## Next\n```ts\nx\n```')).toThrow(
      /ts block/,
    );
    expect(() => copyBody('type X = 1;')).toThrow(/import line/);
  });
});
