// What every provider adapter is: the ModelGateway port plus what it can do. Capabilities sit
// beside the port, not in it: they are routing data (task 2.3), and the contract is frozen.
import type { ModelGateway } from '@edmate/contracts';
import type { ProviderId } from '../keys/providers.js';

export interface AdapterCapabilities {
  /** Can call tools (ModelRequest.tools). */
  readonly tools: boolean;
  /** Streams text as it is generated. */
  readonly streaming: boolean;
  /** generateObject returns schema-checked JSON. */
  readonly json: boolean;
  /** Accepts images. ModelRequest is text-only today, so this is routing data only. */
  readonly vision: boolean;
  /** embed() returns vectors; false means embed() throws a GatewayError. */
  readonly embeddings: boolean;
  /** Context window of the configured model, in tokens. */
  readonly maxContextTokens: number;
}

export interface ModelAdapter extends ModelGateway {
  readonly id: ProviderId;
  /** The model id this adapter is bound to. */
  readonly model: string;
  readonly capabilities: AdapterCapabilities;
}
