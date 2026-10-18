// Valid fixtures parse to themselves and survive a JSON round trip; invalid ones fail at the
// expected path.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { invalidFixtures, schemas, validFixtures } from '../fixtures/index.js';

const names = Object.keys(schemas) as (keyof typeof schemas)[];

const validCases = names.flatMap((name) =>
  validFixtures[name].map((value, i) => ({ name, i, value, schema: schemas[name] as z.ZodType })),
);
const invalidCases = names.flatMap((name) =>
  invalidFixtures[name].map((c) => ({ ...c, schema: schemas[name] as z.ZodType })),
);

describe('valid fixtures round-trip', () => {
  it.each(validCases)('$name #$i', ({ schema, value }) => {
    const parsed = schema.parse(value);
    expect(parsed).toStrictEqual(value);
    expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toStrictEqual(parsed);
  });
});

describe('invalid fixtures are rejected at the expected path', () => {
  it.each(invalidCases)('$schema: $name', ({ schema, value, path }) => {
    const result = schema.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path)).toContainEqual(path);
  });
});
