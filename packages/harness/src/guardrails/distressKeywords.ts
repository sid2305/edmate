// Distress keyword tables (task 4.3): the single source of keyword truth for distressDetect and
// for `PipelineDeps.distressCheck` (the runner's raw-text and fallback checks). Pure, no model.
//
// - Every table (English, romanised Hindi, Devanagari) runs on every message, whatever `lang`
//   says: a student writes in whichever script they like (lead answer 1).
// - The text is normalised first (NFKC, format characters, case, apostrophes, spaced or dotted
//   letters, leetspeak inside words, repeated letters), so hidden characters and spelling tricks
//   cannot dodge a phrase (lead answer 2). The tables never hold an obfuscated spelling.
// - `hard` phrases escalate on their own. `soft` phrases are ambiguous: distressDetect asks the
//   classifier, and escalates if the classifier fails. Two different soft phrases in one message
//   count as hard (lead answer 3).
// - Phrases, not bare words, with letter-aware boundaries, so "skill", "diet", "kill -9", "die
//   roll" or "loop khatam" never fire (lead answer 9).
// Built in, not locale-pack data: LocalePack has no keyword field (plan Q1); 3.10 can move it.
import type { Lang } from '@edmate/contracts';

export type DistressKeywordLevel = 'hard' | 'soft' | 'none';

/** What a hard phrase signals: self-harm or suicide (`distress`), or harm by someone else. */
export type DistressKeywordKind = 'distress' | 'abuse';

export interface DistressKeywordMatch {
  level: DistressKeywordLevel;
  /** `abuse` only when every hard hit is an abuse phrase; otherwise `distress`. */
  kind: DistressKeywordKind;
}

interface Entry {
  re: RegExp;
  kind: DistressKeywordKind;
}

