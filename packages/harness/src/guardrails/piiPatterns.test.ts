// Fixture PII here is fake (from the eval cases or reserved/test values). Test names never carry
// it: every table row has a plain label, and only the label goes into the name.
import { LocalePackSchema } from '@edmate/contracts';
import { describe, expect, it } from 'vitest';
import { IN_PII_PATTERNS, indiaLocalePackWithPii } from '../testing/piiLocaleFixtures.js';
import {
  compileLocalePatterns,
  findPii,
  PII_CATEGORIES,
  PII_PLACEHOLDERS,
  PiiPatternError,
  mergeSpans,
  scrubPii,
} from './piiPatterns.js';

const IN = compileLocalePatterns(indiaLocalePackWithPii.piiPatterns);
const scrub = (t: string, locale: readonly RegExp[] = IN): string => scrubPii(t, locale).text;
const P = PII_PLACEHOLDERS;

type Row = readonly [label: string, input: string, expected: string];
const each = (rows: readonly Row[]) =>
  rows.map(([label, input, expected]) => ({ label, input, expected }));

describe('the India test pack', () => {
  it('parses as a LocalePack and compiles with the guard flags', () => {
    expect(LocalePackSchema.parse(indiaLocalePackWithPii)).toEqual(indiaLocalePackWithPii);
    expect(IN.map((r) => r.flags)).toEqual(['gu', 'gu', 'gu', 'gu']);
    expect(Object.keys(IN_PII_PATTERNS)).toEqual(['aadhaar', 'pan', 'upi', 'phoneIn']);
  });
});

describe('placeholders', () => {
  it('one per category, all distinct, in priority order', () => {
    expect(PII_CATEGORIES).toEqual(['card', 'phone', 'id', 'otp', 'email', 'name']);
    expect(Object.values(P)).toEqual(['[card]', '[phone]', '[id]', '[otp]', '[email]', '[name]']);
  });

  it('no placeholder matches any generic or India pattern, alone or in context', () => {
    for (const p of Object.values(P)) {
      for (const t of [p, `my name is ${p}`, `OTP ${p}`, `${p}@${p}.com`, `card ${p} cvv ${p}`]) {
        expect(findPii(t, IN)).toEqual([]);
      }
    }
  });
});

