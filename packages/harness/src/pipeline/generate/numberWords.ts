// Number words for the answer-leak checks (task 4.5): English, Hindi in Latin letters and Hindi in
// Devanagari (0-100), plus the scale words they combine with. Hand-written tables, no library
// (mathjs is arithmetic, not number names). Words are looked up after `foldWord`, so spelling
// variants that differ only by nukta or chandrabindu (हज़ार / हजार, पाँच / पांच) are one entry.
// Hindi in Latin letters covers 0-19 and the tens (the plan's pilot scope); its irregular 21-99
// names are not listed.

/** A small number (0-99) or a scale word (hundred and up). */
export type NumberWord = { kind: 'small'; value: number } | { kind: 'scale'; value: number };

const EN_UNITS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const EN_TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const HI_LATIN: Record<string, number> = {
  shunya: 0,
  ek: 1,
  do: 2,
  teen: 3,
  char: 4,
  chaar: 4,
  paanch: 5,
  panch: 5,
  chhe: 6,
  chhah: 6,
  chhai: 6,
  che: 6,
  saat: 7,
  aath: 8,
  nau: 9,
  das: 10,
  gyarah: 11,
  gyaarah: 11,
  barah: 12,
  baarah: 12,
  terah: 13,
  chaudah: 14,
  pandrah: 15,
  pandra: 15,
  solah: 16,
  satrah: 17,
  atharah: 18,
  athaarah: 18,
  unnees: 19,
  unnis: 19,
  bees: 20,
  tees: 30,
  chalis: 40,
  chaalis: 40,
  pachas: 50,
  pachaas: 50,
  saath: 60,
  sattar: 70,
  assi: 80,
  nabbe: 90,
};

/** 0-100 in Devanagari, already folded (no nukta, chandrabindu as anusvara). */
const DEVA_LIST = [
  ['शून्य', 0],
  ['एक', 1],
  ['दो', 2],
  ['तीन', 3],
  ['चार', 4],
  ['पांच', 5],
  ['छह', 6],
  ['छः', 6],
  ['छे', 6],
  ['छै', 6],
  ['सात', 7],
  ['आठ', 8],
  ['नौ', 9],
  ['दस', 10],
  ['ग्यारह', 11],
  ['बारह', 12],
  ['तेरह', 13],
  ['चौदह', 14],
  ['पंद्रह', 15],
  ['पन्द्रह', 15],
  ['सोलह', 16],
  ['सत्रह', 17],
  ['सत्तरह', 17],
  ['अठारह', 18],
  ['अट्ठारह', 18],
  ['उन्नीस', 19],
  ['बीस', 20],
  ['इक्कीस', 21],
  ['बाईस', 22],
  ['तेईस', 23],
  ['चौबीस', 24],
  ['पच्चीस', 25],
  ['छब्बीस', 26],
  ['सत्ताईस', 27],
  ['अट्ठाईस', 28],
  ['उनतीस', 29],
  ['तीस', 30],
  ['इकतीस', 31],
  ['इकत्तीस', 31],
  ['बत्तीस', 32],
  ['तैंतीस', 33],
  ['चौंतीस', 34],
  ['पैंतीस', 35],
  ['छत्तीस', 36],
  ['सैंतीस', 37],
  ['अडतीस', 38],
  ['उनतालीस', 39],
  ['चालीस', 40],
  ['इकतालीस', 41],
  ['बयालीस', 42],
  ['तैंतालीस', 43],
  ['चवालीस', 44],
  ['चौवालीस', 44],
  ['पैंतालीस', 45],
  ['छियालीस', 46],
  ['सैंतालीस', 47],
  ['अडतालीस', 48],
  ['उनचास', 49],
  ['पचास', 50],
  ['इक्यावन', 51],
  ['बावन', 52],
  ['तिरपन', 53],
  ['चौवन', 54],
  ['पचपन', 55],
  ['छप्पन', 56],
  ['सत्तावन', 57],
  ['अट्ठावन', 58],
  ['उनसठ', 59],
  ['साठ', 60],
  ['इकसठ', 61],
  ['बासठ', 62],
  ['तिरसठ', 63],
  ['चौंसठ', 64],
  ['पैंसठ', 65],
  ['छियासठ', 66],
  ['सडसठ', 67],
  ['अडसठ', 68],
  ['उनहत्तर', 69],
  ['सत्तर', 70],
  ['इकहत्तर', 71],
  ['बहत्तर', 72],
  ['तिहत्तर', 73],
  ['चौहत्तर', 74],
  ['पचहत्तर', 75],
  ['छिहत्तर', 76],
  ['सतहत्तर', 77],
  ['अठहत्तर', 78],
  ['उन्यासी', 79],
  ['अस्सी', 80],
  ['इक्यासी', 81],
  ['बयासी', 82],
  ['तिरासी', 83],
  ['चौरासी', 84],
  ['पचासी', 85],
  ['छियासी', 86],
  ['सत्तासी', 87],
  ['अट्ठासी', 88],
  ['नवासी', 89],
  ['नब्बे', 90],
  ['इक्यानवे', 91],
  ['बानवे', 92],
  ['तिरानवे', 93],
  ['चौरानवे', 94],
  ['पचानवे', 95],
  ['छियानवे', 96],
  ['सत्तानवे', 97],
  ['अट्ठानवे', 98],
  ['निन्यानवे', 99],
] as const;

const SCALES: Record<string, number> = {
  hundred: 100,
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
  sau: 100,
  hazaar: 1_000,
  hazar: 1_000,
  hajar: 1_000,
  lakh: 100_000,
  lakhs: 100_000,
  lac: 100_000,
  crore: 10_000_000,
  crores: 10_000_000,
  karod: 10_000_000,
  सौ: 100,
  हजार: 1_000,
  लाख: 100_000,
  करोड: 10_000_000,
};

/** Folds a lower-cased word: drops the Devanagari nukta, chandrabindu becomes anusvara. */
export function foldWord(w: string): string {
  return w.replace(/\u093C/g, '').replace(/\u0901/g, '\u0902');
}

const SMALL = new Map<string, number>();
EN_UNITS.forEach((w, i) => SMALL.set(w, i));
for (const [w, v] of Object.entries(EN_TENS)) SMALL.set(w, v);
for (const [w, v] of Object.entries(HI_LATIN)) SMALL.set(w, v);
for (const [w, v] of DEVA_LIST) SMALL.set(foldWord(w), v);
const SCALE_MAP = new Map(Object.entries(SCALES).map(([w, v]) => [foldWord(w), v]));

/** The number word `w` (lower-cased, folded) names, if any. */
export function numberWord(w: string): NumberWord | undefined {
  const small = SMALL.get(w);
  if (small !== undefined) return { kind: 'small', value: small };
  const scale = SCALE_MAP.get(w);
  return scale === undefined ? undefined : { kind: 'scale', value: scale };
}

/** Scale words plus the short forms a digit run may carry ("24 hazaar", "2.4 lakh", "24k"). */
const SUFFIX_MAP = new Map([...SCALE_MAP, ['k', 1_000], ['mn', 1_000_000], ['cr', 10_000_000]]);

/** The multiplier a suffix after a digit run stands for, if any. */
export function scaleSuffix(w: string): number | undefined {
  return SUFFIX_MAP.get(foldWord(w));
}

/** The suffix alternatives for a regex, longest first so "lakhs" wins over "lakh". */
export const SCALE_SUFFIX_SOURCE = [...SUFFIX_MAP.keys()]
  .sort((a, b) => b.length - a.length)
  .join('|');
