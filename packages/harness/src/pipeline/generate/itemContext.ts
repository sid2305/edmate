// The active practice item as the leak matcher sees it (task 5.6b, designs 2 and 3): its prompt,
// its options and its own answer key. From these come the item's exempt spans (a word-for-word
// restatement of its prompt, and its exact, in-order, complete option listing) and the keys
// derived from it (the correct option's text, its position, and the wrong options for the
// ruling-out check). Option text is never stored in HelpState; it is derived from the item.
import type { IssuedItem } from '../tools.js';
import { hasAnswerWord, hasMark, labelOf } from './labelKeys.js';

export interface ItemContext {
  readonly prompt: string;
  readonly options?: readonly string[];
  readonly answerKey: readonly string[];
}

/** The item an issued item shows: `shown` is its prompt, then its options. */
export function itemContextOf(issued: Pick<IssuedItem, 'shown' | 'answerKey'>): ItemContext {
  const [prompt = '', ...options] = issued.shown;
  return options.length > 0
    ? { prompt, options, answerKey: [...issued.answerKey] }
    : { prompt, answerKey: [...issued.answerKey] };
}

/**
 * The context for checking a newly issued item against keys held earlier: only its option listing
 * (its labels are structure, not an answer: an MCQ after an MCQ with the same key B is served).
 * Neither its prompt span nor its key: the prompt is new text that must not show a held key ("The
 * answer is B", or "3 + 4" against an earlier "7").
 */
export function issueCheckContext(issued: Pick<IssuedItem, 'shown' | 'answerKey'>): ItemContext {
  return { ...itemContextOf(issued), prompt: '', answerKey: [] };
}

/** An option's label letter ("B" from "B) 7"), upper case, else undefined. */
const OPTION_LABEL = /^\s*([A-Za-z])\s*[).:]\s*/u;

/** An option's text without its label ("7" from "B) 7"). */
export function optionText(option: string): string {
  return option.replace(OPTION_LABEL, '').trim();
}

/** The labels of an item's options, in order (A, B, C ... by position). */
export function itemLabels(item: ItemContext): string[] {
  return (item.options ?? []).map((_, k) => String.fromCharCode(0x41 + k));
}

/** The 0-based index of the correct option: one label key in range, else undefined. */
export function correctIndex(item: ItemContext): number | undefined {
  const options = item.options ?? [];
  if (options.length === 0 || item.answerKey.length !== 1) return undefined;
  const label = labelOf(item.answerKey[0] as string);
  if (label === undefined) return undefined;
  const k = label.charCodeAt(0) - 0x41;
  return k < options.length ? k : undefined;
}

/** The correct option's text (a full-strength key outside the item's spans), else undefined. */
export function correctOptionText(item: ItemContext): string | undefined {
  const k = correctIndex(item);
  if (k === undefined) return undefined;
  const text = optionText((item.options ?? [])[k] as string);
  return text === '' ? undefined : text;
}

/** The longest span an item can exempt: its prompt plus its listing, newlines included. */
export function spanLength(item: ItemContext): number {
  return [item.prompt, ...(item.options ?? [])].reduce((n, s) => n + s.length + 1, 0);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const WORD = /[\p{L}\p{M}\p{N}_]/u;
const isWord = (ch: string | undefined): boolean => ch !== undefined && WORD.test(ch);

/**
 * Each exact listing of the item's options in `folded` (look-alikes folded), as [start, end):
 * every option in order, only whitespace between them, starting and ending at word boundaries,
 * with no emphasis, mark or answer word on the lines it starts and ends on.
 */
export function listingSpans(folded: string, item: ItemContext): [number, number][] {
  const options = item.options ?? [];
  if (options.length === 0) return [];
  const src = options
    .map((o) => escapeRe(o.trim()).replace(/\s+/gu, '[ \\t\\p{Cf}]+'))
    .join('[\\s\\p{Cf}]+');
  const out: [number, number][] = [];
  for (const m of folded.matchAll(new RegExp(src, 'giu'))) {
    const start = m.index;
    const end = start + m[0].length;
    if (m[0].length === 0) continue;
    if (isWord(folded[start - 1]) && isWord(folded[start])) continue;
    if (isWord(folded[end]) && isWord(folded[end - 1])) continue;
    const lineStart = folded.lastIndexOf('\n', start - 1) + 1;
    const nl = folded.indexOf('\n', end);
    const around = folded.slice(lineStart, start) + ' ' + folded.slice(end, nl < 0 ? undefined : nl);
    if (hasMark(around) || hasMark(m[0]) || hasAnswerWord(around)) continue;
    out.push([start, end]);
  }
  return out;
}

/** `text` with every span blanked (each unit a space, newlines kept): same length, same lines. */
export function blank(text: string, spans: readonly [number, number][]): string {
  if (spans.length === 0) return text;
  const units = text.split('');
  for (const [s, e] of spans) {
    for (let k = s; k < e; k++) if (units[k] !== '\n') units[k] = ' ';
  }
  return units.join('');
}
