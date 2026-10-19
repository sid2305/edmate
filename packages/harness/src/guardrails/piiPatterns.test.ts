// Fixture PII here is fake (from the eval cases or reserved/test values). Test names never carry
// it: every table row has a plain label, and only the label goes into the name.
import { LIMITS, LocalePackSchema } from '@edmate/contracts';
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
      for (const t of [
        p,
        `my name is ${p}`,
        `OTP ${p}`,
        `${p}@${p}.com`,
        `card ${p} cvv ${p}`,
        // A placeholder is never a keyword: "[phone]" and "[otp]" must not pull numbers in.
        `${p} 1234567890 and 4821`,
        `1234567890 4821 ${p}`,
      ]) {
        expect(findPii(t, IN)).toEqual([]);
      }
    }
  });
});

describe('bracketed keywords (fix round, MEDIUM regression)', () => {
  it('a real bracketed keyword still pulls in the number next to it', () => {
    expect(scrub('[OTP] 482913 is your code')).toBe(`[OTP] ${P.otp} is your code`);
    expect(scrub('[Phone] 5551234567')).toBe(`[Phone] ${P.phone}`);
  });

  it('scrubbing a placeholder output again is a fixpoint (idempotence)', () => {
    // "[phone]" is the exact placeholder the scrub writes: it is never a keyword, so the bare
    // number next to it is left alone, and a second pass changes nothing.
    const once = scrub('[phone] 1234567890');
    expect(once).toBe('[phone] 1234567890');
    expect(scrub(once)).toBe(once);
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

describe('near misses: distress, feelings and identity words are never taken for a name', () => {
  // Fix round (safety review): the name heuristic must never delete what a distress check reads.
  it.each(
    each([
      ['I am Feeling Suicidal', "I'm Feeling Suicidal", ''],
      ['main Marna Chahta hoon', 'main Marna Chahta hoon', ''],
      ['I am Depressed', "I'm Depressed", ''],
      ['Main Akela hoon', 'Main Akela hoon', ''],
      ['I am Alone', 'I am Alone', ''],
      ['I am So Tired', "I'm So Tired of everything", ''],
      ['I am Scared', "I'm Scared", ''],
      ['I am Hopeless', 'I am Hopeless', ''],
      ['I am Lonely', "I'm Lonely", ''],
      ['I am Worthless', 'I am Worthless', ''],
      ['I am Anxious', "I'm Anxious about exams", ''],
      ['I am Nervous', "I'm Nervous", ''],
      ['I am Worried', "I'm Worried", ''],
      ['I am Upset', "I'm Upset", ''],
      ['I am Angry', "I'm Angry", ''],
      ['I am Hurt', "I'm Hurt", ''],
      ['I am Broken', "I'm Broken", ''],
      ['I am Crying', "I'm Crying", ''],
      ['I am Dying', "I'm Dying inside", ''],
      ['I am Stressed', "I'm Stressed", ''],
      ['I am Overwhelmed', "I'm Overwhelmed", ''],
      ['I am Unsafe', "I'm Unsafe at home", ''],
      ['Main Pareshan hoon', 'Main Pareshan hoon', ''],
      ['Main Udaas hoon', 'Main Udaas hoon', ''],
      ['Main Dukhi hoon', 'Main Dukhi hoon', ''],
      ['main Mar Jaana Chahta hoon', 'main Mar Jaana Chahta hoon', ''],
      ['I am Indian', "I'm Indian", ''],
      ['I am Hindi Medium', 'I am Hindi Medium', ''],
      ['I am English Medium', "I'm English Medium", ''],
      ['I am Tamil', "I'm Tamil", ''],
      ['I am Bad at maths', "I'm Bad at maths", ''],
      ['I am Stupid', "I'm Stupid", ''],
      ['I am Weak', "I'm Weak in Python", ''],
      ['call me Later', 'call me Later', ''],
      ['I am Fine', "I'm Fine", ''],
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
      [
        'spelled out with "at" and "dot"',
        'send it to priya dot student at example dot com okay',
        `send it to ${P.email} okay`,
      ],
      ['spelled out, upper case', 'mail RIYA AT EXAMPLE DOT ORG now', `mail ${P.email} now`],
    ]),
  )('$label', ({ input, expected }) => {
    expect(scrub(input)).toBe(expected);
  });

  it.each([
    ['good at maths', "I'm good at maths and bad at physics"],
    ['meet at a time', 'meet at 5 near the gate'],
    ['dot product', 'the dot product of a and b, then x dot y'],
    ['at without a domain', 'look at this dot'],
  ])('spelled-out near miss: %s', (_label, input) => {
    expect(scrub(input)).toBe(input);
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
      `x at ${'a dot '.repeat(660)}`,
      'a dot '.repeat(330) + 'at ' + 'b dot '.repeat(330),
    ];
    const started = Date.now();
    for (const t of inputs) scrubPii(t, IN);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('scrubPii converges whatever the match count (fix round, CRITICAL)', () => {
  const CAP = LIMITS.turnTextMaxLength; // 8,000 UTF-16 units
  const fill = (head: string, unit: string, n: number) => head + unit.repeat(n);
  const maxCount = (head: string, unit: string) => Math.floor((CAP - head.length) / unit.length);

  // Keyword-adjacent numbers: every redaction shortens the gap to the next number.
  const SHAPES = [
    { label: 'ten-digit numbers after a phone keyword', head: 'contact ', unit: '1234567890 ' },
    { label: 'ten-digit numbers glued together by commas', head: 'my phone ', unit: '1234567890,' },
    { label: 'OTP-like numbers after an OTP keyword', head: 'OTP ', unit: '1234 ' },
    {
      label: 'OTP-like numbers between emails',
      head: 'OTP a@example.com ',
      unit: '482913 b@example.com ',
    },
  ] as const;

  const cases = SHAPES.flatMap((s) =>
    [10, 50, maxCount(s.head, s.unit)].map((n) => ({ ...s, n, name: `${s.label} x${n}` })),
  );

  it.each(cases)('$name: settles, and its output scrubs clean', { timeout: 30_000 }, (c) => {
    const text = fill(c.head, c.unit, c.n);
    expect(text.length).toBeLessThanOrEqual(CAP);
    let out = '';
    expect(() => {
      out = scrubPii(text, IN).text;
    }).not.toThrow();
    expect(findPii(out, IN)).toEqual([]);
    expect(scrubPii(out, IN)).toEqual({ text: out, categories: [] });
  });

  it('the maximum count at the cap finishes in generous time', { timeout: 30_000 }, () => {
    const started = Date.now();
    for (const s of SHAPES) scrubPii(fill(s.head, s.unit, maxCount(s.head, s.unit)), IN);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('redacts the numbers a keyword reaches once earlier ones are shortened', () => {
    // Raw gaps from the keyword: 1, 12, 23, 34, 45. Each [phone] is 3 shorter than its number,
    // so the fourth is reached (34 - 9 = 25) and the fifth is not (45 - 12 = 33 > 30).
    const t = 'contact 1234567890 1234567890 1234567890 1234567890 1234567890';
    const out = scrubPii(t, IN).text;
    expect(out).toBe(`contact ${P.phone} ${P.phone} ${P.phone} ${P.phone} 1234567890`);
    expect(findPii(out, IN)).toEqual([]);
  });
});

// ---- 4.2c: PII pattern hardening from the 4.2 safety review -------------------------------

describe('4.2c item 1: keycap, superscript and circled digits', () => {
  it('a keycap phone number, glued together, after a phone keyword', () => {
    expect(scrub('my number is 9️⃣8️⃣7️⃣6️⃣5️⃣4️⃣3️⃣2️⃣1️⃣0️⃣ save it for reminders')).toBe(
      `my number is ${P.phone} save it for reminders`,
    );
  });

  it('superscript digits, grouped (unconditional, like any other grouped phone shape)', () => {
    expect(scrub('call ⁹⁰⁰⁰⁰ ¹¹¹¹¹ now')).toBe(`call ${P.phone} now`);
  });

  it('circled digits after an OTP keyword', () => {
    expect(scrub('OTP ①②③④ hai')).toBe(`OTP ${P.otp} hai`);
  });

  it('a stray mark right after a digit never splits a number (CGJ)', () => {
    expect(scrub('call 90000͏11111 now')).toBe(`call ${P.phone} now`);
  });
});

describe('4.2c item 2: flexible phone separators and groupings', () => {
  it.each(
    each([
      ['multi-space gap', 'my number is 98765   43210', `my number is ${P.phone}`],
      ['pair groups', 'my number is 98 76 54 32 10', `my number is ${P.phone}`],
      ['uneven dash groups', 'my number is 98-765-43210', `my number is ${P.phone}`],
      ['+CC, UK-shaped groups', 'call +44 20 7946 0958 now', `call ${P.phone} now`],
    ]),
  )('$label', ({ input, expected }) => {
    expect(scrub(input)).toBe(expected);
  });

  it('a flexible-group phone with no keyword is left alone', () => {
    const t = 'the groups are 98 76 54 32 10 in the output';
    expect(scrub(t)).toBe(t);
  });

  it('a flexible-group near-miss (years, spaced) is still left alone', () => {
    expect(scrub('call me: the years 2023 2024 2025 matter')).toBe(
      'call me: the years 2023 2024 2025 matter',
    );
  });

  it('a +CC flexible-group near-miss (years, spaced) is still left alone', () => {
    expect(scrub('the code is +91 2023 2024 2025 for the lab')).toBe(
      'the code is +91 2023 2024 2025 for the lab',
    );
  });
});

describe('4.2c item 3: card hardening', () => {
  it('dot-separated card groups', () => {
    expect(scrub('card 4111.1111.1111.1111 ok')).toBe(`card ${P.card} ok`);
  });

  it('unlabelled CVV and expiry near a card, no keyword at all', () => {
    expect(scrub('card 4111.1111.1111.1111 / 12/29 / 123 pls buy the course for me')).toBe(
      `card ${P.card} / ${P.card} / ${P.card} pls buy the course for me`,
    );
  });

  it('an unlabelled bare MM/YY still stays alone across an unrelated word (near-miss)', () => {
    expect(scrub('4111 1111 1111 1111 and the exam on 12/29')).toBe(
      `${P.card} and the exam on 12/29`,
    );
  });

  it('an unlabelled 3-4 digit run with no date present, after a card', () => {
    expect(scrub('card 4111 1111 1111 1111 / 123 only')).toBe(`card ${P.card} / ${P.card} only`);
  });

  it('an unlabelled 3-4 digit run that is really just the tail of the date is not doubled', () => {
    expect(scrub('card 4111 1111 1111 1111 / 29/2029 ok')).toBe(`card ${P.card} / ${P.card} ok`);
  });

  it('a spaced-digit CVV next to a card', () => {
    expect(scrub('card 4111 1111 1111 1111 cvv 1 2 3')).toBe(`card ${P.card} cvv ${P.card}`);
  });

  it('a spelled-out CVV next to a card', () => {
    expect(scrub('card 4111 1111 1111 1111 cvv one two three')).toBe(
      `card ${P.card} cvv ${P.card}`,
    );
  });

  it('a spelled-out CVV with no card at all is left alone (near-miss)', () => {
    expect(scrub('cvv one two three, why only 3 digits?')).toBe(
      'cvv one two three, why only 3 digits?',
    );
  });
});

describe('4.2c item 4: OTP hardening', () => {
  it.each(
    each([
      ['spaced digits after OTP', 'otp 4 8 2 9 1 3 aaya hai', `otp ${P.otp} aaya hai`],
      ['dashed digits after "otp:"', 'otp: 482-913', `otp: ${P.otp}`],
      ['Devanagari spaced digits', 'OTP ४ ८ २ ९ १ ३ आया है', `OTP ${P.otp} आया है`],
      ['"code" after the number', '482913 code hai, use it', `${P.otp} code hai, use it`],
      ['bheja after the number', '482913 bheja', `${P.otp} bheja`],
      ['aaya after the number', '482913 aaya', `${P.otp} aaya`],
    ]),
  )('$label', ({ input, expected }) => {
    expect(scrub(input)).toBe(expected);
  });

  it('spaced digits with no OTP keyword nearby are left alone (near-miss)', () => {
    expect(scrub('the printout was 4 8 2 9 1 3 that day')).toBe(
      'the printout was 4 8 2 9 1 3 that day',
    );
  });
});

describe('4.2c item 5: name hardening', () => {
  it.each(
    each([
      ['hai right after the strong phrase', 'mera naam hai Aarav', `mera naam hai ${P.name}`],
      [
        'है right after the Devanagari strong phrase',
        'मेरा नाम है आरव',
        `मेरा नाम है ${P.name}`,
      ],
      ['name:', 'name: Riya Kapoor', `name: ${P.name} ${P.name}`],
      ['naam:', 'naam: Riya', `naam: ${P.name}`],
      ['मैं ... हूँ', 'मैं आरव हूँ', `मैं ${P.name} हूँ`],
      [
        'the proposed eval case (word order)',
        'mera naam hai Riya Kapoor, mere naam se greeting print karo',
        `mera naam hai ${P.name} ${P.name}, mere naam se greeting print karo`,
      ],
    ]),
  )('$label', ({ input, expected }) => {
    expect(scrub(input)).toBe(expected);
  });

  it.each([
    ['main Khatam hoon', 'main Khatam hoon'],
    ['main Barbaad hoon', 'main Barbaad hoon'],
    ['main Bekaar hoon', 'main Bekaar hoon'],
    ["I'm Nothing", "I'm Nothing"],
  ])('stop-list addition: %s is left alone', (_label, input) => {
    expect(findPii(input, IN)).toEqual([]);
    expect(scrub(input)).toBe(input);
  });

  it('मैं ... हूँ stops at a Devanagari filler word (near-miss)', () => {
    expect(scrub('मैं परेशान हूँ')).toBe('मैं परेशान हूँ');
  });
});

describe('4.2c item 6: spelled-out single-turn numbers', () => {
  it('a spelled phone number, English, after a phone keyword', () => {
    expect(scrub('save my number nine eight seven six five four three two one zero please')).toBe(
      `save my number ${P.phone} please`,
    );
  });

  it('a spelled phone number, Hinglish, after a phone keyword', () => {
    expect(scrub('mera number ek do teen char paanch che saat aath nau do hai')).toBe(
      `mera number ${P.phone} hai`,
    );
  });

  it('a spelled OTP, Hinglish, after an OTP keyword', () => {
    expect(scrub('otp panch che saat aath nau ek hai')).toBe(`otp ${P.otp} hai`);
  });

  it('a spelled run with no phone or OTP keyword nearby is left alone (near-miss)', () => {
    const t = 'counting practice: one two three four five six seven';
    expect(scrub(t)).toBe(t);
  });
});

describe('4.2c item 8: constant and counting digit runs are not over-scrubbed', () => {
  it('a constant run is not an Aadhaar/mobile-shaped id just because of its length', () => {
    expect(scrub('x = 9999999999')).toBe('x = 9999999999');
  });

  it('a counting run with no keyword nearby is left alone', () => {
    expect(scrub('matrix 1 2 3 4 5 6 7 8 9')).toBe('matrix 1 2 3 4 5 6 7 8 9');
  });
});

describe('fix round item 2 (MEDIUM): up to 3 filler words between the number and "code"', () => {
  it('"is the verification code" after the number', () => {
    expect(scrub('482913 is the verification code')).toBe(`${P.otp} is the verification code`);
  });

  it('"is your code" after the number', () => {
    expect(scrub('482913 is your code')).toBe(`${P.otp} is your code`);
  });

  it('near-miss: a 3-digit number ("line 482 is the code that fails") is never redacted', () => {
    expect(scrub('line 482 is the code that fails')).toBe('line 482 is the code that fails');
  });
});

describe('fix round item 3 (MEDIUM): reversed Hinglish order and comma sign-offs', () => {
  it('reversed Hinglish order: "<Name> mera naam hai"', () => {
    expect(scrub('Aarav mera naam hai')).toBe(`${P.name} mera naam hai`);
  });

  it('reversed order, Devanagari: "<Name> मेरा नाम है" (fix round 2)', () => {
    expect(scrub('आरव मेरा नाम है')).toBe(`${P.name} मेरा नाम है`);
  });

  it('reversed order, Devanagari, near-miss: a stop-list word before the phrase is never a name', () => {
    expect(scrub('परेशान मेरा नाम है')).toBe('परेशान मेरा नाम है');
  });

  it('sign-off with a comma: "Thanks, Aarav"', () => {
    expect(scrub('Thanks, Aarav')).toBe(`Thanks, ${P.name}`);
  });

  it('sign-off with a comma: "Regards, Riya Sen"', () => {
    expect(scrub('Regards, Riya Sen')).toBe(`Regards, ${P.name} ${P.name}`);
  });

  it('near-miss: "Thanks, that worked" is never redacted', () => {
    expect(scrub('Thanks, that worked')).toBe('Thanks, that worked');
  });

  it('near-miss: "Regards to the teacher" is never redacted', () => {
    expect(scrub('Regards to the teacher')).toBe('Regards to the teacher');
  });
});
