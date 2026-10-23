// Test doubles for other packages' tests (`@edmate/payments/testing`): 10.2, 10.3 and 10.8 code
// against the port with this fake. Nothing here reaches a network; the web app does not use it.
export {
  createFakePayments,
  type FakeEmit,
  type FakeFailure,
  type FakePayments,
  type FakePaymentsOptions,
  type FakeSignatureStyle,
  type FakeSignOptions,
  type SignedWebhook,
} from './fakePayments.js';
