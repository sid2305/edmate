// The offer-name rule (ADR-0015 §9, 10.1a review LOW): one line, a letter or digit, and no
// character that hides or fakes text. Lives here so the contracts change stays two lines.
import { PaymentOfferSchema } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { checkPortInput } from '../src/input.js';

const offer = (name: string) => ({
  packageVersionId: 'pkv_basic',
  name,
  price: { amountMinor: 1000, currency: 'USD' },
  interval: 'month',
});

describe('PaymentOffer.name', () => {
  it.each([
    ['a lone high surrogate', 'Algebra \ud800'],
    ['a lone low surrogate', '\udc00 Algebra'],
    ['a private-use character (U+E000)', 'Algebra \u{e000}'],
    ['a supplementary private-use character (U+F0000)', 'Algebra \u{f0000}'],
    ['the Hangul filler (U+3164)', 'Algebra\u{3164}'],
    ['a Hangul filler only', '\u{3164}'],
    ['the halfwidth Hangul filler (U+FFA0)', 'Algebra \u{ffa0}'],
    ['the Hangul choseong filler (U+115F)', '\u{115f}Algebra'],
    ['the Hangul jungseong filler (U+1160)', 'Algebra\u{1160}'],
    // Deliberate: a ZWJ emoji sequence carries U+200D (a format character), so it is refused;
    // 10.8 strips or refuses it when the studio saves a name (ADR-0015 Consequences).
    ['a ZWJ emoji sequence (family)', 'Family maths \u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}'],
    ['a zero-width joiner', 'Alge\u{200d}bra'],
  ])('refuses %s', (_why, name) => {
    expect(PaymentOfferSchema.safeParse(offer(name)).success).toBe(false);
  });

  it.each([
    ['plain words', 'Algebra with Ms Rao'],
    ['accents and other scripts', 'Álgebra · बीजगणित · 代数'],
    ['a single emoji with no joiner', 'Maths club \u{1f4d0}'],
    ['a real Hangul syllable', '수학 Algebra'],
  ])('accepts %s', (_why, name) => {
    expect(PaymentOfferSchema.safeParse(offer(name)).success).toBe(true);
  });

  it('the shared input check refuses the same names', () => {
    expect(() =>
      checkPortInput('startCheckout', {
        subscriptionId: 'sub_1',
        offer: offer('Algebra \u{e000}'),
        returnUrl: 'https://edmate.example/r',
        idempotencyKey: 'sub_1-checkout-1',
      }),
    ).toThrow('payment request is invalid');
  });
});