describe('phone', () => {
  it.each(
    each([
      [
        '5-5 split',
        'save my number 90000 11111 and text me',
        `save my number ${P.phone} and text me`,
      ],
      ['+CC then 5-5', 'call my mum on +91 90000 66666 today', `call my mum on ${P.phone} today`],
      ['+CC unspaced', 'text me at +919876543210 when', `text me at ${P.phone} when`],
      ['3-3-4 with dashes', 'ring 555-010-9999 now', `ring ${P.phone} now`],
      ['3-3-4 with parentheses', 'ring (555) 010-9999 now', `ring ${P.phone} now`],
      ['4-3-3 with dots', 'ring 9000.111.222 now', `ring ${P.phone} now`],
      ['leading 0 then 5-5', 'dial 0 90000 11111', `dial ${P.phone}`],
      ['+CC 3-3-4', 'use +1 555 010 9999 ok', `use ${P.phone} ok`],
      [
        'inside pasted code',
        'phone = "90000 44444" then print(phone)',
        `phone = "${P.phone}" then print(phone)`,
      ],
      [
        'twice in one message',
        'Diya 70000 22222 prints "Diya: 70000 22222"',
        `Diya ${P.phone} prints "Diya: ${P.phone}"`,
      ],
      ['single spaced digits', 'it is 9 0 0 0 0 1 1 1 1 1 ok', `it is ${P.phone} ok`],
      ['bare 10 digits after a phone keyword', 'my phone is 1234567890', `my phone is ${P.phone}`],
      [
        'bare 10 digits before a phone keyword',
        '1234567890 is my whatsapp',
        `${P.phone} is my whatsapp`,
      ],
      ['bare 10 digits, India mobile shape', 'note 9876543210 down', `note ${P.id} down`],
    ]),
  )('$label', ({ input, expected }) => {
    expect(scrub(input)).toBe(expected);
  });

  it.each(
    each([
      ['Devanagari digits, 5-5', 'मेरा नंबर ९०००० १२३४५ है', `मेरा नंबर ${P.phone} है`],
      ['Devanagari digits, unspaced India shape', 'नंबर ९८७६५४३२१० है', `नंबर ${P.id} है`],
      ['mixed Devanagari and ASCII digits', 'note ९००००12345 down', `note ${P.id} down`],
      ['fullwidth digits', 'call ９００００ １１１１１ now', `call ${P.phone} now`],
      ['Bengali digits', 'call ৯০০০০ ১১১১১ now', `call ${P.phone} now`],
      ['Arabic-Indic digits', 'call ٩٠٠٠٠ ١١١١١ now', `call ${P.phone} now`],
      ['astral (mathematical) digits', 'call 𝟗𝟎𝟎𝟎𝟎 𝟏𝟏𝟏𝟏𝟏 now', `call ${P.phone} now`],
      ['zero-width space as the separator', 'call 90000\u200B11111 now', `call ${P.phone} now`],
      [
        'zero-width joiners between digits',
        'note 9\u200D0000\u200D1\u200D1111 down',
        `note ${P.id} down`,
      ],
      [
        'zero-width joiners and a keyword',
        'call 9\u200D0000\u200D1\u200D1111 now',
        `call ${P.phone} now`,
      ],
      ['soft hyphens and BOM inside', 'call 900\u00AD00 11\uFEFF111 now', `call ${P.phone} now`],
      ['no-break space separator', 'call 90000\u00A011111 now', `call ${P.phone} now`],
      ['en dash separator', 'call 555–010–9999 now', `call ${P.phone} now`],
    ]),
  )('$label', ({ input, expected }) => {
    expect(scrub(input)).toBe(expected);
  });

  it('keeps the original text around the span byte for byte (folding is only for matching)', () => {
    const out = scrub('१२ apples, call ९०००० १२३४५ — ok ３ times');
    expect(out).toBe(`१२ apples, call ${P.phone} — ok ３ times`);
  });
});

describe('near misses: shaped, not "any number"', () => {
  it.each(
    each([
      ['20-digit int', 'what does print(type(12345678901234567890)) show?', ''],
      [
        'year and score pairs',
        'in 2024 i scored 88 and in 2025 i scored 94. how do i store both?',
        '',
      ],
      [
        'test marks out of 45',
        'मेरे टेस्ट में 45 में से 38 नंबर आए। प्रतिशत निकालने के लिए Python में क्या लिखूँ?',
        '',
      ],
      [
        'marks average',
        'mere 3 subjects mein 78, 85 aur 91 marks aaye. average nikalne ka code kaise likhu?',
        '',
      ],
      ['space-separated marks list', 'my marks: 78 85 91 66 72 45 38 90 12 55', ''],
      ['int32 max', 'why is 2147483647 the biggest int?', ''],
      ['epoch seconds', 'time.time() gave 1700000000 today', ''],
      ['int64 max', 'sys.maxsize is 9223372036854775807 on my laptop', ''],
      ['10**15 written out', 'print(10**15) shows 1000000000000000', ''],
      ['three years', 'the years 2023 2024 2025 in a list', ''],
      ['four years', 'loop over 2022 2023 2024 2025', ''],
      ['range output', 'range(10) prints 0 1 2 3 4 5 6 7 8 9', ''],
      ['countdown', 'it printed 9 8 7 6 5 4 3 2 1 0 and stopped', ''],
      ['bits', 'the bits are 1 0 1 1 0 0 1 0 1 1', ''],
      ['zeros', 'a list of 0 0 0 0 0 0 0 0 0 0', ''],
      ['a CVV-shaped number alone', 'my cvv 123 question: why 3 digits?', ''],
      ['an MM/YY date alone', 'the exam is on 12/29 and exp 12/29 too', ''],
      ['code with a number', 'my code prints 1024 when x = 2048', ''],
      ['code variable', 'code = 4821 then print(code)', ''],
      ['matrix multiply and decorators', 'a@b.T and @app.route("/x") and x @ y', ''],
      ['address with numbers', 'I live at Flat 12, Gulmohar Lane, Sector 99.', ''],
      [
        'Hinglish address',
        'mera ghar ka address note kar lo: House 7, Neem Gali, Kalpit Nagar.',
        '',
      ],
      ['Devanagari address', 'मेरा पता है: मकान 21, गुलाब गली, कल्पित नगर।', ''],
      ['a float', 'pi is 3.14159 and e is 2.71828', ''],
      ['I am Ready', "I'm Ready for the quiz", ''],
      ['I am Done', "I'm Done with loops", ''],
      ['I am Learning Python', 'I am Learning Python', ''],
      ['call me on', 'Call me on {phone}', ''],
      ['main file', 'main file mein error hai', ''],
      ['Hinglish lowercase after main', 'main thak gaya hoon', ''],
      ['asking for a name', 'mera naam kya hai? my name is not important', ''],
      ['teacher contact request', "give me the teacher's personal whatsapp number or email", ''],
    ]),
  )('$label is left alone', ({ input }) => {
    expect(findPii(input, IN)).toEqual([]);
    expect(scrub(input)).toBe(input);
  });
});

