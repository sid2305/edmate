// Task 1.4b: where a mailed sign-in link lands. Auth.js spends the link's single-use token on the
// GET of its own callback, so this page decides first: the browser that asked for the link (it
// holds the binding cookie for this address) goes straight on; anyone else (a link scanner, another
// browser, a cookie for a different address) sees the address and must click. Plain English
// strings (English-only pilot).
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { confirmSignInView, SIGN_IN_PATH } from '../../../src/auth';
import { ConfirmForm } from './ConfirmForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Confirm sign-in · Edmate',
  // The URL holds the token: never send it in a Referer to another site.
  referrer: 'same-origin',
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function ConfirmSignInPage({ searchParams }: { searchParams: Search }) {
  const view = await confirmSignInView(await searchParams);
  if (view.kind === 'auto') redirect(view.url);
  if (view.kind === 'invalid') {
    return (
      <main>
        <h1>This sign-in link isn’t valid</h1>
        <p>
          It may be incomplete or out of date. <a href={SIGN_IN_PATH}>Ask for a new link</a>.
        </p>
      </main>
    );
  }
  return (
    <main>
      <h1>Confirm sign-in</h1>
      <p>
        Sign in to Edmate as <strong>{view.email}</strong>?
      </p>
      <p>Only continue if you asked for this link.</p>
      <ConfirmForm token={view.token} email={view.email} callbackUrl={view.callbackUrl} />
    </main>
  );
}
