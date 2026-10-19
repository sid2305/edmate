// Metering (task 2.4): every provider attempt writes one usage row.
//
// Metering wraps each adapter, not the router: when the router fails over, the failed primary
// attempt (which reached a provider and may have spent tokens) is metered as well as the fallback
// that answered. `meterRouter(router, …)` is the usual entry point; it rebuilds the router over
// metered adapters.
//
// - Each attempt writes to the sink once per usage figure when it ends: normally, by throwing (a
//   failed or truncated attempt still spent tokens), or by the caller breaking out early.
// - An attempt that reports no usage is recorded as unknown (`no_usage_reported`), never as free.
// - A model with no price in prices.yaml is recorded with its real tokens and no cost
//   (`unpriced_model:<model>`), plus one loud log line naming the model.
// - Metering never changes what the caller sees: chunks pass through unchanged and unbuffered,
//   errors propagate unchanged, and a failing sink is logged, not thrown. Sink writes are not
//   awaited by the call; `settled()` waits for them. Durable retry of failed writes is 3.8's.
import type {
  ModelChunk,
  ModelGateway,
  ModelRequest,
  TranscribeInput,
  Transcript,
  Usage,
} from '@edmate/contracts';
import type { ZodType } from 'zod';
import type { ModelAdapter } from '../adapters/types.js';
import { computeCostMicroUsd } from '../pricing/cost.js';
import type { PriceTable } from '../pricing/load.js';
import type { Router } from '../router/router.js';
import type { ModelTranscriber } from '../transcriber/whisper.js';
import type {
  MeterContext,
  MeteredMethod,
  MeterSink,
  MeteringWarning,
  UnmeteredUsage,
} from './types.js';

type Method = MeteredMethod;

export interface MeteringOptions {
  /** Where loud lines go. Defaults to one JSON line on stderr via console.warn. */
  readonly warn?: (w: MeteringWarning) => void;
}

/** One turn's metering: where rows go, who pays, and the writes still in flight. */
export interface Meter {
  /** Meters one finished attempt on `model`; `usages` is every usage figure it reported. */
  attempt(method: Method, tier: Usage['tier'], model: string, usages: readonly Usage[]): void;
  /** Resolves once every sink write started so far has finished (writes never reject this). */
  settled(): Promise<void>;
}

export interface MeteredGateway extends ModelGateway {
  /** Resolves once every sink write started so far has finished (writes never reject this). */
  settled(): Promise<void>;
}

const defaultWarn = (w: MeteringWarning): void => {
  console.warn(JSON.stringify(w));
};

/** Only the five billing fields, so nothing else a caller put on ctx can reach the sink. */
function billingOf(ctx: MeterContext): MeterContext {
  return Object.freeze({
    teacherId: ctx.teacherId,
    packageId: ctx.packageId,
    studentId: ctx.studentId,
    turnId: ctx.turnId,
    source: ctx.source,
  });
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export function createMeter(
  sink: MeterSink,
  ctx: MeterContext,
  prices: PriceTable,
  options: MeteringOptions = {},
): Meter {
  const billing = billingOf(ctx);
  const warn = options.warn ?? defaultWarn;
  const pending = new Set<Promise<void>>();

  /** Starts one sink write; a sync throw or a rejection becomes a warning, never the caller's. */
  function write(method: Method, start: () => Promise<void>): void {
    let p: Promise<void>;
    try {
      p = start();
    } catch (err) {
      p = Promise.reject(err);
    }
    const tracked = p.then(
      () => undefined,
      (err: unknown) => {
        warn({ event: 'metering.failed', method, error: errorName(err) });
      },
    );
    pending.add(tracked);
    void tracked.finally(() => pending.delete(tracked));
  }

  function unmetered(method: Method, u: Omit<UnmeteredUsage, keyof MeterContext>): void {
    write(method, () => sink.recordUnmetered({ ...billing, ...u }));
  }

  return {
    attempt(method, tier, model, usages) {
      if (usages.length === 0) {
        unmetered(method, { reason: 'no_usage_reported', tier, model });
        return;
      }
      for (const u of usages) {
        let cost: number | undefined;
        try {
          cost = computeCostMicroUsd(prices, u.model, u.inputTokens, u.outputTokens);
        } catch (err) {
          // Counts the provider adapters already validated; only a broken fake gets here.
          warn({ event: 'metering.failed', method, error: errorName(err) });
          unmetered(method, { reason: 'no_usage_reported', tier: u.tier, model });
          continue;
        }
        if (cost === undefined) {
          warn({ event: 'metering.unpriced_model', model: u.model });
          unmetered(method, {
            reason: `unpriced_model:${u.model}`,
            tier: u.tier,
            model: u.model,
            tokens: { inputTokens: u.inputTokens, outputTokens: u.outputTokens },
          });
          continue;
        }
        const priced: Usage = {
          model: u.model,
          tier: u.tier,
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          costMicroUsd: cost,
        };
        write(method, () => sink.record(priced, billing));
      }
    },

    async settled() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}

/** The adapter with every call metered as one attempt on `adapter.model`. */
export function meterAdapter(adapter: ModelAdapter, meter: Meter): ModelAdapter {
  return {
    id: adapter.id,
    model: adapter.model,
    capabilities: adapter.capabilities,

    async *stream(req: ModelRequest): AsyncGenerator<ModelChunk> {
      const usages: Usage[] = [];
      try {
        for await (const chunk of adapter.stream(req)) {
          if (chunk.type === 'usage') usages.push(chunk.usage);
          yield chunk;
        }
      } finally {
        meter.attempt('stream', req.tier, adapter.model, usages);
      }
    },

    // The port returns only the value, so these two never see usage: every attempt is recorded
    // as unknown until the port carries usage for them (a contracts change, ADR).
    async generateObject<T>(req: ModelRequest, schema: ZodType<T>): Promise<T> {
      try {
        return await adapter.generateObject(req, schema);
      } finally {
        meter.attempt('generateObject', req.tier, adapter.model, []);
      }
    },

    async embed(texts: string[]): Promise<number[][]> {
      try {
        return await adapter.embed(texts);
      } finally {
        // Embeddings have no tier in the port; the router serves them on main.
        meter.attempt('embed', 'main', adapter.model, []);
      }
    },
  };
}

/**
 * The transcriber with every call metered as one attempt on `transcriber.model` (task 2.7). The
 * port returns no usage figure, so each attempt is recorded as unknown (`no_usage_reported`)
 * until per-minute pricing exists; `Transcript.durationMs` is what that pricing will use.
 */
export function meterTranscriber(transcriber: ModelTranscriber, meter: Meter): ModelTranscriber {
  return {
    model: transcriber.model,
    async transcribe(i: TranscribeInput): Promise<Transcript> {
      try {
        return await transcriber.transcribe(i);
      } finally {
        // Transcription has no tier in the port; it is recorded on main, like embed.
        meter.attempt('transcribe', 'main', transcriber.model, []);
      }
    },
  };
}

/** The router with every provider attempt metered for one turn's context. */
export function meterRouter(
  router: Router,
  sink: MeterSink,
  ctx: MeterContext,
  prices: PriceTable,
  options: MeteringOptions = {},
): MeteredGateway {
  const meter = createMeter(sink, ctx, prices, options);
  const routed = router.withAdapters((a) => meterAdapter(a, meter));
  return {
    stream: (req) => routed.stream(req),
    generateObject: (req, schema) => routed.generateObject(req, schema),
    embed: (texts) => routed.embed(texts),
    settled: () => meter.settled(),
  };
}
