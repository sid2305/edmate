// next-intl, non-routing mode (task 9.1): one static locale, no `[locale]` segment and no
// middleware. English-only pilot (human decision) covers this; a second market adds routing
// later via next-intl's request-config API, not a rewrite (see plan Design notes).
import { getRequestConfig } from 'next-intl/server';
import messages from '../../messages/en.json';

export default getRequestConfig(async () => ({
  locale: 'en',
  messages,
}));
