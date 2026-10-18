// The router (task 2.3): sends each request to the adapter for its tier and, on a retryable
// failure, tries the one fallback adapter once. It never names a provider or model itself; it
// only reads the adapters it is given (createRouter in factory.ts resolves a ModelPolicy).
import type { ModelChunk, ModelGateway, ModelRequest } from '@edmate/contracts';
import type { ZodType } from 'zod';
import { GatewayError } from '../adapters/errors.js';
import type { ModelAdapter } from '../adapters/types.js';

export interface RouterOptions {
  readonly tiers: Readonly<Record<ModelRequest['tier'], ModelAdapter>>;
  readonly fallback?: ModelAdapter;
}

/** What a call needs from the adapter that serves it. */
export interface CapabilityNeeds {
  readonly tools: boolean;
  readonly json: boolean;
  readonly embeddings: boolean;
  /** ModelRequest has no vision signal yet, so every call site passes false (lead answer Q1). */
  readonly vision: boolean;
}

const NEEDS_NOTHING: CapabilityNeeds = {
  tools: false,
  json: false,
  embeddings: false,
  vision: false,
};

/** The first capability the adapter lacks for this call, or undefined when it can serve it. */
export function missingCapability(
  adapter: ModelAdapter,
  needs: CapabilityNeeds,
): keyof CapabilityNeeds | undefined {
  const caps = adapter.capabilities;
  if (needs.tools && !caps.tools) return 'tools';
  if (needs.json && !caps.json) return 'json';
  if (needs.embeddings && !caps.embeddings) return 'embeddings';
  if (needs.vision && !caps.vision) return 'vision';
  return undefined;
}

/** A capability mismatch is a policy bug: fail closed before any call, never reroute. */
function assertCapable(adapter: ModelAdapter, needs: CapabilityNeeds): void {
  const missing = missingCapability(adapter, needs);
  if (missing !== undefined) {
    throw new GatewayError(
      'validation',
      false,
      adapter.id,
      `${adapter.id}/${adapter.model}: no ${missing} support for this request`,
    );
  }
}

function requestNeeds(req: ModelRequest, json: boolean): CapabilityNeeds {
  return { ...NEEDS_NOTHING, tools: (req.tools?.length ?? 0) > 0, json };
}

export class Router implements ModelGateway {
  constructor(private readonly opts: RouterOptions) {}

  /**
   * The adapter to try once after `err`, or undefined when `err` must propagate as is. Only a
   * retryable GatewayError qualifies; truncated and content_filter are always non-retryable.
   */
  private fallbackFor(err: unknown, needs: CapabilityNeeds): ModelAdapter | undefined {
    const fallback = this.opts.fallback;
    if (!(err instanceof GatewayError) || !err.retryable || fallback === undefined) {
      return undefined;
    }
    return missingCapability(fallback, needs) === undefined ? fallback : undefined;
  }

  /** Throws a validation GatewayError synchronously when the tier adapter lacks a capability. */
  stream(req: ModelRequest): AsyncIterable<ModelChunk> {
    const primary = this.opts.tiers[req.tier];
    const needs = requestNeeds(req, false);
    assertCapable(primary, needs);
    return this.streamWithFallback(primary, req, needs);
  }

  private async *streamWithFallback(
    primary: ModelAdapter,
    req: ModelRequest,
    needs: CapabilityNeeds,
  ): AsyncGenerator<ModelChunk> {
    let yieldedAny = false;
    let fallback: ModelAdapter | undefined;
    try {
      for await (const chunk of primary.stream(req)) {
        yieldedAny = true;
        yield chunk;
      }
      return;
    } catch (err) {
      // Once output reached the caller, a second model's text must never be spliced onto it.
      fallback = yieldedAny ? undefined : this.fallbackFor(err, needs);
      if (fallback === undefined) throw err;
    }
    // One retry on the fallback model; whatever it throws propagates (pipeline step 8).
    yield* fallback.stream(req);
  }

  generateObject<T>(req: ModelRequest, schema: ZodType<T>): Promise<T> {
    const needs = requestNeeds(req, true);
    return this.callWithFallback(req.tier, needs, (a) => a.generateObject(req, schema));
  }

  /** Embeddings have no tier in the port, so the main tier's adapter serves them. */
  embed(texts: string[]): Promise<number[][]> {
    const needs: CapabilityNeeds = { ...NEEDS_NOTHING, embeddings: true };
    return this.callWithFallback('main', needs, (a) => a.embed(texts));
  }

  private async callWithFallback<R>(
    tier: ModelRequest['tier'],
    needs: CapabilityNeeds,
    call: (adapter: ModelAdapter) => Promise<R>,
  ): Promise<R> {
    const primary = this.opts.tiers[tier];
    assertCapable(primary, needs);
    try {
      return await call(primary);
    } catch (err) {
      const fallback = this.fallbackFor(err, needs);
      if (fallback === undefined) throw err;
      return call(fallback);
    }
  }
}
