// Fix round 9.4e: loadBundledPrices used to read prices.yaml at runtime with
// `readFileSync(new URL('./prices.yaml', import.meta.url))`, which cannot find the file once
// webpack bundles the module (`next build --webpack`), 503-ing every POST /api/sessions. Now
// prices.generated.ts embeds the YAML text as a plain TS string, imported statically so no
// runtime file read happens. This test fails if that generated file drifts from its source;
// regenerate with `node scripts/generate-prices.mjs` (or `pnpm generate:prices`) after editing
// prices.yaml.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRICES_YAML } from '../../src/pricing/prices.generated.js';

const YAML_PATH = fileURLToPath(new URL('../../src/pricing/prices.yaml', import.meta.url));

describe('prices.generated.ts', () => {
  it('matches prices.yaml exactly', () => {
    const yamlText = readFileSync(YAML_PATH, 'utf8');
    expect(PRICES_YAML).toBe(yamlText);
  });
});
