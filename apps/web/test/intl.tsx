// Task 9.4 Phase C: renders a client component under the real next-intl provider with the real
// `en.json`, so a missing or mistyped `chat.*` key fails the test.
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../messages/en.json';

export function withIntl(ui: ReactNode): ReactNode {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  );
}

export function renderIntl(ui: ReactNode): RenderResult {
  return render(withIntl(ui));
}
