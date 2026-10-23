// Task 8.2c Phase A: a teacher-exported YouTube caption file (.vtt or .srt), parsed into the same
// 90 s timestamp units a Whisper transcript gives (unitsFromTimedText, parse/video.ts). Edmate never
// fetches YouTube (B-47): the caption file is an ordinary upload. Every regex here is anchored and
// has no nested quantifiers (no ReDoS on a teacher-sized file), and no thrown error ever quotes the
// file's own text.
import { IngestError } from '../errors.js';
import type { ParsedDocument } from '../types.js';
import { collapse, requireTitle } from './sections.js';
import { unitsFromTimedText } from './video.js';

/** `[hh:]mm:ss.ttt` (VTT) or `hh:mm:ss[,.]ttt` (SRT); hours are optional digits, not just two. */
const TIME = String.raw`(?:\d+:)?\d{2}:\d{2}[.,]\d{3}`;
const TIMING_LINE = new RegExp(`^(${TIME})\\s*-->\\s*(${TIME})(?:[ \t].*)?$`);
const TIME_TOKEN = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/;

/** A WebVTT header: "WEBVTT" alone, or followed by a space or tab (trailing header notes). */
const VTT_HEADER = /^WEBVTT([ \t]|$)/;
/** A leading byte-order mark, stripped before line-splitting. Built from its code point (not typed
 * as a literal character) so the source file itself stays plain ASCII. */
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

const ENTITY = /&(amp|lt|gt|quot|#39|nbsp|lrm|rlm);/g;
const ENTITY_VALUES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
  lrm: '',
  rlm: '',
};

function decodeEntities(line: string): string {
  return line.replace(ENTITY, (_, name: string) => ENTITY_VALUES[name] ?? '');
}

/**
 * Removes every `open`-prefixed span up to its matching `close` character, e.g. `<...>` (any
 * markup tag: `<c>`, `<c.color...>`, `<v Name>`, `<i>`, `<b>`, `<u>`, `<lang>`, `<ruby>`, `<rt>`, an
 * inline `<00:00:01.500>` timestamp) or `{\...}` (an SRT override block, e.g. `{\an8}`).
 *
 * Written as a forward-only scan, not a `<[^>]*>`-shaped regex: that shape is a classic ReDoS (one
 * non-nested quantifier can still be quadratic when a long run of `open` is never followed by a
 * `close`). The scan caches the next `close` position and only re-searches once the read head moves
 * past it, so a run of unmatched `open` costs O(1) each after the first lookup, and a string with no
 * `close` at all is detected once and the remainder kept literally. Either way the whole line is
 * visited once: true O(n).
 */
function removeSpans(
  line: string,
  isOpen: (i: number) => boolean,
  openLen: number,
  close: string,
): string {
  let out = '';
  let i = 0;
  let nextClose = -2; // -2: unknown, needs a search; -1: no `close` exists from here on (permanent)
  while (i < line.length) {
    if (!isOpen(i)) {
      out += line[i];
      i += 1;
      continue;
    }
    if (nextClose !== -1 && nextClose < i) nextClose = line.indexOf(close, i + openLen);
    if (nextClose === -1) {
      out += line.slice(i);
      break;
    }
    i = nextClose + 1;
  }
  return out;
}

function stripTags(line: string): string {
  return removeSpans(line, (i) => line[i] === '<', 1, '>');
}

function stripOverrides(line: string): string {
  return removeSpans(line, (i) => line[i] === '{' && line[i + 1] === '\\', 2, '}');
}

function cleanLine(line: string): string {
  return collapse(decodeEntities(stripOverrides(stripTags(line))));
}

function parseTimeToken(token: string): number | undefined {
  const m = TIME_TOKEN.exec(token);
  if (!m) return undefined;
  const hours = m[1] !== undefined ? Number(m[1]) : 0;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  const millis = Number(m[4]);
  return ((hours * 60 + minutes) * 60 + seconds) * 1_000 + millis;
}

/** Decodes bytes as UTF-8 (not fatal), strips a leading BOM and splits on LF, CRLF or CR. */
function toLines(bytes: Uint8Array): string[] {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(BOM, '');
  return text.split(/\r\n|\r|\n/);
}

/** Splits lines into blocks of consecutive non-blank lines, one or more blank lines as separator. */
function splitBlocks(lines: readonly string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length > 0) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

/**
 * One block -> a cue, or `undefined` when its timing line doesn't parse (a cue identifier/index
 * line, a NOTE/STYLE/REGION block and any other malformed block all land here and are skipped).
 */
function parseCueBlock(block: readonly string[]): { startMs: number; lines: string[] } | undefined {
  let m = TIMING_LINE.exec(block[0] ?? '');
  let textStart = 1;
  if (!m) {
    m = TIMING_LINE.exec(block[1] ?? '');
    textStart = 2;
  }
  if (!m) return undefined;
  const startMs = parseTimeToken(m[1] ?? '');
  const endMs = parseTimeToken(m[2] ?? '');
  if (startMs === undefined || endMs === undefined) return undefined;
  const lines = block
    .slice(textStart)
    .map(cleanLine)
    .filter((line) => line !== '');
  return { startMs, lines };
}

/**
 * Parses every cue block in file order, dropping a cue's first line when it only repeats the
 * previous *kept* cue's last line (YouTube's rolling auto-captions repeat each line in the next
 * cue). Cues with bad timing never update that memory and never reach the result.
 */
function parseCueBlocks(lines: readonly string[]): { startMs: number; text: string }[] {
  const cues: { startMs: number; text: string }[] = [];
  let previousLast: string | undefined;
  for (const block of splitBlocks(lines)) {
    const cue = parseCueBlock(block);
    if (!cue) continue;
    const kept =
      cue.lines.length > 0 && cue.lines[0] === previousLast ? cue.lines.slice(1) : cue.lines;
    if (kept.length > 0) previousLast = kept[kept.length - 1];
    cues.push({ startMs: cue.startMs, text: kept.join(' ') });
  }
  return cues;
}

/** Throws when no cue carries any text, so a bad-timing file reports that before its title. */
function requireCues(cues: readonly { startMs: number; text: string }[]): void {
  if (!cues.some((c) => c.text !== '')) {
    throw new IngestError('validation', false, 'the caption file has no captions to learn from');
  }
}

function toDocument(
  title: string,
  cues: readonly { startMs: number; text: string }[],
): ParsedDocument {
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
  return { sourceTitle: title, units: unitsFromTimedText(sorted) };
}

/** Parses a WebVTT caption file (`.vtt`) into timestamped units. The header, then the timing, are
 * checked before the title, so a file with several problems reports its earliest one first. */
export function parseVtt(bytes: Uint8Array, sourceTitle: string): ParsedDocument {
  const lines = toLines(bytes);
  if (!VTT_HEADER.test(lines[0] ?? '')) {
    throw new IngestError('unsupported', false, 'the file is not a WebVTT caption file');
  }
  const cues = parseCueBlocks(lines.slice(1));
  requireCues(cues);
  const title = requireTitle(sourceTitle);
  return toDocument(title, cues);
}

/** Parses an SRT caption file (`.srt`) into timestamped units. The timing is checked before the
 * title, so a file with several problems reports its earliest one first. */
export function parseSrt(bytes: Uint8Array, sourceTitle: string): ParsedDocument {
  const lines = toLines(bytes);
  const cues = parseCueBlocks(lines);
  requireCues(cues);
  const title = requireTitle(sourceTitle);
  return toDocument(title, cues);
}
