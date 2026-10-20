// An in-memory `MailSender` for tests (task 1.4): it records each message, and can be made to fail.
import type { MailMessage, MailSender } from '../src/auth/mail';

export interface MemoryMail extends MailSender {
  readonly sent: MailMessage[];
}

export function memoryMail(opts: { fail?: unknown } = {}): MemoryMail {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message) {
      if (opts.fail !== undefined) throw opts.fail;
      sent.push({ ...message });
    },
  };
}
