// Task 9.4: the fixed English text a student sees for each turn error code. The server's message
// is never shown (it may quote internals); only the code picks the text. The strings live in
// messages/en.json (`chat.errors.*`, Phase C); this exhaustive switch is the key map.
import type { ErrorCode } from '@edmate/contracts';
import messages from '../../messages/en.json';

const TEXT = messages.chat.errors;

/** Fixed student-facing text for `code`. Exhaustive over the contracts enum. */
export function errorText(code: ErrorCode): string {
  switch (code) {
    case 'unauthorized':
    case 'forbidden':
    case 'not_found':
    case 'validation':
    case 'no_access':
    case 'limit_reached':
    case 'rate_limited':
    case 'input_too_large':
    case 'turn_cost_exceeded':
    case 'provider_error':
    case 'guard_blocked':
    case 'payment_required':
      return TEXT[code];
    default: {
      const unknown: never = code;
      void unknown;
      return TEXT.provider_error;
    }
  }
}
