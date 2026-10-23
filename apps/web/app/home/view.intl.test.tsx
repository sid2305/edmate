// @vitest-environment jsdom
// Security review (11.2b fix round, 22 Oct 2026): `AskQuestionForm` is a `'use client'` component
// calling `useTranslations('home')`, but nothing in `/home`'s render tree wrapped it in a
// `NextIntlClientProvider` -- next-intl v4 throws ("No intl context found") when `useTranslations`
// runs in a client component with no provider in the tree, so `/home` crashed for every
// signed-in student with an upcoming live class. Unlike `view.test.tsx` (which mocks
// `AskQuestionForm` out entirely) and `AskQuestionForm.test.tsx` (which only renders it under the
// test-only `renderIntl()` provider), this file renders the *real* `AskQuestionForm` through the
// *real* `HomeView`, with a plain `render()` (no `renderIntl`/`NextIntlClientProvider` of its
// own) -- so the fix has to live in `view.tsx` itself, not in a test helper.
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';

vi.mock('./actions', () => ({ signOutAndRedirect: vi.fn() }));
// Same reason as `view.test.tsx`: next-intl's real server API isn't callable under jsdom.
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const bundle = messages[namespace];
    return (key: string) =>
      key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], bundle);
  },
}));

import { HomeView } from './view';

describe('HomeView + real AskQuestionForm (no test-only intl provider)', () => {
  it('renders a live class with its ask-a-question form without crashing for lack of intl context', async () => {
    render(
      await HomeView({
        liveClasses: [
          {
            id: 'lc_1',
            title: 'Algebra basics',
            link: null,
            startsAt: '2099-01-01T00:00:00.000Z',
            status: 'scheduled',
            window: 'later',
          },
        ],
      }),
    );
    expect(screen.getByLabelText('Ask your teacher a question before class')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send question' })).toBeInTheDocument();
  });
});
