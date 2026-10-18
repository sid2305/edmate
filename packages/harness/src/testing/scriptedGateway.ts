// Scripted ModelGateway (task 2.6): replays hand-authored scripts so harness tests never call a
// real model (rule 4). Each method has its own queue; a call takes the first unconsumed entry
// whose predicate matches, and entries without a predicate are taken in script order.
import type { ErrorCode, ModelChunk, ModelGateway, ModelRequest, Usage } from '@edmate/contracts';
import type { ZodType } from 'zod';
import type { Clock } from './clock.js';

export type StreamStep =
  ModelChunk | { type: 'delay'; ms: number } | { type: 'error'; code: ErrorCode; message?: string };

export interface ScriptedStreamCall {
  match?: (req: ModelRequest) => boolean;
  steps: StreamStep[];
}

export interface ScriptedObjectCall {
  match?: (req: ModelRequest) => boolean;
  /** Parsed with the caller's schema before it is returned. */
  value: unknown;
  /** Recorded in `ScriptedGateway.usage` when this entry is used (for metering tests). */
  usage?: Usage;
}

export interface ScriptedEmbedCall {
  match?: (texts: string[]) => boolean;
  vectors: number[][];
  usage?: Usage;
}

export interface GatewayScript {
  stream?: ScriptedStreamCall[];
  generateObject?: ScriptedObjectCall[];
  embed?: ScriptedEmbedCall[];
}

export type GatewayMethod = 'stream' | 'generateObject' | 'embed';

/** What an error may say about the request: never the full prompt or message contents. */
export type RedactedRequest =
  { tier: ModelRequest['tier']; system: string; messageCount: number } | { textCount: number };

/** The script has no entry for this call: a test bug, never a silent empty result. */
export class ScriptedGatewayError extends Error {
  override readonly name = 'ScriptedGatewayError';

  constructor(
    readonly method: GatewayMethod,
    readonly callIndex: number,
    readonly request?: RedactedRequest,
  ) {
    super(
      request === undefined
        ? `ScriptedGateway.${method}: no scripted entry left for call ${callIndex}`
        : `ScriptedGateway.${method}: no scripted entry matches call ${callIndex} ` +
            JSON.stringify(request),
    );
  }
}

/** A scripted `{ type: 'error' }` step: stands in for a provider failure mid-stream. */
export class ScriptedProviderError extends Error {
  override readonly name = 'ScriptedProviderError';

  constructor(
    readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? `scripted ${code}`);
  }
}

export interface RecordedUsage {
  method: GatewayMethod;
  usage: Usage;
}

interface Entry<E> {
  entry: E;
  used: boolean;
}

class Queue<E extends { match?: (x: A) => boolean }, A> {
  private readonly entries: Entry<E>[];
  private calls = 0;

  constructor(entries: readonly E[] | undefined) {
    this.entries = (entries ?? []).map((entry) => ({ entry, used: false }));
  }

  /** Returns the matched entry, or the call index plus whether any entry was left. */
  take(arg: A): { index: number; entry?: E; anyLeft: boolean } {
    const index = this.calls++;
    const left = this.entries.filter((e) => !e.used);
    // Predicates first (in script order), then the first plain entry still in the queue.
    const hit =
      left.find((e) => e.entry.match !== undefined && e.entry.match(arg)) ??
      left.find((e) => e.entry.match === undefined);
    if (hit === undefined) return { index, anyLeft: left.length > 0 };
    hit.used = true;
    return { index, entry: hit.entry, anyLeft: true };
  }
}

/** Deep copy of plain data (arrays and plain objects); anything else is kept as is. */
function copyData<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => copyData(v)) as T;
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]: [string, unknown]) => [k, copyData(v)]),
    ) as T;
  }
  return value;
}

function redactRequest(req: ModelRequest): RedactedRequest {
  return { tier: req.tier, system: req.system.slice(0, 80), messageCount: req.messages.length };
}

export class ScriptedGateway implements ModelGateway {
  private readonly streams: Queue<ScriptedStreamCall, ModelRequest>;
  private readonly objects: Queue<ScriptedObjectCall, ModelRequest>;
  private readonly embeds: Queue<ScriptedEmbedCall, string[]>;
  private readonly recorded: RecordedUsage[] = [];

  constructor(
    script: GatewayScript,
    private readonly clock: Clock,
  ) {
    // Copy the data (not the predicates) so a later edit to the script can't change the replay.
    this.streams = new Queue(script.stream?.map((c) => ({ ...c, steps: copyData(c.steps) })));
    this.objects = new Queue(
      script.generateObject?.map((c) => ({ ...c, value: copyData(c.value) })),
    );
    this.embeds = new Queue(script.embed?.map((c) => ({ ...c, vectors: copyData(c.vectors) })));
  }

  /** Usage seen so far, in the order it was replayed. */
  get usage(): readonly RecordedUsage[] {
    return this.recorded;
  }

  /**
   * The entry is matched when `stream()` is called, so concurrent callers get a fixed entry no
   * matter which iterates first. A missing entry throws on the first iteration, like a provider
   * failure would.
   */
  stream(req: ModelRequest): AsyncIterable<ModelChunk> {
    const taken = this.streams.take(req);
    const steps = taken.entry?.steps;
    const failure =
      steps === undefined
        ? new ScriptedGatewayError(
            'stream',
            taken.index,
            taken.anyLeft ? redactRequest(req) : undefined,
          )
        : undefined;
    return this.replay(steps ?? [], failure);
  }

  private async *replay(
    steps: StreamStep[],
    failure: ScriptedGatewayError | undefined,
  ): AsyncGenerator<ModelChunk> {
    if (failure !== undefined) throw failure;
    for (const step of steps) {
      if (step.type === 'delay') {
        await this.clock.sleep(step.ms);
      } else if (step.type === 'error') {
        throw new ScriptedProviderError(step.code, step.message);
      } else {
        if (step.type === 'usage') this.recorded.push({ method: 'stream', usage: step.usage });
        yield step;
      }
    }
  }

  generateObject<T>(req: ModelRequest, schema: ZodType<T>): Promise<T> {
    const taken = this.objects.take(req);
    if (taken.entry === undefined) {
      return Promise.reject(
        new ScriptedGatewayError(
          'generateObject',
          taken.index,
          taken.anyLeft ? redactRequest(req) : undefined,
        ),
      );
    }
    try {
      const value = schema.parse(taken.entry.value);
      if (taken.entry.usage !== undefined) {
        this.recorded.push({ method: 'generateObject', usage: taken.entry.usage });
      }
      return Promise.resolve(value);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  embed(texts: string[]): Promise<number[][]> {
    const taken = this.embeds.take(texts);
    if (taken.entry === undefined) {
      return Promise.reject(
        new ScriptedGatewayError(
          'embed',
          taken.index,
          taken.anyLeft ? { textCount: texts.length } : undefined,
        ),
      );
    }
    if (taken.entry.usage !== undefined) {
      this.recorded.push({ method: 'embed', usage: taken.entry.usage });
    }
    return Promise.resolve(taken.entry.vectors);
  }
}
