// The metering wrapper (task 2.4): a ModelGateway that meters every call of the gateway it wraps.
//
// - Every call writes to the sink exactly once per usage figure, when the call ends: normally,
//   by throwing (a failed or truncated attempt still spent tokens), or by the caller breaking out
//   of the stream early.
// - A call that reports no usage is recorded as unknown (`no_usage_reported`), never as free.
// - A model with no price in prices.yaml is recorded with its real tokens and no cost
//   (`unpriced_model:<model>`), plus one loud log line naming the model.
// - Metering never changes what the caller sees: chunks pass through unchanged and unbuffered,
//   errors propagate unchanged, and a failing sink is logged, not thrown. Sink writes are not
//   awaited by the call; `settled()` waits for them (tests, or a worker before it exits).
import type { ModelChunk, ModelGateway, ModelRequest, Usage } from '@edmate/contracts';
import type { ZodType } from 'zod';
import { computeCostMicroUsd } from '../pricing/cost.js';
import type { PriceTable } from '../pricing/load.js';
import type { MeterContext, MeterSink, MeteringWarning, UnmeteredUsage } from './types.js';

type Method = 'stream' | 'generateObject' | 'embed';

export interface MeteringOptions {
  /** Where loud lines go. Defaults to one JSON line on stderr via console.warn. */
  readonly warn?: (w: MeteringWarning) => void;
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

export function createMeteredGateway(
  gateway: ModelGateway,
  sink: MeterSink,
  ctx: MeterContext,
  prices: PriceTable,
  options: MeteringOptions = {},
): MeteredGateway {
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

  /** Called once per call, when it ends; `usages` is every usage figure the call reported. */
  function meter(method: Method, tier: Usage['tier'], usages: readonly Usage[]): void {
    if (usages.length === 0) {
      unmetered(method, { reason: 'no_usage_reported', tier });
      return;
    }
    for (const u of usages) {
      let cost: number | undefined;
      try {
        cost = computeCostMicroUsd(prices, u.model, u.inputTokens, u.outputTokens);
      } catch (err) {
        // Counts the provider adapters already validated; only a broken fake gets here.
        warn({ event: 'metering.failed', method, error: errorName(err) });
        unmetered(method, { reason: 'no_usage_reported', tier: u.tier });
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
  }

  return {
    async *stream(req: ModelRequest): AsyncGenerator<ModelChunk> {
      const usages: Usage[] = [];
      try {
        for await (const chunk of gateway.stream(req)) {
          if (chunk.type === 'usage') usages.push(chunk.usage);
          yield chunk;
        }
      } finally {
        meter('stream', req.tier, usages);
      }
    },

    // The port returns only the value, so these two never see usage today: they are always
    // recorded as unknown until the port carries usage for them (contracts change, ADR).
    async generateObject<T>(req: ModelRequest, schema: ZodType<T>): Promise<T> {
      try {
        return await gateway.generateObject(req, schema);
      } finally {
        meter('generateObject', req.tier, []);
      }
    },

    async embed(texts: string[]): Promise<number[][]> {
      try {
        return await gateway.embed(texts);
      } finally {
        // Embeddings have no tier in the port; the router serves them on main.
        meter('embed', 'main', []);
      }
    },

    async settled(): Promise<void> {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}
