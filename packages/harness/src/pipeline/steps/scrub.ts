// Step 3a, the PII scrub (task 4.2): runs the scrub-phase guard chain (piiScrub) over the input
// text and over every string in the skill payload, before anything else sees them. The runner
// threads the result into every later step, the model and CommitRecord (history), never the raw
// input. Transcripts (2.7) arrive as `input.text`, so they are scrubbed here too.
//
// Task 4.2b: any turn carrying an attachment is refused outright, before the guard chain or the
// skill-payload walk even starts — not even its bytes or storage key are read. No OCR/vision
// pipeline exists yet (photo upload is P1 in the PRD); this is the safe stopgap until a real
// extract-and-scrub pipeline is designed and built for that task (board task 4.2b design note).
//
// Fail closed: any chain outcome but `ok` (a failure, a block, a rewrite the second pass did not
// accept, an escalate) throws ScrubFailedError with ids and an error name only, never a message,
// reason or text; the runner then ends the turn with `guard_blocked` and reports the error.
import type { Guard } from '../../guardrails/guard.js';
import { type PiiCategory, PII_PLACEHOLDERS } from '../../guardrails/piiPatterns.js';
import { createPiiScrubGuard, type PiiScrubCtx } from '../../guardrails/piiScrub.js';
import { GuardRegistry } from '../../guardrails/registry.js';
import { type GuardChainResult, runGuardChain } from '../../guardrails/chain.js';
import { ScrubFailedError, type ScrubFailureDetail } from '../errors.js';
import type { GuardTrace, Scrubbed, StepEnv, Steps } from '../types.js';

/** Each guard's own time slice; the scrub shares step 3's 400 ms budget with preGuard. */
export const SCRUB_GUARD_TIMEOUT_MS = 100;
/** Deeper payloads fail closed rather than risk the stack. */
const MAX_PAYLOAD_DEPTH = 64;

/** The scrub-phase registry (piiScrub): exported (4.9, Refresh item 7) so a completeness test can
 * read the registry this step really uses, matching `preGuard.ts`'s `defaultPreGuardRegistry()`. */
export function defaultScrubRegistry(): GuardRegistry<PiiScrubCtx> {
  const r = new GuardRegistry<PiiScrubCtx>('scrub');
  r.register(createPiiScrubGuard());
  return r;
}

const registry = defaultScrubRegistry();

const payloadShape = (): ScrubFailedError => new ScrubFailedError({ guardCause: 'payload_shape' });

/**
 * 4.2b's fixed, friendly English reply for an attachment-refused turn. Not yet wired to any
 * client-visible channel: the wire `TurnEvent`'s `error` variant carries no text field (the same
 * pre-existing gap `DEFAULT_LIMIT_REACHED_REPLY` has); exported for whichever later task wires
 * guard-blocked replies to the stream.
 */
export const ATTACHMENT_REFUSED_REPLY =
  "I can't look at photos or files yet, only text. Please type out the question (or what the " +
  "image shows) and I'll help from there.";

function failureOf(r: Exclude<GuardChainResult, { outcome: 'ok' }>): ScrubFailureDetail {
  switch (r.outcome) {
    case 'failed':
      return r.failure.errorName === undefined
        ? { guardCause: r.failure.cause }
        : { guardCause: r.failure.cause, errorName: r.failure.errorName };
    case 'block':
      return { guardCause: r.cause };
    case 'escalate':
      return { guardCause: 'escalate' };
  }
}

interface Run {
  text: string;
  guards: GuardTrace[];
}

/** The scrub step over `guards` (default: the registered scrub-phase guards). */
export function createScrub(
  guards: readonly Guard<PiiScrubCtx>[] = registry.ordered(),
): Steps['scrub'] {
  return async (env: StepEnv, e): Promise<Scrubbed> => {
    // 4.2b: any attachment is refused before anything about it — not even its bytes or storage
    // key — is read. No OCR/vision pipeline exists yet; this is the safe stopgap until one does.
    if (env.input.attachments !== undefined && env.input.attachments.length > 0) {
      throw new ScrubFailedError({ guardCause: 'attachment' });
    }
    const ctx: PiiScrubCtx = { locale: e.locale };
    const opts = {
      phase: 'scrub' as const,
      clock: env.deps.clock,
      timeoutMs: SCRUB_GUARD_TIMEOUT_MS,
      cancel: env.cancel,
    };
    const scrubOne = async (text: string): Promise<Run> => {
      const r = await runGuardChain(guards, text, ctx, opts);
      if (r.outcome !== 'ok') throw new ScrubFailedError(failureOf(r));
      return { text: r.text, guards: r.guards };
    };

    const { text, skillPayload } = env.input;
    const payload = skillPayload === undefined ? undefined : asJson(skillPayload);
    // Every distinct payload string (values, keys, numbers as text), each scrubbed once.
    const strings = new Set<string>();
    if (payload !== undefined) collect(payload, strings, 0);
    const list = [...strings];
    // Started together rather than one after another: each run keeps its own guard slice and the
    // step's single cancel token covers all of them. (The regex work itself is synchronous, so the
    // runs still take turns on the thread; this only avoids chaining one await per string.)
    const [main, ...runs] = await Promise.all([text ?? '', ...list].map(scrubOne));
    const out: Scrubbed = { guards: [...(main as Run).guards] };
    if (text !== undefined) out.text = (main as Run).text;

    if (payload !== undefined) {
      const scrubbed = new Map(list.map((s, i) => [s, (runs[i] as Run).text]));
      const state = { keyed: false };
      out.skillPayload = rebuild(payload, scrubbed, state, undefined, undefined);
      // One rewrite entry for the payload, not one per string.
      const rewrite = runs.find((r, i) => r.text !== list[i]);
      if (rewrite !== undefined) out.guards.push(...rewrite.guards);
      // A value redacted by its key alone has no chain run of its own to show.
      else if (state.keyed) out.guards.push({ name: 'piiScrub', ok: false, action: 'rewrite' });
    }
    return out;
  };
}

