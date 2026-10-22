// The provider-neutral first steps of `parseWebhook` (ADR-0015 §5): the input shape, the 1 MiB
// cap, header lookup and a strict JSON read. Every failure is a PaymentsError with fixed words;
// no body text, header value or parser message ever reaches it.
import { ProviderSubscriptionSchema } from '@edmate/contracts';
import { PaymentsError } from '../errors.js';

/** The contracts ISO 8601 timestamp: a `Z` or a numeric offset, never an offset-less local time. */
export const IsoTimestampSchema = ProviderSubscriptionSchema.shape.periodEnd;

/** Epoch ms of a contracts ISO timestamp; undefined for anything else (bare Date.parse is not used). */
export function isoTimestampMs(value: unknown): number | undefined {
  return IsoTimestampSchema.safeParse(value).success ? Date.parse(value as string) : undefined;
}

/** ADR-0015 §5: a webhook body over 1 MiB is refused before any work. */
export const WEBHOOK_MAX_BYTES = 1024 * 1024;

export interface WebhookInput {
  rawBody: Uint8Array;
  headers: Readonly<Record<string, string>>;
  receivedAt: string;
}

/**
 * Checks what the route hands over: bytes (not a re-serialised string) of at most 1 MiB
 * (`malformed_event`), a headers record and a receivedAt that is an ISO timestamp with a `Z` or an
 * offset (`validation`).
 */
export function checkWebhookInput(x: WebhookInput): void {
  if (!(x.rawBody instanceof Uint8Array) || x.rawBody.length > WEBHOOK_MAX_BYTES) {
    throw new PaymentsError('malformed_event');
  }
  if (typeof x.headers !== 'object' || x.headers === null) throw new PaymentsError('validation');
  if (isoTimestampMs(x.receivedAt) === undefined) throw new PaymentsError('validation');
}

/** The header's value by its lower-case name, own properties only; undefined when absent. */
export function readHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  const value: unknown = Object.hasOwn(headers, name) ? headers[name] : undefined;
  return typeof value === 'string' ? value : undefined;
}

const decoder = new TextDecoder('utf-8', { fatal: true });

/** The body as JSON. Invalid UTF-8 or JSON is `malformed_event`; the parser's words are dropped. */
export function parseJsonBody(rawBody: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(rawBody)) as unknown;
  } catch {
    throw new PaymentsError('malformed_event');
  }
}
