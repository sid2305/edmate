// Task 9.0 Phase C: helpers for the stack run (try-it.spec.ts). Sign-in links come from Mailpit,
// the local mail catcher, which never relays mail out. Every URL must be local: the helpers
// refuse any other host, like apps/web/scripts/sandbox-magic-link.mjs.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** Parses `raw` and throws unless it is http(s) on a local host. */
export function localUrl(raw: string): URL {
  const url = new URL(raw);
  if (!LOCAL_HOSTS.includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`refusing a non-local URL: ${url.origin}`);
  }
  return url;
}

const MAIL = localUrl(process.env.EDMATE_STACK_MAIL_URL ?? 'http://127.0.0.1:8025');

type MailSummary = { ID: string; Created: string; To?: { Address: string }[] };

/** Waits for a sign-in mail to `email` sent after `since`, and returns its link. */
async function signInLink(email: string, since: number): Promise<string> {
  for (let i = 0; i < 60; i += 1) {
    const list = (await (await fetch(new URL('/api/v1/messages', MAIL))).json()) as {
      messages?: MailSummary[];
    };
    const found = list.messages?.find(
      (m) =>
        Date.parse(m.Created) >= since - 1000 &&
        m.To?.some((t) => t.Address.toLowerCase() === email.toLowerCase()),
    );
    if (found) {
      const body = (await (await fetch(new URL(`/api/v1/message/${found.ID}`, MAIL))).json()) as {
        Text?: string;
      };
      const link = /https?:\/\/\S+\/api\/auth\/callback\/\S+/.exec(body.Text ?? '')?.[0];
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no sign-in mail reached Mailpit');
}

/** Signs `page`'s context in as `email` through the Auth.js email form and a Mailpit link. */
export async function signInByEmail(page: Page, email: string): Promise<void> {
  const since = Date.now();
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Sign in with email instead' }).click();
  await page.locator('input[type="email"]').fill(email);
  await page.getByRole('button', { name: /email/i }).click();
  await expect(page).toHaveURL(/verify-request/);
  const link = await signInLink(email, since);
  // The link carries a single-use token: open it, never print it.
  await page.goto(link);
  await expect(page).not.toHaveURL(/\/api\/auth\//);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_BIN = join(HERE, '..', '..', '..', '..', 'packages', 'db', 'dist', 'bin');

/** Runs a built @edmate/db CLI (as a human would, docs/try-it.md) and returns its output. */
export function dbCli(script: string, args: string[]): string {
  const databaseUrl = process.env.EDMATE_STACK_DATABASE_URL;
  if (!databaseUrl) throw new Error('set EDMATE_STACK_DATABASE_URL (the stack Postgres)');
  localUrl(databaseUrl.replace(/^postgres(ql)?:/, 'http:'));
  const result = spawnSync(process.execPath, [join(DB_BIN, script), ...args], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${script} exited ${String(result.status)}: ${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}
