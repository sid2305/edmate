// Task 9.4: the fixed English text a student sees for each turn error code. The server's message
// is never shown (it may quote internals); only the code picks the text. Phase C may move these
// strings into messages/en.json (`chat.*`) keeping this exhaustive switch as the key map.
import type { ErrorCode } from '@edmate/contracts';

const GENERIC = 'Something went wrong. Please try again.';

/** Fixed student-facing text for `code`. Exhaustive over the contracts enum. */
export function errorText(code: ErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Please sign in again to keep chatting.';
    case 'forbidden':
      return "You can't use this chat yet.";
    case 'not_found':
      return 'This chat is not available any more. Start a new one.';
    case 'validation':
      return "That message couldn't be sent. Please check it and try again.";
    case 'no_access':
      return 'You need a live package with this teacher to chat.';
    case 'limit_reached':
      return "You've used today's messages in your package. Come back tomorrow.";
    case 'rate_limited':
      return "You're sending messages quickly. Wait a moment, then try again.";
    case 'input_too_large':
      return 'That message is too long. Please make it shorter.';
    case 'turn_cost_exceeded':
      return 'That question needs too much work for one reply. Try asking a smaller part.';
    case 'provider_error':
      return GENERIC;
    case 'guard_blocked':
      return "I can't help with that here. Let's get back to your learning.";
    case 'payment_required':
      return 'Your package needs a payment before you can keep chatting.';
    default: {
      const unknown: never = code;
      void unknown;
      return GENERIC;
    }
  }
}
