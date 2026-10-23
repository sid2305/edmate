import type { EmailProviderSendVerificationRequestParams } from 'next-auth/providers/email';
import { describe, expect, it } from 'vitest';
import { memoryMail } from '../../test/memory-mail';
import {
  CONFIRM_PATH,
  EMAIL_PROVIDER_ID,
  emailProvider,
  escapeHtml,
  LINK_MAX_AGE_S,
  MailSendError,
  normalizeEmail,
  rebuildLink,
  renderSignInMail,
} from './email';

const ORIGIN = new URL('https://app.example.test');
const TOKEN = 'a'.repeat(64);
const QUERY = `?callbackUrl=%2Fteachers&token=${TOKEN}&email=student1%40example.test`;
const CALLBACK = `/api/auth/callback/email${QUERY}`;
/** Task 1.4b: the mailed link goes to the confirm page, never straight to Auth.js's callback. */
const CONFIRM = `${CONFIRM_PATH}${QUERY}`;

describe('normalizeEmail', () => {
  it.each([
    ['student1@example.test', 'student1@example.test'],
    ['  Student1@Example.TEST \n', 'student1@example.test'],
    ['a+tag@example.test', 'a+tag@example.test'],
    ["o'brien@example.test", "o'brien@example.test"],
    ['first.last@sub.example.test', 'first.last@sub.example.test'],
  ])('accepts %j as %j', (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it('applies NFKC first, so a fullwidth @ becomes a second @ and is refused', () => {
    expect(() => normalizeEmail('a＠evil.test@example.test')).toThrow();
  });

  it('accepts exactly 320 characters and refuses 321', () => {
    const at320 = `${'a'.repeat(307)}@example.test`;
    expect(at320).toHaveLength(320);
    expect(normalizeEmail(at320)).toBe(at320);
    expect(() => normalizeEmail(`a${at320}`)).toThrow();
  });

  it.each([
    ['CRLF injection', 'student1@example.test\r\nBcc: victim@example.test'],
    ['inner CRLF', 'stu\r\ndent@example.test'],
    ['a comma (two recipients)', 'a@example.test,b@example.test'],
    ['inner whitespace', 'a b@example.test'],
    ['a tab', 'a\tb@example.test'],
    ['a double quote', '"evil@example.test"@example.test'],
    ['a NUL', 'a\u0000@example.test'],
    ['a DEL', 'a\u007f@example.test'],
    ['two @', 'a@b@example.test'],
    ['no @', 'student1.example.test'],
    ['no domain dot', 'a@localhost'],
    ['empty', ''],
    ['spaces only', '   '],
    ['a Cyrillic homoglyph local part (z.email is ASCII only)', 'аlice@example.test'],
  ])('refuses %s', (_label, input) => {
    expect(() => normalizeEmail(input)).toThrow();
  });

  it.each([undefined, null, 42, {}])('refuses a non-string %j', (input) => {
    expect(() => normalizeEmail(input)).toThrow();
  });

  it('never echoes the input in its error', () => {
    expect(() => normalizeEmail('secret-person@@example.test')).toThrow(/^Invalid email address$/);
  });
});

describe('rebuildLink', () => {
  it('moves Auth.js\'s URL onto the confirm page, keeping its query, on AUTH_URL\'s origin', () => {
    expect(CONFIRM_PATH).toBe('/sign-in/confirm');
    expect(rebuildLink(`https://app.example.test${CALLBACK}`, ORIGIN)).toBe(`https://app.example.test${CONFIRM}`);
  });

  it('rebases a forged host (x-forwarded-host: evil.test) on AUTH_URL\'s origin', () => {
    const link = rebuildLink(`http://evil.test:9999${CALLBACK}`, ORIGIN);
    expect(new URL(link).origin).toBe('https://app.example.test');
    expect(link).toBe(`https://app.example.test${CONFIRM}`);
  });

  it.each([
    '/api/auth/callback/google?token=x',
    '/api/auth/callback/email/extra?token=x',
    '/evil?token=x',
    '/api/auth/callback/EMAIL?token=x',
  ])('throws on a path other than the email callback: %s', (path) => {
    expect(() => rebuildLink(`https://app.example.test${path}`, ORIGIN)).toThrow();
  });

  it('throws on something that is not a URL', () => {
    expect(() => rebuildLink('not a url', ORIGIN)).toThrow();
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML metacharacters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('renderSignInMail', () => {
  const link = `https://app.example.test${CALLBACK}`;
  const mail = renderSignInMail(link);

  it('has the subject, the link, the expiry and the ignore line', () => {
    expect(mail.subject).toBe('Your Edmate sign-in link');
    expect(mail.text).toContain(link);
    expect(mail.text).toContain('expires in 15 minutes');
    expect(mail.text).toContain("If you didn't ask for this, ignore this email.");
    expect(mail.html).toContain('expires in 15 minutes');
  });

  it('HTML-escapes the link (the & between params) and has no images or tracking', () => {
    expect(mail.html).toContain(escapeHtml(link));
    expect(mail.html).not.toContain(`token=${TOKEN}&email`);
    expect(mail.html).not.toMatch(/<img|<script|<style|https?:\/\/(?!app\.example\.test)/i);
  });

  it('does not repeat the address in the body except inside the link', () => {
    const bodyOnly = mail.text.replace(link, '');
    expect(bodyOnly).not.toContain('student1');
  });

  it('escapes a hostile link instead of injecting markup', () => {
    const html = renderSignInMail('https://app.example.test/api/auth/callback/email?x="><script>').html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});

function params(url: string, identifier = 'student1@example.test'): EmailProviderSendVerificationRequestParams {
  return {
    identifier,
    url,
    token: TOKEN,
    expires: new Date(Date.now() + LINK_MAX_AGE_S * 1000),
    provider: {} as EmailProviderSendVerificationRequestParams['provider'],
    theme: {},
    request: new Request('https://app.example.test/api/auth/signin/email'),
  };
}

describe('emailProvider', () => {
  it('is a generic email provider with id "email", a 15-minute maxAge and our normaliser', () => {
    const p = emailProvider({ origin: ORIGIN, from: 'Edmate <sign-in@example.test>', mail: memoryMail() });
    expect(EMAIL_PROVIDER_ID).toBe('email');
    expect(p.id).toBe('email');
    expect(p.type).toBe('email');
    expect(p.maxAge).toBe(900);
    expect(LINK_MAX_AGE_S).toBe(900);
    expect(p.from).toBe('Edmate <sign-in@example.test>');
    expect(p.normalizeIdentifier).toBe(normalizeEmail);
  });

  it('mails one link built on AUTH_URL, to the identifier, even for a forged host', async () => {
    const mail = memoryMail();
    const p = emailProvider({ origin: ORIGIN, from: 'x@example.test', mail });
    await p.sendVerificationRequest(params(`http://evil.test${CALLBACK}`));
    expect(mail.sent).toHaveLength(1);
    const [sent] = mail.sent;
    expect(sent?.to).toBe('student1@example.test');
    expect(sent?.subject).toBe('Your Edmate sign-in link');
    expect(sent?.text).toContain(`https://app.example.test${CONFIRM}`);
    expect(sent?.text).not.toContain('evil.test');
    expect(sent?.html).not.toContain('evil.test');
  });

  it('sends nothing and throws a bare MailSendError for a foreign path, logging the name only', async () => {
    const mail = memoryMail();
    const lines: string[] = [];
    const p = emailProvider({ origin: ORIGIN, from: 'x@example.test', mail, log: (l) => lines.push(l) });
    const err = await Promise.resolve(p.sendVerificationRequest(params('https://app.example.test/evil?email=student1%40example.test'))).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MailSendError);
    expect((err as Error).message).toBe('sign-in mail not sent');
    expect(mail.sent).toEqual([]);
    expect(lines).toEqual(['[auth] sign-in mail failed: Error']);
  });

  it('logs a sender error by name only (nodemailer messages can hold addresses) and rethrows a bare error', async () => {
    const lines: string[] = [];
    class SmtpError extends Error {
      override name = 'SmtpError';
    }
    const mail = memoryMail({ fail: new SmtpError('550 rejected student1@example.test') });
    const p = emailProvider({ origin: ORIGIN, from: 'x@example.test', mail, log: (l) => lines.push(l) });
    const err = await Promise.resolve(p.sendVerificationRequest(params(`https://app.example.test${CALLBACK}`))).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MailSendError);
    expect(JSON.stringify({ m: (err as Error).message, c: (err as Error).cause ?? null })).not.toContain('student1');
    expect(lines).toEqual(['[auth] sign-in mail failed: SmtpError']);
    expect(lines.join()).not.toContain('student1');
  });

  it('a failure joined late (Auth.js hashes first) is not an unhandled rejection, and still rejects', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const mail = memoryMail({ fail: new Error('down') });
      const p = emailProvider({ origin: ORIGIN, from: 'x@example.test', mail, log: () => {} });
      const pending = p.sendVerificationRequest(params(`https://app.example.test${CALLBACK}`));
      // Let the failure settle and the event loop turn before anyone awaits it.
      await new Promise((r) => setTimeout(r, 5));
      await expect(pending).rejects.toBeInstanceOf(MailSendError);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it('logs to console.error by default, and a non-Error throw as "non-error"', async () => {
    const original = console.error;
    const lines: unknown[] = [];
    console.error = (line: unknown) => lines.push(line);
    try {
      const p = emailProvider({
        origin: ORIGIN,
        from: 'x@example.test',
        mail: { send: () => Promise.reject('student1@example.test') },
      });
      await expect(p.sendVerificationRequest(params(`https://app.example.test${CALLBACK}`))).rejects.toBeInstanceOf(
        MailSendError,
      );
    } finally {
      console.error = original;
    }
    expect(lines).toEqual(['[auth] sign-in mail failed: non-error']);
  });
});
