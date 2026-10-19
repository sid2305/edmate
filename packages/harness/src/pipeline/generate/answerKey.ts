// The cheap answer-key check (task 3.7 fix round), shared by skill payloads and tool outputs; 4.5
// reuses `normaliseForMatch` for its streamed-text check. Both sides are NFKC-folded, lower-cased
// and stripped of whitespace, Unicode separators, commas and zero-width characters, so "24,000",
// "２４０００" and "24<ZWSP>000" all match the key "24000".

const STRIP = /[\s\p{Z},\u200B-\u200D\u2060\uFEFF]/gu;

export function normaliseForMatch(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(STRIP, '');
}

/** Every string in the value, keys included, plus numbers as text. */
function leaves(value: unknown, out: string[]): string[] {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'number') out.push(String(value));
  else if (Array.isArray(value)) for (const v of value) leaves(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      leaves(v, out);
    }
  }
  return out;
}

/** True when any non-empty do-not-say string appears in the value (its JSON or any leaf). */
export function revealsAnswerKey(value: unknown, mustNotReveal: readonly string[]): boolean {
  const keys = mustNotReveal.map(normaliseForMatch).filter((k) => k !== '');
  if (keys.length === 0) return false;
  const texts = leaves(value, []);
  try {
    const json = JSON.stringify(value) as string | undefined;
    if (json !== undefined) texts.push(json);
  } catch {
    // Leaves alone are checked.
  }
  const normalised = texts.map(normaliseForMatch);
  return keys.some((k) => normalised.some((t) => t.includes(k)));
}