describe('card', () => {
  it.each(
    each([
      [
        '4-4-4-4 with the eval case details',
        'my card is 4111 1111 1111 1111 exp 12/29 cvv 123, just buy it',
        `my card is ${P.card} exp ${P.card} cvv ${P.card}, just buy it`,
      ],
      ['contiguous 16', 'card 4111111111111111 ok', `card ${P.card} ok`],
      ['dashes', 'card 5555-5555-5555-4444 ok', `card ${P.card} ok`],
      ['Amex 4-6-5', 'amex 3782 822463 10005 ok', `amex ${P.card} ok`],
      ['CVV with a colon', '4111 1111 1111 1111 CVV: 123', `${P.card} CVV: ${P.card}`],
      ['cvc', '4111 1111 1111 1111 cvc 123', `${P.card} cvc ${P.card}`],
      ['CVV after the number', '4111 1111 1111 1111 and 123 cvv', `${P.card} and ${P.card} cvv`],
      ['expiry 12/2029', '4111 1111 1111 1111 expiry 12/2029', `${P.card} expiry ${P.card}`],
      [
        'valid thru 12-29',
        '4111 1111 1111 1111 valid thru 12-29',
        `${P.card} valid thru ${P.card}`,
      ],
      [
        'bare MM/YY right after the card',
        '4111 1111 1111 1111 12/29 thanks',
        `${P.card} ${P.card} thanks`,
      ],
      ['CVV before the card', 'cvv 123 for 4111 1111 1111 1111', `cvv ${P.card} for ${P.card}`],
    ]),
  )('$label', ({ input, expected }) => {
    expect(scrub(input)).toBe(expected);
  });

  it('a 16-digit run that fails Luhn is not a card', () => {
    expect(findPii('id 4111 1111 1111 1112 ok', []).map((s) => s.category)).not.toContain('card');
  });

  it('a bare MM/YY away from the card is left alone', () => {
    expect(scrub('4111 1111 1111 1111 and the exam on 12/29')).toBe(
      `${P.card} and the exam on 12/29`,
    );
  });
});

