// Step 3a, the PII scrub (task 4.2): runs the scrub-phase guard chain (piiScrub) over the input
// text and over every string in the skill payload, before anything else sees them. The runner
// threads the result into every later step, the model and CommitRecord (history), never the raw
// input. Transcripts (2.7) arrive as `input.text`, so they are scrubbed here too; text inside
// images is task 4.2b.
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

const registry = new GuardRegistry<PiiScrubCtx>('scrub');
registry.register(createPiiScrubGuard());

const payloadShape = (): ScrubFailedError => new ScrubFailedError({ guardCause: 'payload_shape' });

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
      out.skillPayload = rebuild(payload, scrubbed, state, undefined);
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
 */
const PII_KEY =
  /^(?:my|student|parent|user|first|last|full|contact)?(otp|pin|cvv|cvc|card|phone|mobile|whatsapp|email|mail|name|aadhaar|aadhar|pan|upi)(?:number|no|num|id|address|code)?$/;
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

function keyCategory(key: string): PiiCategory | undefined {
  const m = PII_KEY.exec(key.toLowerCase().replace(/[\s_.-]/g, ''));
  return m === null ? undefined : KEY_CATEGORY[m[1] as string];
}

function rebuild(
  v: unknown,
  scrubbed: ReadonlyMap<string, string>,
  state: { keyed: boolean },
  under: PiiCategory | undefined,
): unknown {
  const of = (s: string): string => {
    const r = scrubbed.get(s);
    if (r === undefined) throw payloadShape();
    return r;
  };
  if (under !== undefined && (typeof v === 'number' || (typeof v === 'string' && v !== ''))) {
    state.keyed = true;
    return PII_PLACEHOLDERS[under];
  }
  if (typeof v === 'string') return of(v);
  if (typeof v === 'number') {
    // A phone or ID sent as a number is PII too: it comes back as its placeholder string.
    const s = String(v);
    return of(s) === s ? v : of(s);
  }
  if (typeof v !== 'object' || v === null) return v;
  if (Array.isArray(v)) return v.map((x: unknown) => rebuild(x, scrubbed, state, under));
  const entries: [string, unknown][] = [];
  const keys = new Set<string>();
  for (const [k, x] of Object.entries(v)) {
    const key = of(k);
    if (keys.has(key)) throw payloadShape();
    keys.add(key);
    entries.push([key, rebuild(x, scrubbed, state, under ?? keyCategory(k))]);
  }
  // fromEntries defines own keys, so a "__proto__" key never sets the prototype.
  return Object.fromEntries(entries);
}
