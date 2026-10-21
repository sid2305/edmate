'use server';
// The age gate's server action (task 1.7). Thin: it picks the two form fields and hands them to
// src/auth (age.ts), which checks the session, parses strictly, takes the notice version from the
// server's own content, and sets the cookies. Next checks the Origin of server actions itself.
import { redirect } from 'next/navigation';
import { SIGN_IN_PATH, submitAgeAnswer } from '../../../src/auth';

const GATE = '/welcome/age';

/** Only the fields the form has; anything else the browser sent is ignored, never parsed. */
function field(form: FormData, name: string): Record<string, string> {
  const value = form.get(name);
  return typeof value === 'string' ? { [name]: value } : {};
}

export async function answerAge(form: FormData): Promise<void> {
  const answer = { ...field(form, 'market'), ...field(form, 'birthYear') };
  const result = await submitAgeAnswer(answer);
  if ('error' in result) {
    if (result.error.code === 'unauthorized') redirect(SIGN_IN_PATH);
    const market = encodeURIComponent(answer.market ?? '');
    redirect(`${GATE}?market=${market}&error=${result.error.code}`);
  }
  redirect(result.status === 'clear' ? '/' : GATE);
}
