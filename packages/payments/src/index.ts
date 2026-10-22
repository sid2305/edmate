// @edmate/payments (ADR-0015): what every Payments adapter shares, and the market-to-provider
// registry callers use. Callers never import an adapter; the test fake is `@edmate/payments/testing`.
export {
  PAYMENTS_ERROR_CODES,
  PaymentsError,
  isPaymentsError,
  type PaymentsErrorCode,
  type PaymentsErrorOptions,
} from './errors.js';
export { checkPortInput, PortInputSchemas, type PortInput, type PortOperation } from './input.js';
export { createPaymentsRegistry, UNWIRED_PROVIDER, type PaymentsRegistry } from './registry.js';
export { Secret } from './secret.js';
export {
  checkWebhookInput,
  parseJsonBody,
  readHeader,
  WEBHOOK_MAX_BYTES,
  type WebhookInput,
} from './webhook/body.js';
export {
  checkSignedTimestamp,
  concatBytes,
  hmacSha256Hex,
  matchesAnySignature,
  MAX_TIMESTAMP_TOLERANCE_SECONDS,
} from './webhook/hmac.js';
