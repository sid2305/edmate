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
 * Rule B's own wider pattern (4.7b item 2, not used by `citedSources`, which must stay the
 * composer's exact `[n]` numbering per 3.6/3.7): a bracketed number with inner spaces or a
 * full-width digit (group 1), or the no-brackets "source N" wording (group 2, English pilot).
 */
const CITATION_VARIANT = /\[\s*([0-9０-９]{1,3})\s*\]|\bsource\s+([0-9０-９]{1,3})\b/giu;
/** Full-width digits (U+FF10-U+FF19) read as their ASCII equivalent. */
function toAsciiDigits(s: string): string {
  return s.replace(/[０-９]/g, (d) => String(d.codePointAt(0)! - 0xff10));
}

/**
 * Grounding Rule B (task 4.7): the `[n]` citation numbers in `text` that name none of the
 * `count` numbered sources, once each, in order. Code (fenced or inline) and indexing (`pets[0]`,
 * `grid[1][2]`) are not citations. 4.7b item 2: also catches `"[ n ]"`, a full-width digit and
 * `"source N"` with no brackets, so a model can't dodge the check by writing one of those forms.
 */
export function invalidCitations(text: string, count: number): number[] {
  const prose = text.replace(CODE, (m) => ' '.repeat(m.length));
  const bad = new Set<number>();
  for (const m of prose.matchAll(CITATION_VARIANT)) {
    const digits = m[1] ?? m[2];
    if (digits === undefined) continue;
    // Bracket form only: two units, so a letter outside the BMP (a surrogate pair) is read whole.
    if (m[1] !== undefined && INDEXED.test(prose.slice(Math.max(0, m.index - 2), m.index)))
      continue;
    const n = Number(toAsciiDigits(digits));
    if (n < 1 || n > count) bad.add(n);
  }
  return [...bad];
}
