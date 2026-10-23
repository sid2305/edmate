'use client';
// Task 1.4b: the confirm page's button. The Server Action checks the fields and returns where to
// go; this then opens it as a full page, so the browser itself makes the GET that spends the token
// and keeps the session cookie Auth.js sets.
import { useActionState, useEffect } from 'react';
import { confirmEmailSignIn } from './actions';

export interface ConfirmFormProps {
  token: string;
  email: string;
  callbackUrl: string;
  /** Full-page navigation; injectable for tests. */
  navigate?: (url: string) => void;
}

function assign(url: string): void {
  window.location.assign(url);
}

export function ConfirmForm({ token, email, callbackUrl, navigate = assign }: ConfirmFormProps) {
  const [target, formAction, pending] = useActionState(confirmEmailSignIn, null);
  useEffect(() => {
    if (target) navigate(target);
  }, [target, navigate]);
  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <button type="submit" disabled={pending || target !== null}>
        Sign in
      </button>
      {target ? (
        <p>
          <a href={target}>Continue</a>
        </p>
      ) : null}
    </form>
  );
}
