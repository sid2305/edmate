// The `sources` event (task 3.7): only the sources the reply actually cites with `[n]`, where n
// is the number the composer gave the material in the system prompt (3.6). Out-of-range numbers
// are ignored here; telling the student about made-up citations is 4.7's job.
import type { SourceRef } from '@edmate/contracts';

const CITATION = /\[(\d{1,3})\]/g;

/** The cited sources in `n` order, once each, as copies. */
export function citedSources(draft: string, sources: readonly SourceRef[]): SourceRef[] {
  const cited = new Set<number>();
  for (const m of draft.matchAll(CITATION)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= sources.length) cited.add(n);
  }
  return [...cited].sort((a, b) => a - b).map((n) => ({ ...(sources[n - 1] as SourceRef) }));
}
