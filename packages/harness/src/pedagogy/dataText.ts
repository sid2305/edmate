// How data is rendered into a model request (moved out of compose.ts in task 4.8 so adviceGuard and
// the disclaimer helper render text exactly the way the system-prompt composer does).

/** The fixed delimiters around data blocks (material, style card, learner summary). */
export const DATA_OPEN = '<<<';
export const DATA_CLOSE = '>>>';

/** Breaks any run of 3+ `<` or `>` in data, so data can never close its own delimiter. */
export function neutralise(text: string): string {
  return text.replace(/<{3,}|>{3,}/g, (m) => m.split('').join(' '));
}

/** Data in its own delimited block. */
export function fenced(text: string): string {
  return `${DATA_OPEN}\n${neutralise(text)}\n${DATA_CLOSE}`;
}

/** One line of data: whitespace collapsed (no line breaks to fake a new section). */
export function inline(text: string): string {
  return neutralise(text).replace(/\s+/g, ' ').trim();
}
