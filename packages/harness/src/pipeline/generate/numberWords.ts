// Number words for the answer-leak checks (task 4.5): English, Hindi in Latin letters and Hindi in
// Devanagari (0-100), plus the scale words they combine with. Hand-written tables, no library
// (mathjs is arithmetic, not number names). Words are looked up after `foldWord`, so spelling
// variants that differ only by nukta or chandrabindu (हज़ार / हजार, पाँच / पांच) are one entry.
// Hindi in Latin letters covers 0-99 (21-99 transliterated from the Devanagari table, fix round
// 1), and its many spellings (chaubees / chaubis / chobis) are matched through `latinFold`. Fix
// round 2 (4.5c) adds spellings `latinFold` folds to a different value than the table's own
// (baiyaalis / byalis / beyalis for 42, unatees for 29): listed explicitly, never guessed.

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

/** Hindi 21-99 in Latin letters, a few common spellings each; the rest come from latinFold. */
const HI_LATIN_21_99 =
  '21 ikkees ikkis ekkis;22 baees bais baais;23 teyees teyis teis;24 chaubees chaubis chobis;' +
  '25 pachchees pachees pachis pachchis;26 chhabbees chhabbis chabbis;27 sattaees sattais;' +
  '28 atthaees atthais athais;29 untees untis unatees;31 iktees ikattis ikatees iktis ikattees;' +
  '32 battees battis;33 taintees taintis tetis;34 chauntees chauntis chautis chontis;' +
  '35 paintees paintis pentis;36 chhattees chhattis chattis;37 saintees saintis sentis;' +
  '38 adtees artees adtis artis;39 untaalees untalis;41 iktaalees iktalis;' +
  '42 bayaalees bayalis baiyaalis byalis beyalis;' +
  '43 taintaalees taintalis tetalis;44 chavaalees chawalis chauvalis;' +
  '45 paintaalees paintalis;46 chhiyaalees chhiyalis;47 saintaalees saintalis;' +
  '48 adtaalees adtalis artalis;49 unchaas unchas;51 ikyaavan ikyavan;52 baavan bavan;' +
  '53 tirpan tirepan;54 chauvan chauwan;55 pachpan pachapan;56 chhappan chhapan;' +
  '57 sattaavan sattavan;58 atthaavan athavan;59 unsath;61 iksath;62 baasath basath;' +
  '63 tirsath tresath;64 chaunsath chausath;65 painsath pensath;66 chhiyaasath chhiyasath;' +
  '67 sadsath sarsath;68 adsath arsath;69 unhattar;71 ikhattar;72 bahattar;73 tihattar;' +
  '74 chauhattar;75 pachhattar;76 chhihattar;77 sathattar satattar;78 athhattar athattar;' +
  '79 unaasi unasi unyaasi;81 ikyaasi ikyasi;82 bayaasi bayasi;83 tiraasi tirasi;' +
  '84 chauraasi chaurasi;85 pachaasi pachasi;86 chhiyaasi chhiyasi;87 sattaasi sattasi;' +
  '88 atthaasi athasi;89 navaasi navasi;91 ikyaanave ikyanve;92 baanave banve;' +
  '93 tiraanave tiranve;94 chauraanave chauranve;95 pachaanave pachanve;' +
  '96 chhiyaanave chhiyanve;97 sattaanave sattanve;98 atthaanave athanve;' +
  '99 ninyaanave ninyanve';

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

/**
 * Folds a Hindi word in Latin letters to one spelling: doubled letters once, ch-ch as ch, chh as
 * ch, au as o, ai as e, w as v, then e and ee as i ("chaubees", "chaubis", "chobis" all fold to
 * "chobis"). Used only for words of LATIN_FOLD_MIN letters or more, so short English words ("no",
 * "tin") are never read as numbers through it.
 */
export function latinFold(w: string): string {
  return w
    .replace(/chch/g, 'ch')
    .replace(/chh/g, 'ch')
    .replace(/au/g, 'o')
    .replace(/ai/g, 'e')
    .replace(/w/g, 'v')
    .replace(/(.)\1+/g, '$1')
    .replace(/e/g, 'i');
}
const LATIN_FOLD_MIN = 5;

/** Folds a lower-cased word: drops the Devanagari nukta, chandrabindu becomes anusvara. */
export function foldWord(w: string): string {
  return w.replace(/\u093C/g, '').replace(/\u0901/g, '\u0902');
}

const SMALL = new Map<string, number>();
EN_UNITS.forEach((w, i) => SMALL.set(w, i));
for (const [w, v] of Object.entries(EN_TENS)) SMALL.set(w, v);
for (const [w, v] of Object.entries(HI_LATIN)) SMALL.set(w, v);
for (const [w, v] of DEVA_LIST) SMALL.set(foldWord(w), v);
for (const group of HI_LATIN_21_99.split(';')) {
  const [v, ...words] = group.split(' ');
  for (const w of words) SMALL.set(w, Number(v));
}
/** Hindi-Latin spellings folded; a folded form two values share is dropped (never guessed). */
const FOLDED = new Map<string, number>();
const ambiguous = new Set<string>();
for (const [w, v] of [
  ...Object.entries(HI_LATIN),
  ...HI_LATIN_21_99.split(';').flatMap((g) => {
    const [n, ...ws] = g.split(' ');
    return ws.map((x) => [x, Number(n)] as const);
  }),
]) {
  if (w.length < LATIN_FOLD_MIN) continue;
  const f = latinFold(w);
  const had = FOLDED.get(f);
  if (had !== undefined && had !== v) ambiguous.add(f);
  FOLDED.set(f, v);
}
for (const f of ambiguous) FOLDED.delete(f);
/** Folded spellings two values share (read as no number); exported for the table's test. */
export const AMBIGUOUS_LATIN_FOLDS: ReadonlySet<string> = ambiguous;
const SCALE_MAP = new Map(Object.entries(SCALES).map(([w, v]) => [foldWord(w), v]));

/** The number word `w` (lower-cased, folded) names, if any. */
export function numberWord(w: string): NumberWord | undefined {
  const small =
    SMALL.get(w) ??
    (w.length >= LATIN_FOLD_MIN && /^[a-z]+$/.test(w) ? FOLDED.get(latinFold(w)) : undefined);
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
