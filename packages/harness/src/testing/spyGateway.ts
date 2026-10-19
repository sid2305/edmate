// Wraps a gateway (normally a ScriptedGateway) to record what the turn asked for (task 3.7): every
// stream request, every `gatewayFor` spec (policy and billing), and every stream iterator
// `return()`, which is how the reader tells the adapter to abort.
import type { ModelChunk, ModelGateway, ModelRequest } from '@edmate/contracts';
import type { TurnGateway, TurnGatewaySpec } from '../pipeline/types.js';

export interface SpyGateway extends ModelGateway {
  /** Copies of every stream request, in call order. */
  readonly requests: ModelRequest[];
  /** Every `gatewayFor` spec, in call order. */
  readonly built: TurnGatewaySpec[];
  /** Stream iterator `return()` calls. */
  readonly returns: number;
  /** A `PipelineDeps.gatewayFor` that records the spec and returns this gateway. */
  gatewayFor(spec: TurnGatewaySpec): TurnGateway;
}

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function spyGateway(inner: ModelGateway, opts: { metered?: boolean } = {}): SpyGateway {
  const requests: ModelRequest[] = [];
  const built: TurnGatewaySpec[] = [];
  let returns = 0;
  const spy: SpyGateway = {
    requests,
    built,
    get returns() {
      return returns;
    },
    gatewayFor(spec) {
      built.push(copy(spec));
      return { gateway: spy, metered: opts.metered ?? false };
    },
    stream(req) {
      requests.push(copy(req));
      const source = inner.stream(req);
      return {
        [Symbol.asyncIterator](): AsyncIterator<ModelChunk> {
          const it = source[Symbol.asyncIterator]();
          return {
            next: () => it.next(),
            return: (value?: unknown) => {
              returns++;
              return it.return?.(value) ?? Promise.resolve({ value: undefined, done: true });
            },
          };
        },
      };
    },
    generateObject: (req, schema) => inner.generateObject(req, schema),
    embed: (texts) => inner.embed(texts),
  };
  return spy;
}