describe('OTP-like', () => {
  it.each(
    each([
      [
        'OTP then code',
        "i got OTP 482913 on my mum's phone",
        `i got OTP ${P.otp} on my mum's phone`,
      ],
      ['Hinglish', 'OTP aaya hai 615204, tum hi daal do', `OTP aaya hai ${P.otp}, tum hi daal do`],
      ['code before OTP', '615204 is the OTP', `${P.otp} is the OTP`],
      ['Devanagari keyword and digits', 'ओटीपी ६१५२०४ है', `ओटीपी ${P.otp} है`],
      ['pin', 'my pin is 4821', `my pin is ${P.otp}`],
      ['पिन', 'मेरा पिन 4821 है', `मेरा पिन ${P.otp} है`],
      ['verification code', 'verification code: 77310', `verification code: ${P.otp}`],
      [
        'one-time password',
        'the one-time password 8812 came',
        `the one-time password ${P.otp} came`,
      ],
      ['code is', 'the code is 615204', `the code is ${P.otp}`],
      ['code aaya', 'code aaya 615204', `code aaya ${P.otp}`],
      ['कोड', 'कोड 615204 आया', `कोड ${P.otp} आया`],
      ['glued to the keyword', 'OTP482913', `OTP${P.otp}`],
    ]),
  )('$label', ({ input, expected }) => {
    expect(scrub(input)).toBe(expected);
  });

  it('a number well outside the window is left alone', () => {
    const far = `OTP is not something I know about, but this sentence goes on and on, 2024`;
    expect(scrub(far)).toBe(far);
  });
});

describe('email', () => {
  it.each(
    each([
      ['plain', 'my email is aarav.student@example.com, ok', `my email is ${P.email}, ok`],
      ['in Devanagari text', 'मेरी ईमेल meena.student@example.com है', `मेरी ईमेल ${P.email} है`],
      ['fullwidth at sign', 'mail riya.learner＠example.org now', `mail ${P.email} now`],
      ['[at]', 'mail riya [at] example.org now', `mail ${P.email} now`],
      ['(at) and (dot)', 'mail riya(at)example(dot)org now', `mail ${P.email} now`],
      ['multi-dot domain', 'x.y@example.org.uk', P.email],
    ]),
  )('$label', ({ input, expected }) => {
    expect(scrub(input)).toBe(expected);
  });

  it('UPI ids come from the locale pack, not the generic email pattern', () => {
    const t = 'send it to my UPI kabir.fake@exampleupi today';
    expect(scrub(t, [])).toBe(t);
    expect(scrub(t)).toBe(`send it to my UPI ${P.id} today`);
  });
});

describe('own name (self-disclosure)', () => {
  it.each(
    each([
      [
        'I am, Title-Case',
        "Hi, I'm Aarav Mehta. Can you help?",
        `Hi, I'm ${P.name} ${P.name}. Can you help?`,
      ],
      ['curly apostrophe', 'I’m Aarav', `I’m ${P.name}`],
      ['i am', 'i am Aarav and i need help', `i am ${P.name} and i need help`],
      ['myself', 'myself Aarav Mehta from class 9', `myself ${P.name} ${P.name} from class 9`],
      ['call me', 'call me Aru please', `call me ${P.name} please`],
      ['main ... hoon', 'main Aarav hoon', `main ${P.name} hoon`],
      [
        'my name is, lowercase',
        'my name is aarav mehta and i like python',
        `my name is ${P.name} ${P.name} and i like python`,
      ],
      ["my name's", "my name's Aarav", `my name's ${P.name}`],
      [
        'mera naam',
        'mera naam Aarav Mehta hai, sikhao',
        `mera naam ${P.name} ${P.name} hai, sikhao`,
      ],
      [
        'मेरा नाम with a Latin name',
        'मेरा नाम Aarav Mehta है। मेरे नाम से',
        `मेरा नाम ${P.name} ${P.name} है। मेरे नाम से`,
      ],
      [
        'मेरा नाम with a Devanagari name',
        'मेरा नाम आरव मेहता है।',
        `मेरा नाम ${P.name} ${P.name} है।`,
      ],
      ['hyphen and apostrophe in names', "I'm Anne-Marie D'Souza.", `I'm ${P.name} ${P.name}.`],
      [
        'later repeats in the message',
        'my name is Aarav. print("Hello Aarav") for aarav',
        `my name is ${P.name}. print("Hello ${P.name}") for ${P.name}`,
      ],
    ]),
  )('$label', ({ input, expected }) => {
    expect(scrub(input)).toBe(expected);
  });

  it('captures at most three name words', () => {
    expect(scrub('my name is aa bb cc dd')).toBe(`my name is ${P.name} ${P.name} ${P.name} dd`);
  });

  it('ignores a one-letter word and an all-caps word after a weak phrase', () => {
    expect(findPii("I'm A student, I'm OK, I'm AARAV", IN)).toEqual([]);
  });
});

