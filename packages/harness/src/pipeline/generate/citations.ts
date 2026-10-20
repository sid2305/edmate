// The `sources` event (task 3.7): only the sources the reply actually cites with `[n]`, where n
// is the number the composer gave the material in the system prompt (3.6). Out-of-range numbers
// are ignored here; grounding (4.7) treats them as a made-up citation (`invalidCitations`).
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

/** Fenced blocks (an unclosed fence runs to the end) and inline code spans. */
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;
/** What makes `[n]` an index, not a citation: a name, a closing bracket or a quote right before. */
const INDEXED = /[\p{L}\p{N}_)\]'"]$/u;

/**
 * Grounding Rule B (task 4.7): the `[n]` citation numbers in `text` that name none of the
 * `count` numbered sources, once each, in order. Code (fenced or inline) and indexing (`pets[0]`,
 * `grid[1][2]`) are not citations. Uses the same CITATION pattern as `citedSources`.
 */
export function invalidCitations(text: string, count: number): number[] {
  const prose = text.replace(CODE, (m) => ' '.repeat(m.length));
  const bad = new Set<number>();
  for (const m of prose.matchAll(CITATION)) {
    // Two units, so a letter outside the BMP (a surrogate pair) is read whole.
    if (INDEXED.test(prose.slice(Math.max(0, m.index - 2), m.index))) continue;
    const n = Number(m[1]);
    if (n < 1 || n > count) bad.add(n);
  }
  return [...bad];
}
