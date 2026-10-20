// The mail port for sign-in links (task 1.4). The app sends through SMTP (nodemailer, any
// provider's `smtp(s)://` URL in EMAIL_SERVER; Mailpit in the sandbox); tests use the in-memory
// `test/memory-mail.ts` and never open a socket.
import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

/** A hung SMTP server must not hang the sign-in request. */
export const SMTP_TIMEOUT_MS = 10_000;

/** The nodemailer SMTP options this adapter sets: the URL plus timeouts and STARTTLS. */
export interface SmtpTransportOptions {
  url: string;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  requireTLS: boolean;
}

/** The part of a nodemailer transport the adapter uses. */
export interface MailTransport {
  sendMail(mail: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown>;
}

export interface SmtpMailOptions {
  /** An `smtp://` or `smtps://` URL; it can hold a password, so it is never logged. */
  server: string;
  from: string;
  /** Refuse to send without STARTTLS (set when AUTH_URL is https). */
  requireTls: boolean;
  /** Tests inject a socket-free transport; the app uses nodemailer's SMTP transport. */
  createTransport?: (options: SmtpTransportOptions) => MailTransport;
}

const nodemailerTransport = (options: SmtpTransportOptions): MailTransport => nodemailer.createTransport(options);

/** A `MailSender` over SMTP. Transport errors propagate unchanged; the caller logs them safely. */
export function smtpMailSender(opts: SmtpMailOptions): MailSender {
  const transport = (opts.createTransport ?? nodemailerTransport)({
    url: opts.server,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    requireTLS: opts.requireTls,
  });
  return {
    async send(message) {
      await transport.sendMail({ from: opts.from, ...message });
    },
  };
}
