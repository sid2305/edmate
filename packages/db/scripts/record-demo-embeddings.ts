// Task 5.3 Phase D (Q2, B-24): a one-off recording of the platform embedding model's vectors for
// the demo recall set, so the "with embeddings" recall run can use real vectors without calling a
// model in tests. Never run by tests or CI; it refuses without `--live` and without the key.
//
// The human runs it once, from the repo root, with their own key in the environment only, on the
// Node version this repo's engines field pins (22.x; Node 22.18+ strips `.ts` types natively, no
// flag needed — on an older 22.x build add `--experimental-strip-types` before the script path):
//   corepack pnpm turbo run build --filter=@edmate/db...
//   EDMATE_OPENAI_API_KEY=<key> node packages/db/scripts/record-demo-embeddings.ts --live
// The key is read only through the gateway's environment key source and never written anywhere.
// Output: packages/db/test/fixtures/demo-embeddings.json (the open-licensed demo text and numbers).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  createEmbeddingAdapter,
  EMBEDDING_CONFIG,
  envKeySource,
  loadProviderKeys,
  type ProviderKeys,
} from '@edmate/gateway';
import {
  demoCorpus,
  EMBEDDINGS_FIXTURE,
  type RecordedEmbeddings,
  textsToEmbed,
} from '../test/recall-corpus.ts';

/** Texts per embedding request (the same batch size indexing uses). */
const BATCH = 96;

async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  if (!argv.includes('--live')) {
    process.stderr.write(
      'refusing: this calls the embedding model with your key and costs money; pass --live\n',
    );
    return 2;
  }
  let keys: ProviderKeys;
  try {
    keys = await loadProviderKeys({ source: envKeySource(env), required: ['openai'] });
  } catch {
    process.stderr.write('refusing: EDMATE_OPENAI_API_KEY is not set or not valid\n');
    return 2;
  }
  const adapter = createEmbeddingAdapter(keys.get('openai'));
  const texts = textsToEmbed(demoCorpus());
  const entries: RecordedEmbeddings['entries'] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const vectors = await adapter.embed(batch);
    batch.forEach((text, j) => {
      const vector = vectors[j];
      if (vector === undefined) throw new Error('the model returned fewer vectors than texts');
      entries.push({ text, vector: vector.map((x) => Math.round(x * 1e6) / 1e6) });
    });
  }
  const out: RecordedEmbeddings = {
    model: EMBEDDING_CONFIG.model,
    dimension: EMBEDDING_CONFIG.dimension,
    entries,
  };
  mkdirSync(dirname(EMBEDDINGS_FIXTURE), { recursive: true });
  writeFileSync(EMBEDDINGS_FIXTURE, `${JSON.stringify(out)}\n`);
  process.stdout.write(`wrote ${entries.length} vectors to ${EMBEDDINGS_FIXTURE}\n`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2), process.env);