/** A phrase that is not inside a longer word (letters, marks and digits on either side). */
const phrase = (src: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${src})(?![\\p{L}\\p{M}\\p{N}])`, 'u');

/** Up to `n` whole words between two parts of a phrase (normalised text is single-spaced). */
const gap = (n: number): string => `(?: \\S+){0,${n}}`;

const NOT = '(?:nahi|nahin|nai|nhi|ni)';
const DEVA_NOT = '(?:नहीं|नही)';
const SELF = '(?:my ?self|me ?self)';

const kin =
  '(?:dad|daddy|father|mom|mum|mother|papa|mummy|mumma|uncle|aunt|aunty|brother|sister|stepdad|' +
  'stepmom|stepfather|stepmother|parents|grandfather|grandpa|relative|cousin|teacher|tutor|coach|' +
  'boyfriend)';
const romanKin =
  '(?:papa|papaa|pappa|daddy|dad|mummy|mumma|mummi|maa|mom|bhai|bhaiya|chacha|mama|mamu|uncle|' +
  'sautela|sauteli|dada|nana)';
const devaKin = '(?:पापा|पिताजी|पिता|मम्मी|मां|भाई|चाचा|मामा|अंकल|रिश्तेदार|सौतेले|सौतेला)';

const distress = (src: string): Entry => ({ re: phrase(src), kind: 'distress' });
const abuse = (src: string): Entry => ({ re: phrase(src), kind: 'abuse' });

const HARD: readonly Entry[] = [
  // English: suicide and wanting to die.
  distress('suicid(?:e|al)|unalive'),
  distress(`kill(?:ing)? ${SELF}`),
  distress('(?<![0-9] ?)kms'),
  distress(`end(?:ing)? (?:it all|my life|my own life|${SELF})`),
  distress(
    '(?:thinking|think|thought|thoughts|thinkin) (?:about|of) ' +
      `(?:ending it|ending my life|killing ${SELF}|dying)`,
  ),
  distress('take my (?:own )?life'),
  distress('(?:want|wanted|wanna|wish|ready|deserve) (?:to )?die'),
  distress('wish i (?:was|were|could be) dead'),
  distress('rather (?:be dead|die|not exist|not be alive|not live|not be here)'),
  distress(
    '(?:dont|do not|never|not) (?:want|wanna) (?:to )?' +
      '(?:live|be alive|exist|wake up|be here (?:any ?more|no more))',
  ),
  distress('better off (?:without|w/o|w/out|witout) me'),
  distress('better off if i (?:was|were|wasnt|werent) (?:gone|dead|here|around)'),
  distress('no point (?:in |to |of )?(?:living|life|being alive|me|my life|existing|going on)'),
  distress(`(?:made|make|making) (?:my|the|this|a) (?:final )?(?:decision|choice)${gap(8)} at peace`),
  distress(
    '(?:no one|nobody|noone) would (?:even )?(?:care|notice|miss me) if i ' +
      '(?:died|was gone|were gone|disappeared|wasnt here|was dead)',
  ),
  distress(
    '(?:cut|cutting|cuts|burn|burning|burned|burnt|hurt|hurting|harm|harming|starve|starving|' +
      `punish|punishing) ${SELF}`,
  ),
  distress('(?:i|ive|i have)(?: been)? cut(?:ting)? again'),
  distress('cut(?:ting)? my (?:wrist|wrists|arm|arms|thigh|thighs|skin|leg|legs)'),
  distress('self ?harm(?:ing)?|hang(?:ing)? my ?self'),
  distress(
    '(?:make|makes|making) (?:me|someone|somebody|a person|you|him|her|them|people) ' +
      '(?:never|not) wake up',
  ),
  distress(`(?:take|swallow|drink|eat|consume|ingest)${gap(3)} to (?:die|never wake up|not wake up)`),
  distress(
    '(?:how|ways?|easiest way|best way|quickest way|painless way|fastest way) to ' +
      `(?:die|kill ${SELF}|end (?:it all|my life)|commit suicide)`,
  ),
  distress('(?:dont|do not) (?:even )?deserve (?:to )?(?:food|eat|live|be alive|exist)'),
  distress(`(?:dont|do not|not) feel safe (?:with|around|by) ${SELF}|not safe (?:with|around) ${SELF}`),
  // English: harm by someone else.
  abuse(`${kin}${gap(2)} (?:hits|beats|slaps|punches|kicks|chokes|abuses|hurts|touches) me(?! (?:at|in) )`),
  abuse('(?:scared|afraid|frightened|terrified) (?:to go|of going) home'),
  abuse(
    '(?:touch|touches|touched|touching) me ' +
      '(?:wrong|wrongly|inappropriately|in a bad way|down there|where i dont want)',
  ),
  abuse('molest\\S*|rape[ds]?|raping|sexually abus\\S*'),

  // Romanised Hindi.
  distress('aatmahatya|atmahatya|aatmhatya|atmhatya|khudkushi|khudkhushi'),
  distress(
    'mar (?:jaana|jana|jaau|jaaun|jaun|jau|jaaon|jaaoon|jaunga|jaungi|jaaunga|jaaungi|' +
      'jaoonga|jaoongi)',
  ),
  distress('(?:marna|mrna) (?:hai|h|chahta|chahti|chahiye)|(?:mujhe|main|mai) marna'),
  distress(
    `(?:jeena|jina|jeene|jine)(?: (?:ka|ki|ke|ko|mann|man|mn|hi|ab|mujhe|muje|aur|bhi|h|hai)){0,3} ${NOT}(?! de)`,
  ),
  distress(`(?:jeene|jine) ka (?:koi )?(?:matlab|fayda|faida|reason) ${NOT}`),
  distress(
    '(?:khud ?ko|apne aap ko|apne ap ko) ' +
      '(?:hurt|chot|nuksan|nuksaan|nukshan|harm|khatam|khtm|maar|mar|zakhmi|kaat)',
  ),
  distress(
    'sab(?: kuch| kuchh)? (?:khatam|khtm) ' +
      '(?:karna|kar dena|kar du|kar dun|kar doon|kar dunga|kar dungi|kar lena|kar lu|kar lun)',
  ),
  distress('zindagi (?:khatam|khtm)'),
  distress(
    `(?:kal tak|kal subah tak|zyada din|jyada din|aur din)${gap(2)} ` +
      `(?:(?:rahunga|rahungi|rahoonga|rahoongi|bachunga|bachungi)(?: hi)? ${NOT}|` +
      `${NOT} (?:rahunga|rahungi|rahoonga|rahoongi|bachunga|bachungi))`,
  ),
  distress(
    'blade (?:chala|chalaya|chalayi|chalati|chalata|maara|mara|maari|lagaya)|' +
      'haath (?:pe|par) blade|(?:kalai|nas|nass)(?: \\S+){0,2} (?:kaat|kaata|kaati|kata|kati|cut)',
  ),
  abuse(
    `${romanKin}${gap(2)} (?:maarte|marte|maarta|marta|maarti|marti|peette|peetta|peetti|pitai karte) ` +
      '(?:hai|hain|h|he|hein)',
  ),
  abuse('(?:ghar|ghr) (?:jaane|jane|jaana|jana) (?:se|me|mein) (?:darr|dar) (?:lagta|lgta|lagti)'),
  abuse('(?:galat|ganda|gande|gandi) (?:tarike|tareeke|tarah|jagah) (?:se )?(?:chhoo|chhu|chu|choo)\\S*'),

  // Devanagari (nukta dropped, chandrabindu mapped to anusvara by the normaliser).
  distress('आत्महत्या|आत्म हत्या|खुदकुशी|खुद कुशी|सुसाइड'),
  distress('(?:खुद|अपने आप|अपने|स्वयं) को (?:चोट|नुकसान|नुक्सान|हानि|खत्म|मार|घायल|काट)'),
  distress('सब(?: कुछ)? खत्म कर (?:देना|दूं|दूंगा|दूंगी|लूं|लेना)'),
  distress(`(?:जीना|जीने)(?: (?:का|की|के|को|मन|मूड|ही|अब|मुझे|और|भी|है)){0,3} ${DEVA_NOT}`),
  distress('मर (?:जाना|जाऊं|जाऊंगा|जाऊंगी|जाउं|जाउंगा|जाउंगी)|मरना (?:चाहता|चाहती|है)'),
  distress(`(?:होने|रहने|मरने|जीने)(?: या न (?:होने|रहने))? से${gap(3)} (?:फर्क|फरक) ${DEVA_NOT}`),
  distress('(?:कलाई|नस)(?: \\S+){0,2} (?:काट|काटी|काटा|ब्लेड)'),
  abuse('(?:गलत|गंदे|गन्दे|गंदी) (?:तरीके|तरह|जगह) से (?:छूते|छूता|छूती|छुआ|छूआ|छुते|छुता)'),
  abuse(`${devaKin}${gap(2)} (?:मारते|पीटते|मारता|पीटता|मारती|पीटती)`),
  abuse('घर (?:जाने|जाना) से (?:डर|डरता|डरती)'),
];

const SOFT: readonly RegExp[] = [
  // English.
  '(?:cant|can not|cannot) (?:do|take|handle|bear) (?:this|it)(?: \\S+)? any ?mor(?:e)?',
  'nothing (?:really )?matters',
  'hopeless|worthless|useless at everything|im useless',
  '(?:want|wanna|wish i could) (?:to )?(?:just )?disappear',
  `(?:hate|hates) ${SELF}`,
  'end it',
  'no point (?:trying|in trying|anymore|any more)',
  'pills|tablets|overdos(?:e|ing)',
  '(?:never|not) wake up',
  '(?:goodbye|bye) (?:forever|everyone)|this is goodbye',
  'at peace with (?:it|this|my decision|dying)',
  '(?:made|making) (?:my|the|a) (?:final )?decision',
  '(?:wont|will not) need to (?:help|see|talk to) me',
  'tired of (?:living|life|everything|being alive)',
  '(?:give|giving|gave) up on (?:life|everything|myself)',
  '(?:havent|have not|didnt) eaten (?:in|for) (?:\\S+ )?days',
  '(?:nobody|no one|noone) (?:cares|would care|understands|loves) (?:about )?me',
  'dont tell anyone|i dont matter|(?:im|i am) (?:a )?burden',
  // Romanised Hindi.
  '(?:thak|thk) (?:gaya|gya|gayi|gyi|gai) (?:hu|hoon|hun|h)',
  `${NOT} (?:rahunga|rahungi|rahoonga|rahoongi)|(?:rahunga|rahungi) ${NOT}`,
  'sab (?:bekaar|bekar|bakwas)',
  `koi ${NOT} (?:samajhta|samjhta|samajhti)`,
  `(?:bardasht|bardaasht|sahan|sehan) ${NOT} (?:hota|hoti|hoga|ho raha)`,
  '(?:kisi ko|kisiko) (?:mat|na) (?:batana|bata|batao)',
  'jaan (?:de dunga|de dungi|de du|dedu|dena)',
  '(?:zindagi|life) se (?:tang|pareshan|thak)',
  // Devanagari.
  `(?:सहा|सहन|बर्दाश्त) ${DEVA_NOT} (?:जाता|होता)|${DEVA_NOT} (?:सहा|सहन) (?:जाता|होता)`,
  'थक (?:गया|गई|गयी) (?:हूं|हू)',
  `कोई ${DEVA_NOT} समझता`,
  'किसी को (?:मत|न) बताना',
  'जान दे (?:दूंगा|दूंगी|दूं|देना)',
].map(phrase);

// ---- normalisation ------------------------------------------------------------------------

const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
};

/**
 * The forms of `text` the tables are matched against: the normalised text, then the same with
 * runs of 3+ identical Latin letters squashed to two ("killll" → "kill") and to one ("dieee" →
 * "die"). Exported for tests.
 */
export function normaliseForDistress(text: string): string[] {
  let t = text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    // Devanagari: drop the nukta (फ़ → फ), chandrabindu → anusvara (हूँ → हूं).
    .replace(/\u093c/g, '')
    .replace(/\u0901/g, '\u0902')
    .toLowerCase()
    .replace(/['\u2018\u2019\u02bc`\u00b4]/g, '');
  // Leetspeak only inside a word (letters on both sides), or $ / @ starting one: plain numbers
  // ("in 3 days", "score = 10") stay as they are.
  t = t
    .replace(/(?<=\p{L})[013457@$!](?=\p{L})/gu, (c) => LEET[c] as string)
    .replace(/(?<![\p{L}\p{N}])[$@](?=\p{L})/gu, (c) => LEET[c] as string);
  // Single Latin letters split by spaces, dots, dashes, underscores or stars: "k i l l" → "kill".
  t = t.replace(/(?<![\p{L}\p{M}])[a-z](?:[\s._*\u00b7-]+[a-z](?![\p{L}\p{M}])){2,}/gu, (m) =>
    m.replace(/[^a-z]/g, ''),
  );
  // Punctuation and symbols (emoji included) become spaces; "/" stays for "w/o".
  t = t
    .replace(/[^\p{L}\p{M}\p{N}\s/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const two = t.replace(/([a-z])\1{2,}/g, '$1$1');
  const one = t.replace(/([a-z])\1{2,}/g, '$1');
  return [...new Set([t, two, one])];
}

/** The strongest keyword level in `text`, from every language table. */
export function distressKeywordMatch(text: string): DistressKeywordMatch {
  const forms = normaliseForDistress(text);
  const hits = (re: RegExp) => forms.some((f) => re.test(f));
  const hard = HARD.filter((e) => hits(e.re));
  if (hard.length > 0) {
    return { level: 'hard', kind: hard.every((e) => e.kind === 'abuse') ? 'abuse' : 'distress' };
  }
  const soft = SOFT.filter(hits).length;
  if (soft >= 2) return { level: 'hard', kind: 'distress' };
  return { level: soft === 1 ? 'soft' : 'none', kind: 'distress' };
}

export function distressKeywordLevel(text: string): DistressKeywordLevel {
  return distressKeywordMatch(text).level;
}

/**
 * The implementation behind `PipelineDeps.distressCheck`: true on a hard keyword in any table.
 * `lang` is ignored on purpose (lead answer 1); it is only in the signature to fit the seam.
 */
export function hasDistressKeyword(text: string, _lang?: Lang): boolean {
  return distressKeywordLevel(text) === 'hard';
}