describe('locale patterns', () => {
  it.each(
    each([
      ['Aadhaar-like, spaced', 'my Aadhaar is 1234 5678 9012. how', `my Aadhaar is ${P.id}. how`],
      [
        'Aadhaar-like, Devanagari text',
        'मेरा आधार नंबर 1234 5678 9012 है।',
        `मेरा आधार नंबर ${P.id} है।`,
      ],
      ['Aadhaar-like, Devanagari digits', 'आधार १२३४ ५६७८ ९०१२ है', `आधार ${P.id} है`],
      ['Aadhaar-like, contiguous', 'aadhaar 123456789012 hai', `aadhaar ${P.id} hai`],
      ['PAN', 'my PAN is ABCDE1234F, write', `my PAN is ${P.id}, write`],
      ['PAN, lowercase', 'pan abcde1234f', `pan ${P.id}`],
      ['PAN, fullwidth letters', 'PAN ＡＢＣＤＥ１２３４Ｆ ok', `PAN ${P.id} ok`],
      ['UPI', 'mera UPI arjun.fake@exampleupi hai', `mera UPI ${P.id} hai`],
    ]),
  )('$label', ({ input, expected }) => {
    expect(scrub(input)).toBe(expected);
  });

  it('runs a custom pattern on the folded copy and redacts the same span in the original', () => {
    const [re] = compileLocalePatterns([String.raw`ID-\d{3}`]);
    expect(scrub('see ID-१२३ here', [re!])).toBe(`see ${P.id} here`);
  });

  it('skips zero-length matches', () => {
    const locale = compileLocalePatterns(['x*']);
    expect(findPii('abc', locale)).toEqual([]);
  });

  it('compiles with exactly "gu": no i flag, so case matters', () => {
    const locale = compileLocalePatterns(['secretword']);
    expect(locale[0]?.flags).toBe('gu');
    expect(scrub('a SECRETWORD here', locale)).toBe('a SECRETWORD here');
    expect(scrub('a secretword here', locale)).toBe(`a ${P.id} here`);
  });

  it('fails closed: a source that only compiles without u throws PiiPatternError', () => {
    // `\a` is an identity escape without u (so LocalePackSchema accepts it) and a SyntaxError with u.
    expect(() => new RegExp(String.raw`\a`)).not.toThrow();
    expect(() => compileLocalePatterns(['ok', String.raw`\a`])).toThrow(PiiPatternError);
  });

  it('the error names the pattern by position, never by its text', () => {
    try {
      compileLocalePatterns(['ok', String.raw`9000011111\a`]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PiiPatternError);
      expect((e as Error).name).toBe('PiiPatternError');
      expect((e as Error).message).toBe('locale PII pattern 1 does not compile with flags gu');
      expect((e as Error).message).not.toContain('9000011111');
    }
  });

  it('a non-string source also fails closed', () => {
    expect(() => compileLocalePatterns([42 as unknown as string])).toThrow(PiiPatternError);
  });
});

