// Task 9.1 Phase B: the one real sign-in page (`SIGN_IN_PATH`) every anonymous redirect lands
// on. One button starts Google sign-in (a server action); a plain link reuses 1.4's own email
// sign-in page (`/api/auth/signin`), which already has working CSRF/rate-limit handling, rather
// than rebuilding that form here.
import { getTranslations } from 'next-intl/server';
import { AppShell } from '../../src/ui/AppShell';
import { signInWithGoogle } from './actions';

export default async function SignInPage() {
  const shell = await getTranslations('shell');
  const t = await getTranslations('signIn');
  return (
    <AppShell brand={shell('brand')} skipLabel={shell('skipToContent')}>
      <h1>{t('title')}</h1>
      <form action={signInWithGoogle}>
        <button type="submit">{t('googleButton')}</button>
      </form>
      <p>
        <a href="/api/auth/signin">{t('emailLink')}</a>
      </p>
    </AppShell>
  );
}