export const scrub: Steps['scrub'] = createScrub();

/** Plain JSON data (what the payload means on the wire), or fail closed. */
function asJson(payload: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(payload) as string) as unknown;
  } catch {
    throw payloadShape();
  }
}

function collect(v: unknown, into: Set<string>, depth: number): void {
  if (typeof v === 'string') into.add(v);
  else if (typeof v === 'number') into.add(String(v));
  else if (typeof v === 'object' && v !== null) {
    if (depth >= MAX_PAYLOAD_DEPTH) throw payloadShape();
    for (const [k, x] of Object.entries(v)) {
      if (!Array.isArray(v)) into.add(k);
      collect(x, into, depth + 1);
    }
  }
}

/**
 * A key that says its value is PII ("otp", "name", "phone_number", "studentName", "upi-id", ...):
 * the whole value is redacted, since a bare "482913" or "Riya" has no keyword of its own.
 *
 * "card", "name" and "pin" are also ambiguous bare words — a flashcard's "card", a file's "name",
 * a map or GPIO "pin" all hold ordinary teaching content, not PII — but (fix round, CRITICAL
 * regression from 4.2c item 7) that ambiguity must never block a bare key's own direct scalar
 * value: `{"name":"Riya Sen"}` is still a name. Three gates are narrower instead:
 *  - a bare "name" whose nearest enclosing key is file-shaped (`files`, `file`, `module`,
 *    `function`, `variable`, `class`) is left alone only when the value ALSO looks like a file
 *    name or a plain identifier (fix round 2, HIGH: a parent-only check let a real person's name
 *    under `files`/`module`/`function`/`class`/`variable` go unredacted at any depth —
 *    `{"files":[{"name":"main.py"}]}` stays, but `{"files":[{"name":"Riya Sen"}]}`,
 *    `{"module":{"name":"Riya"}}` and the like still redact; unsure cases redact);
 *  - a bare "name" whose value is itself an object only redacts that object's own direct
 *    name-shaped fields (`first`, `last`, `full`, `middle`, ...), not every field in it
 *    (`{"name":{"first":"Riya","last":"Sen"}}`, but a `nickname` sibling stays, same as any other
 *    PII-named key's unrelated nested keys always have);
 *  - a bare "pin" only redacts a value that is itself PIN/postcode-shaped: numeric, 4-6 digits
 *    (`{"pin":13}` stays, `{"pin":"411001"}` redacts).
 * `cardNumber`, `studentName`, `pinCode` and the like (a prefix or suffix present) are unaffected
 * by any of this and always redact in full, same as before.
 */
const PII_KEY =
  /^(my|student|parent|user|first|last|full|contact)?(otp|pin|cvv|cvc|card|phone|mobile|whatsapp|email|mail|name|aadhaar|aadhar|pan|upi)(number|no|num|id|address|code)?$/;
const KEY_CATEGORY: Readonly<Record<string, PiiCategory>> = {
  otp: 'otp',
  pin: 'otp',
  cvv: 'card',
  cvc: 'card',
  card: 'card',
  phone: 'phone',
  mobile: 'phone',
  whatsapp: 'phone',
  email: 'email',
  mail: 'email',
  name: 'name',
  aadhaar: 'id',
  aadhar: 'id',
  pan: 'id',
  upi: 'id',
};
/** A bare "name" under one of these keys (through any number of arrays) MAY be a file, not a
 * person — but only once the value shape agrees too (see `looksFileOrIdentifier`). */
const FILE_LIKE_PARENT: ReadonlySet<string> = new Set([
  'files',
  'file',
  'module',
  'function',
  'variable',
  'class',
]);
/** A file name's extension ("main.py", "notes.md"): a dot, then letters/digits, at the end. */
const DOT_EXTENSION = /\.[A-Za-z0-9]+$/;
/** A single identifier-shaped token: starts with a letter or underscore, no whitespace. */
const IDENTIFIER_TOKEN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
/** A bare capitalised word ("Riya"): shaped exactly like a first name, not an identifier. */
const TITLE_CASE_SINGLE_WORD = /^[A-Z][a-z]+$/;

