// The age gate (task 1.7): where you live, then the privacy notice for that place and the year you
// were born. Neutral on purpose: no pre-filled year, no browser autofill, no minimum or maximum on
// the field, and nothing that names an age or a cut-off. The notice and its version come from the
// server's content; the version is shown, never sent back by the form.
import { notFound, redirect } from 'next/navigation';
import { ageGateView, ageNotice } from '../../../src/auth';
import { answerAge } from './actions';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  validation: 'Choose where you live and enter the year you were born.',
  provider_error: 'Could not save your answer. Try again.',
};

function marketName(market: string): string {
  if (market === 'global') return 'Somewhere else';
  return new Intl.DisplayNames(['en'], { type: 'region' }).of(market) ?? market;
}

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function AgeGatePage({ searchParams }: { searchParams: Search }) {
  const view = await ageGateView();
  if (view.state === 'sign_in') redirect('/api/auth/signin');
  if (view.state === 'not_student') notFound();
  if (view.state === 'clear') redirect('/');
  if (view.state === 'closed') {
    return (
      <main>
        <h1>Welcome to Edmate</h1>
        <p>Sorry, we can’t open an Edmate account for you.</p>
      </main>
    );
  }
  if (view.state === 'parent_needed') {
    return (
      <main>
        <h1>One more step</h1>
        <p>
          A parent or guardian needs to agree before you can start learning with a teacher’s agent.
        </p>
      </main>
    );
  }

  const params = await searchParams;
  const chosen = typeof params.market === 'string' ? params.market : '';
  const error =
    typeof params.error === 'string' && Object.hasOwn(ERRORS, params.error)
      ? ERRORS[params.error]
      : undefined;
  const market = view.markets.includes(chosen) ? chosen : undefined;

  if (!market) {
    return (
      <main>
        <h1>Welcome to Edmate</h1>
        <form method="get" action="/welcome/age">
          <label htmlFor="market">Where do you live?</label>
          <select id="market" name="market" required defaultValue="">
            <option value="" disabled>
              Choose
            </option>
            {view.markets.map((m) => (
              <option key={m} value={m}>
                {marketName(m)}
              </option>
            ))}
          </select>
          <button type="submit">Next</button>
        </form>
      </main>
    );
  }

  const notice = ageNotice(market);
  return (
    <main>
      <h1>Welcome to Edmate</h1>
      <p>Where you live: {marketName(market)}</p>
      <section aria-labelledby="notice-title">
        <h2 id="notice-title">Privacy notice (version {notice.version})</h2>
        <div style={{ whiteSpace: 'pre-wrap' }}>{notice.body}</div>
      </section>
      <form action={answerAge}>
        <input type="hidden" name="market" value={market} />
        <label htmlFor="birthYear">What year were you born?</label>
        <input
          id="birthYear"
          name="birthYear"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{4}"
          autoComplete="off"
          required
        />
        {error ? <p role="alert">{error}</p> : null}
        <p>By continuing, you accept the privacy notice above.</p>
        <button type="submit">Continue</button>
      </form>
    </main>
  );
}
