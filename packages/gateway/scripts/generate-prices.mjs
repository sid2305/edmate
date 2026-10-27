#!/usr/bin/env node
// Regenerates src/pricing/prices.generated.ts from src/pricing/prices.yaml (fix round 9.4e).
// Run with `node scripts/generate-prices.mjs` (or `pnpm --filter @edmate/gateway generate:prices`)
// after editing prices.yaml. test/pricing/generated.test.ts fails if the two drift apart.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pricingDir = path.join(here, '..', 'src', 'pricing');
const yamlPath = path.join(pricingDir, 'prices.yaml');
const outPath = path.join(pricingDir, 'prices.generated.ts');

const yamlText = readFileSync(yamlPath, 'utf8');
const escaped = yamlText.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const contents = `// GENERATED FILE. Do not edit by hand -- edit prices.yaml and regenerate.
// Regenerate with \`node scripts/generate-prices.mjs\` (packages/gateway "generate:prices" script)
// after editing prices.yaml. test/pricing/generated.test.ts fails if this file drifts from it.
//
// Why generated instead of read at runtime (fix round 9.4e): loadBundledPrices used to do
// \`readFileSync(new URL('./prices.yaml', import.meta.url))\`, which cannot find the file once
// \`next build\` bundles this module, 503-ing every POST /api/sessions in
// production. A statically imported TS module is bundler-safe.

/** The raw text of prices.yaml, embedded so loadBundledPrices needs no runtime file read. */
export const PRICES_YAML = \`${escaped}\`;
`;

writeFileSync(outPath, contents);
console.log(`Wrote ${outPath}`);