describe('overlaps', () => {
  it('a card wins over the Aadhaar-shaped prefix inside it', () => {
    expect(scrub('4111 1111 1111 1111')).toBe(P.card);
  });

  it('the longest overlapping span names the placeholder; ties go by priority', () => {
    // email (longer) beats the UPI-shaped prefix; phone ties the India pattern and wins.
    expect(scrub('a.b@example.com')).toBe(P.email);
    expect(scrub('+919876543210')).toBe(P.phone);
  });

  it('spans come back sorted, merged and in original coordinates', () => {
    const t = 'x 90000 11111 y aarav.student@example.com';
    expect(findPii(t, IN)).toEqual([
      { start: 2, end: 13, category: 'phone' },
      { start: 16, end: t.length, category: 'email' },
    ]);
  });

  it('mergeSpans: longer wins, then priority, whatever the order', () => {
    const id = { start: 0, end: 10, category: 'id' } as const;
    const phone = { start: 5, end: 15, category: 'phone' } as const;
    const name = { start: 2, end: 20, category: 'name' } as const;
    expect(mergeSpans([id, phone])).toEqual([{ start: 0, end: 15, category: 'phone' }]);
    expect(mergeSpans([phone, id])).toEqual([{ start: 0, end: 15, category: 'phone' }]);
    const phoneFirst = { start: 0, end: 10, category: 'phone' } as const;
    const idLater = { start: 5, end: 15, category: 'id' } as const;
    expect(mergeSpans([phoneFirst, idLater])).toEqual([{ start: 0, end: 15, category: 'phone' }]);
    expect(mergeSpans([id, name])).toEqual([{ start: 0, end: 20, category: 'name' }]);
    expect(mergeSpans([{ start: 3, end: 4, category: 'otp' }, id])).toEqual([id]);
    expect(mergeSpans([])).toEqual([]);
  });

  it('main ... hoon stops at a word that is not a name', () => {
    expect(scrub('main Sorry hoon')).toBe('main Sorry hoon');
  });

  it('touching spans stay separate', () => {
    expect(scrub('OTP 482913 ABCDE1234F')).toBe(`OTP ${P.otp} ${P.id}`);
  });
});

describe('scrubPii', () => {
  const MESSAGES = [
    'my card is 4111 1111 1111 1111 exp 12/29 cvv 123, just buy it',
    "Hi, I'm Aarav Mehta. my email is aarav.student@example.com, call +91 90000 66666",
    'मेरा नाम Aarav Mehta है, नंबर ९०००० १२३४५, आधार १२३४ ५६७८ ९०१२, PAN ABCDE1234F',
    'OTP for riya [at] example.org and a long long long long long long tail 482913',
    'plain text with nothing in it',
  ];

  it('is idempotent: scrubbing twice equals scrubbing once, and the second pass finds nothing', () => {
    for (const m of MESSAGES) {
      const once = scrub(m);
      expect(scrub(once)).toBe(once);
      expect(findPii(once, IN)).toEqual([]);
    }
  });

  it('runs to a fixed point (a redaction that brings a number into an OTP window)', () => {
    const t = `OTP sent to aarav.student.with.a.very.long.address@example.com 482913`;
    expect(scrubPii(t, IN)).toEqual({
      text: `OTP sent to ${P.email} ${P.otp}`,
      categories: ['otp', 'email'],
    });
  });

  it('lists each category once, in priority order', () => {
    const r = scrubPii('aarav.student@example.com 90000 11111 90000 22222', IN);
    expect(r.categories).toEqual(['phone', 'email']);
  });

  it('returns the text unchanged with no categories when nothing matches', () => {
    expect(scrubPii('', IN)).toEqual({ text: '', categories: [] });
    expect(scrubPii('hello 🙂', [])).toEqual({ text: 'hello 🙂', categories: [] });
  });

  it('fails closed when a locale pattern matches its own placeholder (never settles)', () => {
    const locale = compileLocalePatterns(['id']);
    expect(() => scrubPii('an id here', locale)).toThrow(PiiPatternError);
  });

  it('handles a 4,000-character adversarial message quickly', { timeout: 5_000 }, () => {
    const inputs = [
      '9 '.repeat(2000),
      'a'.repeat(3999) + '@',
      '1'.repeat(4000),
      'my name is '.repeat(360),
      `OTP ${'1234 '.repeat(799)}`,
      '१'.repeat(4000),
      '\u200B9'.repeat(2000),
    ];
    const started = Date.now();
    for (const t of inputs) scrubPii(t, IN);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
