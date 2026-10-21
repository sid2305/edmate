// Human double-check and judge calibration (task 7.1). A fraction of each suite's cases are
// sampled deterministically; a human reviews them; agreement against the automated run is
// recorded in the report. No reviewer name is hard-coded: `reviewedBy` is free text the human
// fills in, mirroring `reviewed_by` in schema.ts.
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { z } from 'zod';
import { displayPath } from './displayPath.js';
import type { CaseResult } from './runner.js';

export const HumanVerdictSchema = z.strictObject({
  caseId: z.string().min(1),
  humanPass: z.boolean(),
  reviewedBy: z.string().min(1),
  note: z.string().exactOptional(),
});
export type HumanVerdict = z.infer<typeof HumanVerdictSchema>;

export class DoubleCheckLoadError extends Error {
  override readonly name = 'DoubleCheckLoadError';

  constructor(
    readonly filePath: string,
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(`${displayPath(filePath)}: ${detail}`, options);
  }
}

/** Reads one YAML file of human double-check verdicts; throws naming the file on a bad entry. */
export function loadDoubleCheck(path: string): HumanVerdict[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code ?? (cause as Error).message;
    throw new DoubleCheckLoadError(path, `cannot read file: ${code}`, { cause });
  }
  let doc: unknown;
  try {
    doc = load(raw, { filename: displayPath(path) });
  } catch (cause) {
    throw new DoubleCheckLoadError(path, `invalid YAML: ${(cause as Error).message}`, { cause });
  }
  const list = Array.isArray(doc) ? doc : [];
  if (!Array.isArray(doc)) {
    throw new DoubleCheckLoadError(path, 'expected a YAML list of double-check entries');
  }
  return list.map((entry, index) => {
    const parsed = HumanVerdictSchema.safeParse(entry);
    if (!parsed.success) {
      throw new DoubleCheckLoadError(
        path,
        `entry ${index} is invalid:\n${z.prettifyError(parsed.error)}`,
        { cause: parsed.error },
      );
    }
    return parsed.data;
  });
}

/**
 * Picks a deterministic ~`fraction` of `caseIds` (ceil, min 1 when non-empty), by fixed stride
 * over the sorted ids, so the same case-id set always samples the same ids.
 */
export function sampleForDoubleCheck(
  caseIds: readonly string[],
  fraction = 0.1,
): string[] {
  if (caseIds.length === 0) return [];
  const sorted = [...caseIds].sort();
  const count = Math.max(1, Math.ceil(sorted.length * fraction));
  const stride = sorted.length / count;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(sorted[Math.floor(i * stride)]!);
  }
  return out;
}

export interface CalibrationSummary {
  /** Verdicts whose case id is present in this run's results. */
  sampled: number;
  /** Alias of `sampled`: every matched verdict counts as reviewed. */
  reviewed: number;
  agreed: number;
  rate: number;
  /** Case ids with a verdict that disagrees with the automated result. */
  disagreements: string[];
  /** Verdict case ids with no matching result in this run, deduplicated, in input order. */
  unmatched: string[];
}

/** Agreement between the automated run and a set of human double-check verdicts. */
export function computeAgreement(
  results: readonly CaseResult[],
  verdicts: readonly HumanVerdict[],
): CalibrationSummary {
  const byId = new Map(results.map((r) => [r.id, r]));
  const matched = verdicts.filter((v) => byId.has(v.caseId));
  const disagreements: string[] = [];
  let agreed = 0;
  for (const v of matched) {
    const result = byId.get(v.caseId)!;
    if (result.pass === v.humanPass) agreed++;
    else disagreements.push(v.caseId);
  }
  const unmatched: string[] = [];
  const seenUnmatched = new Set<string>();
  for (const v of verdicts) {
    if (byId.has(v.caseId) || seenUnmatched.has(v.caseId)) continue;
    seenUnmatched.add(v.caseId);
    unmatched.push(v.caseId);
  }
  const reviewed = matched.length;
  return {
    sampled: reviewed,
    reviewed,
    agreed,
    rate: reviewed === 0 ? 0 : agreed / reviewed,
    disagreements,
    unmatched,
  };
}
