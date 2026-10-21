import nodemailer from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';
import { memoryMail } from '../../test/memory-mail';
import { SMTP_TIMEOUT_MS, smtpMailSender, type SmtpTransportOptions } from './mail';

// Built at runtime and obviously fake: no real SMTP credentials in a public repo.
const SERVER = ['smtp://', 'test-user', ':', 'not-a-real-pass', '@', 'smtp.example.test:2525'].join('');
const FROM = 'Edmate <sign-in@example.test>';
const MESSAGE = {
  to: 'student1@example.test',
  subject: 'Your Edmate sign-in link',
  text: 'plain body',
  html: '<p>html body</p>',
};

/** A factory over nodemailer's jsonTransport: no socket, and it records what it was asked. */
function jsonFactory() {
  const seen: { options?: SmtpTransportOptions; json?: unknown } = {};
  const factory = (options: SmtpTransportOptions) => {
    seen.options = options;
    const transport = nodemailer.createTransport({ jsonTransport: true });
    return {
      async sendMail(mail: Parameters<typeof transport.sendMail>[0]) {
        const info = await transport.sendMail(mail);
        seen.json = JSON.parse(info.message as unknown as string);
        return info;
      },
    };
  };
  return { factory, seen };
}

describe('smtpMailSender', () => {
  it('passes to, from, subject, text and html through to the transport', async () => {
    const { factory, seen } = jsonFactory();
    await smtpMailSender({ server: SERVER, from: FROM, requireTls: false, createTransport: factory }).send(MESSAGE);
    expect(seen.json).toMatchObject({
      from: { address: 'sign-in@example.test', name: 'Edmate' },
      to: [{ address: 'student1@example.test', name: '' }],
      subject: MESSAGE.subject,
      text: MESSAGE.text,
      html: MESSAGE.html,
    });
  });

  it('sets 10 s connection, greeting and socket timeouts on the SMTP URL', () => {
    const { factory, seen } = jsonFactory();
    smtpMailSender({ server: SERVER, from: FROM, requireTls: false, createTransport: factory });
    expect(SMTP_TIMEOUT_MS).toBe(10_000);
    expect(seen.options).toEqual({
      url: SERVER,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
      requireTLS: false,
    });
  });

  it('requires STARTTLS when asked (an https AUTH_URL)', () => {
    const { factory, seen } = jsonFactory();
    smtpMailSender({ server: SERVER, from: FROM, requireTls: true, createTransport: factory });
    expect(seen.options?.requireTLS).toBe(true);
  });

  it('builds a real nodemailer SMTP transport by default without opening a socket', () => {
    const spy = vi.spyOn(nodemailer, 'createTransport');
    smtpMailSender({ server: SERVER, from: FROM, requireTls: true });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ url: SERVER, requireTLS: true }));
    spy.mockRestore();
  });

  it('lets a transport error bubble up unchanged', async () => {
    const boom = new Error('connect refused');
    const sender = smtpMailSender({
      server: SERVER,
      from: FROM,
      requireTls: false,
      createTransport: () => ({ sendMail: () => Promise.reject(boom) }),
    });
    await expect(sender.send(MESSAGE)).rejects.toBe(boom);
  });
});

describe('memoryMail', () => {
  it('records each message in order', async () => {
    const mail = memoryMail();
    await mail.send(MESSAGE);
    await mail.send({ ...MESSAGE, to: 'student2@example.test' });
    expect(mail.sent.map((m) => m.to)).toEqual(['student1@example.test', 'student2@example.test']);
  });

  it('can be made to fail', async () => {
    const mail = memoryMail({ fail: new Error('down') });
    await expect(mail.send(MESSAGE)).rejects.toThrow('down');
    expect(mail.sent).toEqual([]);
  });
});
