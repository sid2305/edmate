// The email magic-link provider (task 1.4): Auth.js's generic `type: 'email'` provider with id
// `email`, so the routes are `/api/auth/signin/email` and `/api/auth/callback/email`. Auth.js
// makes the token, hashes it before the adapter and checks expiry; Edmate supplies the address
// rules, the link (always on AUTH_URL), the mail body and the send through the `MailSender` port.
import type { EmailConfig, EmailProviderSendVerificationRequestParams } from 'next-auth/providers/email';
import { z } from 'zod';
import { describeError } from './describe-error';
import type { MailSender } from './mail';

export const EMAIL_PROVIDER_ID = 'email';

/** Links live 15 minutes. */
export const LINK_MAX_AGE_S = 15 * 60;

/** RFC 5321's practical upper bound for an address. */
export const MAX_EMAIL_LENGTH = 320;

/** The only path a mailed link may have. */
export const CALLBACK_PATH = `/api/auth/callback/${EMAIL_PROVIDER_ID}`;

const EmailSchema = z.email();

/** Whitespace, a comma, a double quote or a control character: never in an address we accept. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\s,"\u0000-\u001f\u007f]/;

/** A refused address. The message never echoes the input. */
export class InvalidEmailError extends Error {
  override readonly name = 'InvalidEmailError';
  constructor() {
    super('Invalid email address');
  }
}

/**
 * The sign-in identifier: NFKC (so a fullwidth `＠` is a real `@`), trimmed and lower-cased. Throws
 * on anything that could confuse an address parser or split into two recipients.
 */
export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== 'string') throw new InvalidEmailError();
  const email = raw.normalize('NFKC').trim().toLowerCase();
  if (
    email.length === 0 ||
    email.length > MAX_EMAIL_LENGTH ||
    FORBIDDEN.test(email) ||
    email.indexOf('@') !== email.lastIndexOf('@') ||
    !EmailSchema.safeParse(email).success
  ) {
    throw new InvalidEmailError();
  }
  return email;
}

/**
 * The link to mail: Auth.js's path and query on AUTH_URL's origin. With `trustHost`, Auth.js's own
 * URL follows `X-Forwarded-Host`, so a forged host must never reach the mail. A path other than
 * the email callback throws.
 */
export function rebuildLink(authJsUrl: string, origin: URL): string {
  const parsed = new URL(authJsUrl);
  if (parsed.pathname !== CALLBACK_PATH) throw new Error('unexpected sign-in link path');
  return new URL(`${parsed.pathname}${parsed.search}`, origin.origin).toString();
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] as string);
}

export interface SignInMail {
  subject: string;
  text: string;
  html: string;
}

/** The sign-in mail: the link, its lifetime and an ignore line. No images, no tracking. */
export function renderSignInMail(link: string): SignInMail {
  const href = escapeHtml(link);
  return {
    subject: 'Your Edmate sign-in link',
    text: [
      'Sign in to Edmate with this link:',
      '',
      link,
      '',
      'The link expires in 15 minutes and works once.',
      "If you didn't ask for this, ignore this email.",
      '',
    ].join('\n'),
    html: [
      '<!doctype html><html><body>',
      '<p>Sign in to Edmate with this link:</p>',
      `<p><a href="${href}">Sign in to Edmate</a></p>`,
      `<p>${href}</p>`,
      '<p>The link expires in 15 minutes and works once.</p>',
      "<p>If you didn&#39;t ask for this, ignore this email.</p>",
      '</body></html>',
    ].join(''),
  };
}

/** A failed sign-in mail. Bare on purpose: no message or cause that could hold an address. */
export class MailSendError extends Error {
  override readonly name = 'MailSendError';
  constructor() {
    super('sign-in mail not sent');
  }
}

export interface EmailProviderDeps {
  /** AUTH_URL: the only origin a mailed link may have. */
  origin: URL;
  from: string;
  mail: MailSender;
  log?: (line: string) => void;
}

/** Auth.js's email provider, sending through `deps.mail`. */
export function emailProvider(deps: EmailProviderDeps): EmailConfig {
  const log = deps.log ?? ((line: string) => console.error(line));
  return {
    id: EMAIL_PROVIDER_ID,
    type: 'email',
    name: 'Email',
    from: deps.from,
    maxAge: LINK_MAX_AGE_S,
    normalizeIdentifier: normalizeEmail,
    async sendVerificationRequest(params: EmailProviderSendVerificationRequestParams) {
      try {
        const link = rebuildLink(params.url, deps.origin);
        await deps.mail.send({ to: params.identifier, ...renderSignInMail(link) });
      } catch (error) {
        log(`[auth] sign-in mail failed: ${describeError(error)}`);
        throw new MailSendError();
      }
    },
  };
}
