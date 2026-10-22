// Configured models for the live sweep (task 7.6 Phase B): `evals/live-models.yaml` lists the
// real models to run every suite against. Each entry stands in for both tiers at once (the sweep
// forces `modelPolicy.tiers.small` and `.main` to the same `{ provider, model }`, lead answer Q3:
// cost is split by which tier a call actually used, not by model) — the simplest reading of "per
// model pass rates". Validated the same fail-fast-naming-the-bad-entry way as
// `calibration.ts`/`prices.yaml`: a bad file throws, naming the index and the bad field.
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { z } from 'zod';
import { displayPath } from './displayPath.js';

// This schema must never gain a key/secret field (e.g. an API key or token): a live sweep's
// candidate list is a plain, checked-in config file (`evals/live-models.yaml`), and every key
// this package uses comes from an env var only (`@edmate/gateway`'s `PROVIDER_KEYS`), never from
// here (task 7.6a).
export const LiveModelEntrySchema = z.strictObject({
  /** A short, unique, human-readable name for this entry's reports (e.g. its directory name). */
  label: z.string().min(1),
  provider: z.enum(['anthropic', 'openai-compatible']),
  model: z.string().min(1),
  /** Required for `openai-compatible` only (no default base URL for that provider). */
  baseURL: z.url().exactOptional(),
});
export type LiveModelEntry = z.infer<typeof LiveModelEntrySchema>;

export class LiveModelsLoadError extends Error {
  override readonly name = 'LiveModelsLoadError';

  constructor(
    readonly filePath: string,
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(`${displayPath(filePath)}: ${detail}`, options);
  }
}

/** Reads `evals/live-models.yaml` (or an equivalent file); throws naming the first bad entry. */
export function loadLiveModels(path: string): LiveModelEntry[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code ?? (cause as Error).message;
    throw new LiveModelsLoadError(path, `cannot read file: ${code}`, { cause });
  }
  let doc: unknown;
  try {
    doc = load(raw, { filename: displayPath(path) });
  } catch (cause) {
    throw new LiveModelsLoadError(path, `invalid YAML: ${(cause as Error).message}`, { cause });
  }
  if (!Array.isArray(doc)) {
    throw new LiveModelsLoadError(path, 'expected a YAML list of model entries');
  }
  const labels = new Set<string>();
  return doc.map((entry, index) => {
    const parsed = LiveModelEntrySchema.safeParse(entry);
    if (!parsed.success) {
      throw new LiveModelsLoadError(
        path,
        `entry ${index} is invalid:\n${z.prettifyError(parsed.error)}`,
        { cause: parsed.error },
      );
    }
    if (parsed.data.provider === 'openai-compatible' && parsed.data.baseURL === undefined) {
      throw new LiveModelsLoadError(
        path,
        `entry ${index} ("${parsed.data.label}"): baseURL is required for an openai-compatible model`,
      );
    }
    if (labels.has(parsed.data.label)) {
      throw new LiveModelsLoadError(path, `entry ${index}: duplicate label "${parsed.data.label}"`);
    }
    labels.add(parsed.data.label);
    return parsed.data;
  });
}