/**
 * True only for a value that looks like a file name or a plain code identifier: a dot-extension,
 * or a single no-whitespace token that isn't just a bare Title-Case word (fix round 2, HIGH: the
 * file-like-PARENT check alone let `{"files":[{"name":"Riya Sen"}]}` go unredacted). Anything
 * else — including a single Title-Case word, since that is exactly what a first name looks like —
 * fails toward privacy and is treated as not file/identifier-shaped.
 */
function looksFileOrIdentifier(value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return false;
  if (DOT_EXTENSION.test(value)) return true;
  return IDENTIFIER_TOKEN.test(value) && !TITLE_CASE_SINGLE_WORD.test(value);
}
/** A bare "name" key's object value: only these direct fields are name-shaped on their own. */
const NAME_SUBFIELDS: ReadonlySet<string> = new Set([
  'first',
  'last',
  'full',
  'middle',
  'firstname',
  'lastname',
  'fullname',
  'middlename',
]);
/** How `scrub.ts`'s normal `keyCategory` match combines with the bare-"pin" digit gate below. */
type Under = PiiCategory | 'pinBare' | undefined;

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[\s_.-]/g, '');

/**
 * `enclosingKey` is the nearest key whose value directly contains this one (through any number of
 * arrays), used with `value` only to tell a bare "name" apart from a file's own "name" field (both
 * the parent key and the value's own shape have to agree; see `looksFileOrIdentifier`).
 */
function keyCategory(key: string, value: unknown, enclosingKey: string | undefined): Under {
  const norm = normalizeKey(key);
  const m = PII_KEY.exec(norm);
  if (m === null) return undefined;
  const [, prefix, core, suffix] = m;
  const bare = prefix === undefined && suffix === undefined;
  if (bare) {
    if (
      core === 'name' &&
      enclosingKey !== undefined &&
      FILE_LIKE_PARENT.has(normalizeKey(enclosingKey)) &&
      looksFileOrIdentifier(value)
    ) {
      return undefined;
    }
    if (core === 'pin') return 'pinBare';
  }
  return KEY_CATEGORY[core as string];
}

/**
 * The placeholder a scalar `v` under category `under` redacts to, or `undefined` when it stays as
 * is (either `under` doesn't apply to a scalar, or a bare "pin" value isn't PIN/postcode-shaped:
 * numeric, 4-6 digits).
 */
function keyedPlaceholder(under: Under, v: unknown): string | undefined {
  if (under === undefined) return undefined;
  if (typeof v !== 'number' && !(typeof v === 'string' && v !== '')) return undefined;
  if (under === 'pinBare') {
    const digits = (typeof v === 'number' ? String(v) : v).replace(/\D/g, '');
    return digits.length >= 4 && digits.length <= 6 ? PII_PLACEHOLDERS.otp : undefined;
  }
  return PII_PLACEHOLDERS[under];
}

function rebuild(
  v: unknown,
  scrubbed: ReadonlyMap<string, string>,
  state: { keyed: boolean },
  under: Under,
  enclosingKey: string | undefined,
): unknown {
  const of = (s: string): string => {
    const r = scrubbed.get(s);
    if (r === undefined) throw payloadShape();
    return r;
  };
  const placeholder = keyedPlaceholder(under, v);
  if (placeholder !== undefined) {
    state.keyed = true;
    return placeholder;
  }
  if (typeof v === 'string') return of(v);
  if (typeof v === 'number') {
    // A phone or ID sent as a number is PII too: it comes back as its placeholder string.
    const s = String(v);
    return of(s) === s ? v : of(s);
  }
  if (typeof v !== 'object' || v === null) return v;
  // An array is still the key's own value (`studentName: ["Riya", "Sen"]`), so `under` and
  // `enclosingKey` carry on into it unchanged; an object is one more level of keying, so a
  // PII-named key only redacts its own direct scalar/array value, never descends into unrelated
  // nested keys (`{"studentName":{"nickname":"Riya"}}` leaves "nickname" alone) — except a bare
  // "name" key's object value, whose own direct name-shaped fields (`first`, `last`, `full`, ...)
  // still redact (`{"name":{"first":"Riya","last":"Sen"}}`).
  if (Array.isArray(v)) {
    return v.map((x: unknown) => rebuild(x, scrubbed, state, under, enclosingKey));
  }
  const nameFields = under === 'name' ? NAME_SUBFIELDS : undefined;
  const entries: [string, unknown][] = [];
  const keys = new Set<string>();
  for (const [k, x] of Object.entries(v)) {
    const key = of(k);
    if (keys.has(key)) throw payloadShape();
    keys.add(key);
    const forced = nameFields?.has(normalizeKey(k)) ? ('name' as const) : undefined;
    entries.push([key, rebuild(x, scrubbed, state, forced ?? keyCategory(k, x, enclosingKey), k)]);
  }
  // fromEntries defines own keys, so a "__proto__" key never sets the prototype.
  return Object.fromEntries(entries);
}
