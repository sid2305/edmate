// Distress keyword tables (task 4.3): the single source of keyword truth for distressDetect, for
// `PipelineDeps.distressCheck` (hard phrases, also on the raw text) and for the runner's fallback
// when preGuard fails (hard or soft). Pure, no model.
//
// - Every table (English, romanised Hindi, Devanagari) runs on every message, whatever `lang`
//   says: a student writes in whichever script they like (lead answer 1).
// - The text is normalised first, into several forms (format characters dropped and read as
//   spaces, NFKD with Latin accents stripped, Cyrillic and Greek look-alikes, case, apostrophes,
//   leetspeak, digit words, spaced or dotted letters, repeated letters), and written-together
//   phrases ("killmyself") are checked per word, so tricks cannot dodge a phrase (lead answer 2).
//   The tables hold stems and patterns, never an obfuscated spelling or an eval string.
// - `hard`: intent, plan or method in the first person ("i want to die", "zehar kha lunga") and
//   abuse disclosures. It escalates on its own.
// - `soft`: ambiguous on its own: bare nouns ("suicide"), third person or past tense ("he killed
//   himself", "wanted to die"), vague farewells ("tomorrow i wont be here"), and any hard phrase in
//   a game context ("in minecraft"). distressDetect asks the classifier, also when two unrelated
//   soft phrases hit; a classifier failure on a soft hit escalates (lead answer 3, safety review).
// - Two combinations of soft phrases count as hard (lead decision, fix round 2): (a) a method
//   phrase (rope or noose, pills, blade, jumping off, poison, a roof) plus any other soft phrase;
//   (b) a first-person vanish phrase plus a hopelessness phrase.
// - Phrases with letter-aware boundaries, so "skill", "diet", "kill -9", "die roll" or "loop
//   khatam" never fire (lead answer 9).
// Built in, not locale-pack data: LocalePack has no keyword field (plan Q1); 3.10 can move it.
import type { Lang } from '@edmate/contracts';

export type DistressKeywordLevel = 'hard' | 'soft' | 'none';

/** What a hard phrase signals: self-harm or suicide (`distress`), or harm by someone else. */
export type DistressKeywordKind = 'distress' | 'abuse';

export interface DistressKeywordMatch {
  level: DistressKeywordLevel;
  /** `abuse` only when every hard hit is an abuse phrase; otherwise `distress`. */
  kind: DistressKeywordKind;
  /** How many different soft phrases hit (a hard phrase in a game context counts as one). */
  softHits: number;
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
/** Not after a third-person subject ("they want to die" is about someone else). */
const NOT_THIRD = '(?<!(?:he|she|they|people|who|someone|somebody|character|characters) )';
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
  // English: intent to die, a plan or a method, in the first person.
  distress(`suicid(?:e|al) (?:thoughts|feelings|plan)|(?:feel|feeling|am|im|been|get|getting)(?: so| really| very)? suicidal`),
  distress('commit(?:ting)? suicide|unaliv\\S*'),
  distress(`kill(?:ing)? ${SELF}`),
  distress('(?<![0-9] ?)kms(?! (?:per|an|a|away|from|to|of|left|run|walk|drive|ride|daily)(?!\\p{L}))'),
  distress(`end(?:ing)? (?:it all|my life|my own life|${SELF})`),
  distress('end(?:ing)? (?:it|things|everything) (?:tonight|today|now|soon)'),
  distress(
    '(?:thinking|think|thought|thoughts|thinkin) (?:about|of) ' +
      `(?:suicide|ending it|ending my life|killing ${SELF}|dying|unaliving)`,
  ),
  distress('take my (?:own )?life'),
  distress(`${NOT_THIRD}(?:want|wanna|wish|ready|deserve) (?:to )?die`),
  distress('wish i (?:was|were|could be) dead'),
  distress('rather (?:be dead|die|not exist|not be alive|not live|not be here)'),
  distress(
    '(?:dont|do not|never|not) (?:want|wanna) (?:to )?' +
      '(?:live|be alive|exist|wake up|be here (?:any ?more|no more))',
  ),
  distress('no (?:reason|point) (?:to|for|in|of) (?:live|living|life|being alive|go on|going on|keep going)'),
  distress('(?:life|living|my life) (?:is not|isnt|aint|is no longer|not) worth (?:living|it)|not worth living'),
  distress('better off (?:without|w/o|w/out|witout) me'),
  distress('better off if i (?:was|were|wasnt|werent) (?:gone|dead|here|around)'),
  distress('no point (?:in |to |of )?(?:me|my life|existing)'),
  distress(`(?:made|make|making) (?:my|the|this|a) (?:final )?(?:decision|choice)${gap(8)} at peace`),
  distress(
    '(?:no one|nobody|noone) would (?:even )?(?:care|notice|miss me) if i ' +
      '(?:died|was gone|were gone|disappeared|wasnt here|was dead)',
  ),
  distress(
    '(?:cut|cutting|cuts|burn|burning|burned|burnt|hurt|hurting|harm|harming|starve|starving|' +
      `punish|punishing) ${SELF}` +
      '(?! (?:a|an|some|another|on|while|by accident|shaving|cooking|the)(?!\\p{L}))',
  ),
  distress('(?:i|ive|i have)(?: been)? cut(?:ting)? again'),
  distress('cut(?:ting)? my (?:wrist|wrists|arm|arms|thigh|thighs|skin|leg|legs)'),
  distress(`(?:i|im|ive|i have|i am|been|keep|started|start)(?: \\S+){0,2} self ?harm\\S*|hang(?:ing)? ${SELF}`),
  distress(
    '(?:make|makes|making) (?:me|someone|somebody|a person|you|him|her|them|people) ' +
      '(?:never|not) wake up',
  ),
  distress(`(?:take|swallow|drink|eat|consume|ingest)${gap(3)} to (?:die|never wake up|not wake up)`),
  distress(
    '(?:how|ways?|easiest way|best way|quickest way|painless way|fastest way) to ' +
      `(?:die|kill ${SELF}|end (?:it all|my life)|commit suicide)`,
  ),
  distress(
    '(?:jump|jumping|throw myself) (?:off|from) (?:the|a|my|our) ' +
      '(?:roof|bridge|building|terrace|balcony|cliff|window)',
  ),
  distress('(?:dont|do not) (?:even )?deserve (?:to )?(?:food|eat|live|be alive|exist)'),
  distress(`(?:dont|do not|not) feel safe (?:with|around|by) ${SELF}|not safe (?:with|around) ${SELF}`),
  // English: harm by someone else.
  abuse(`${kin}${gap(2)} (?:hits|beats|slaps|punches|kicks|chokes|abuses|hurts|touches) me`),
  abuse('(?:scared|afraid|frightened|terrified) (?:to go|of going) home'),
  abuse(
    '(?:touch|touches|touched|touching) me ' +
      '(?:wrong|wrongly|inappropriately|in a bad way|down there|where i dont want)',
  ),
  abuse('molest\\S*|rape[ds]?|raping|sexually abus\\S*'),

  // Romanised Hindi.
  distress(
    '(?:suicide|aatmahatya|atmahatya|aatmhatya|atmhatya|khudkushi|khudkhushi) ' +
      '(?:kar|kr|karna|krna|karne|krne|karu|kru|karun|karunga|karungi|krunga|krungi|karegi|karega)',
  ),
  distress(
    `(?:aatmahatya|atmahatya|suicide|khudkushi) (?:ke|ka|ki) (?:baare|bare)${gap(2)} (?:soch|sochta|sochti)`,
  ),
  distress(
    'mar (?:jaana|jana|jaau|jaaun|jaun|jau|jaaon|jaaoon|jaunga|jaungi|jaaunga|jaaungi|' +
      'jaoonga|jaoongi)',
  ),
  distress('(?:marna|mrna) (?:hai|h|chahta|chahti|chahiye)|(?:mujhe|main|mai) marna'),
  distress('marne (?:ka|ki|ko) (?:mann|man|mn|dil|ichha|iccha|ichchha|irada|khayal|khyal)'),
  distress(
    `(?:jeena|jina|jeene|jine)(?: (?:ka|ki|ke|ko|mann|man|mn|hi|ab|mujhe|muje|aur|bhi|h|hai)){0,3} ${NOT}` +
      '(?! (?:de|deta|deti|aata|ata|aati|ati))',
  ),
  distress(`(?:jeene|jine) (?:ki|ka) (?:ichha|iccha|ichchha|echha|chah|chaah|wajah|matlab|fayda|faida|reason)${gap(2)} ${NOT}`),
  distress(
    `${NOT} (?:jee|ji) (?:sakta|sakti|skta|skti|paunga|paungi|paaunga|paaungi)|` +
      `(?:jee|ji) ${NOT} (?:sakta|sakti|skta|skti|paunga|paungi)`,
  ),
  distress(`zinda ${NOT} (?:rehna|rahna|rehna hai|rahunga|rahungi)|zinda rehne ka (?:mann|man|dil) ${NOT}`),
  distress(
    '(?:khud ?ko|apne aap ko|apne ap ko) ' +
      '(?:hurt|chot|nuksan|nuksaan|nukshan|harm|khatam|khtm|maar|mar|zakhmi|kaat)',
  ),
  distress(`(?:apni|khud ki|apni khud ki) jaan (?:le|de|lena|dena|leni|deni)`),
  distress(`(?:zehar|zeher|zahar|jahar|zehr)${gap(1)} (?:kha|khaa|pee|pi|pila)\\S*`),
  distress(`(?:chhat|chat|chhath|chhatt|building|terrace|pul|bridge) (?:se|par se) (?:kood|kud|koodh|jump)\\S*`),
  distress(`(?:neend|nind) (?:ki|wali) (?:goli|goliyan|goliyaan|golian|golia|tablet\\S*)${gap(2)} (?:kha|khaa|le)\\S*`),
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
  distress('(?:आत्महत्या|आत्म हत्या|खुदकुशी|खुद कुशी|सुसाइड) (?:कर|करना|करने|करूं|करूंगा|करूंगी|करुंगा|करुंगी|कर लूं)'),
  distress(`(?:आत्महत्या|खुदकुशी|सुसाइड) (?:के बारे में|का|की)${gap(1)} (?:सोच|ख्याल|विचार)`),
  distress('(?:खुद|अपने आप|अपने|स्वयं) को (?:चोट|नुकसान|नुक्सान|हानि|खत्म|मार|घायल|काट)'),
  distress('सब(?: कुछ)? खत्म कर (?:देना|दूं|दूंगा|दूंगी|लूं|लेना)'),
  distress(`(?:जीना|जीने)(?: (?:का|की|के|को|मन|मूड|ही|अब|मुझे|और|भी|है|इच्छा)){0,3} ${DEVA_NOT}(?! (?:आता|आती|देता|देती))`),
  distress('मर (?:जाना|जाऊं|जाऊंगा|जाऊंगी|जाउं|जाउंगा|जाउंगी|जाऊ|जाउ)|मरना (?:चाहता|चाहती|है)'),
  distress('मरने (?:का|की) (?:मन|इच्छा|दिल|ख्याल|इरादा)'),
  distress(`(?:जिंदा|जिन्दा) ${DEVA_NOT} (?:रहना|रहूंगा|रहूंगी)`),
  distress('(?:छत|बिल्डिंग|पुल) से (?:कूद|कुद)'),
  distress(`(?:जहर|ज़हर)${gap(1)} (?:खा|पी)`),
  distress(`(?:होने|रहने|मरने|जीने)(?: या न (?:होने|रहने))? से${gap(3)} (?:फर्क|फरक) ${DEVA_NOT}`),
  distress('(?:कलाई|नस)(?: \\S+){0,2} (?:काट|काटी|काटा|ब्लेड)'),
  abuse('(?:गलत|गंदे|गन्दे|गंदी) (?:तरीके|तरह|जगह) से (?:छूते|छूता|छूती|छुआ|छूआ|छुते|छुता)'),
  abuse(`${devaKin}${gap(2)} (?:मारते|पीटते|मारता|पीटता|मारती|पीटती)`),
  abuse('घर (?:जाने|जाना) से (?:डर|डरता|डरती)'),
];

/** Soft phrase families: `method` and `vanish`/`hopeless` drive the combination rules. */
type SoftFamily = 'method' | 'vanish' | 'hopeless' | 'other';

interface SoftEntry {
  re: RegExp;
  family: SoftFamily;
}

const soft =
  (family: SoftFamily) =>
  (src: string): SoftEntry => ({ re: phrase(src), family });
const method = soft('method');
const vanish = soft('vanish');
const hopeless = soft('hopeless');
const other = soft('other');

const SOFT: readonly SoftEntry[] = [
  // Methods (rule a), as phrases: "jump to the next loop" or "a rope knot" are not methods.
  method('noose|fanda|(?:bought|got|buy|get|have|found|brought) (?:a |some |the )?rope|rope (?:around|for)'),
  method('pills|tablets|(?:neend|nind) (?:ki|wali) gol\\S*|goliyan|goliyaan|गोलियां|गोलियाँ'),
  method('blade|razor|ब्लेड'),
  method('jump (?:off|from)|kood (?:ja|jau|jaun|jaunga|jaungi|jaaunga|jaaungi)|कूद'),
  method('zehar|zeher|zahar|jahar|poison|जहर'),
  method('(?:the|a|my|our) roof|rooftop|(?:chhat|chat) (?:se|par|pe|pr)|छत (?:से|पर|पे)'),
  // First-person vanishing (rule b, with hopelessness).
  vanish(
    '(?:want|wanna|wish i could|wish to) (?:to )?(?:just )?(?:disappear|vanish)|' +
      'gayab (?:ho jaana|ho jana|ho jaun|ho jaunga|ho jaungi|hona)|गायब हो (?:जाना|जाऊं|जाऊंगा|जाऊंगी)',
  ),
  // Hopelessness (rule b).
  hopeless(
    `nothing (?:really )?matters|no point|koi (?:fayda|faida) ${NOT}|` +
      `kuch (?:bhi )?matter ${NOT} (?:karta|krta|karti)|कोई फायदा ${DEVA_NOT}`,
  ),
  // English: bare nouns, third person and past tense, vaguer phrases.
  other('suicid\\S*|self ?harm\\S*|overdos(?:e|ing)'),
  other('(?:killed|kills) (?:him|her|them)sel(?:f|ves)|(?:wanted|wants) to die'),
  other('(?:cant|can not|cannot) (?:do|take|handle|bear) (?:this|it)(?: \\S+)? any ?mor(?:e)?'),
  other('hopeless|worthless|useless at everything|im useless'),
  other(`(?:hate|hates) ${SELF}`),
  other('end it'),
  other('(?:never|not) wake up'),
  other('(?:goodbye|bye) (?:forever|everyone)|this is goodbye'),
  other('at peace with (?:it|this|my decision|dying)'),
  other('(?:made|making) (?:my|the|a) (?:final )?decision'),
  other('(?:wont|will not) need to (?:help|see|talk to) me'),
  other(
    `(?:tomorrow|tonight)${gap(1)} i (?:wont|will not) be (?:here|around|alive)|` +
      '(?:wont|will not) be (?:here|around|alive) (?:tomorrow|tonight|anymore)',
  ),
  other('tired of (?:living|life|everything|being alive)'),
  other('(?:give|giving|gave) up on (?:life|everything|myself)'),
  other('(?:havent|have not|didnt) eaten (?:in|for) (?:\\S+ )?days'),
  other('(?:nobody|no one|noone) (?:cares|would care|understands|loves) (?:about )?me'),
  other('dont tell anyone|i dont matter|(?:im|i am) (?:a )?burden'),
  // Romanised Hindi.
  other('aatmahatya|atmahatya|aatmhatya|atmhatya|khudkushi|khudkhushi'),
  other('(?:thak|thk) (?:gaya|gya|gayi|gyi|gai) (?:hu|hoon|hun|h)'),
  other(`${NOT} (?:rahunga|rahungi|rahoonga|rahoongi)|(?:rahunga|rahungi) ${NOT}`),
  other('sab (?:bekaar|bekar|bakwas)'),
  other(`koi ${NOT} (?:samajhta|samjhta|samajhti)`),
  other(`(?:bardasht|bardaasht|sahan|sehan) ${NOT} (?:hota|hoti|hoga|ho raha)`),
  other('(?:kisi ko|kisiko) (?:mat|na) (?:batana|bata|batao)'),
  other('jaan (?:de dunga|de dungi|de du|dedu|dena)'),
  other('(?:zindagi|life) se (?:tang|pareshan|thak)'),
  other(`(?:jeene|jine) ka dil ${NOT}|(?:jeena|jina) ${NOT} (?:aata|ata|aati)`),
  // Devanagari.
  other('आत्महत्या|खुदकुशी|सुसाइड'),
  other(`(?:सहा|सहन|बर्दाश्त) ${DEVA_NOT} (?:जाता|होता)|${DEVA_NOT} (?:सहा|सहन) (?:जाता|होता)`),
  other('थक (?:गया|गई|गयी) (?:हूं|हू)'),
  other(`कोई ${DEVA_NOT} समझता`),
  other('किसी को (?:मत|न) बताना'),
  other('जान दे (?:दूंगा|दूंगी|दूं|देना)'),
];

/** A hard phrase about a game is ambiguous ("how to die in minecraft"): it counts as soft. */
const GAME = phrase(
  'minecraft|valorant|fortnite|roblox|pubg|bgmi|free ?fire|gta|among us|apex|overwatch|terraria|' +
    'call of duty|squad|in (?:the |this |my |a )?game',
);

/** Written-together phrases ("killmyself", "iwanttodie"), checked word by word. */
const COMPACT = new RegExp(
  '^(?:i|im|ill|iwill|igonna|gonna|wanna|just|iwanna|iwant)?' +
    '(?:killmyself|kilmyself|killmyslf|wanttodie|wannadie|endmylife|takemylife|unalivemyself)' +
    '(?:tonight|now|rn|lol|fr)?$',
);

// ---- normalisation ------------------------------------------------------------------------

const cp = (n: number): string => String.fromCodePoint(n);

/** Combining Diacritical Marks: Latin accents after NFKD (Devanagari marks are another block). */
const LATIN_MARKS = new RegExp(`[${cp(0x300)}-${cp(0x36f)}]`, 'g');
const NUKTA = new RegExp(cp(0x93c), 'g');
const CHANDRABINDU = new RegExp(cp(0x901), 'g');
const APOSTROPHES = new RegExp(`['\`${cp(0x2018)}${cp(0x2019)}${cp(0x2bc)}${cp(0xb4)}]`, 'g');
const SPACED_SEPARATORS = `[\\s._*${cp(0xb7)}-]`;

/** Cyrillic and Greek letters that look like Latin ones (lower and upper case). */
const CONFUSABLES: ReadonlyMap<string, string> = new Map(
  (
    [
      [0x430, 'a'], [0x435, 'e'], [0x456, 'i'], [0x43e, 'o'], [0x441, 'c'], [0x440, 'p'],
      [0x443, 'y'], [0x445, 'x'], [0x43a, 'k'], [0x455, 's'], [0x458, 'j'], [0x4cf, 'l'],
      [0x410, 'A'], [0x415, 'E'], [0x406, 'I'], [0x41e, 'O'], [0x421, 'C'], [0x420, 'P'],
      [0x425, 'X'], [0x41a, 'K'], [0x405, 'S'], [0x3bf, 'o'], [0x3b1, 'a'], [0x3b9, 'i'],
      [0x3b5, 'e'], [0x3ba, 'k'], [0x39f, 'O'], [0x399, 'I'],
    ] as const
  ).map(([c, l]) => [cp(c), l]),
);
const CONFUSABLE_RE = new RegExp(`[${[...CONFUSABLES.keys()].join('')}]`, 'gu');

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
/** Digits on one side of a word ("kil1", "d3ad"): 1 reads as l here, unlike in LEET. */
const ONE_SIDED: Readonly<Record<string, string>> = { '0': 'o', '1': 'l', '3': 'e' };

function finish(raw: string): string {
  let t = raw
    .toLowerCase()
    .replace(APOSTROPHES, '')
    // Leetspeak only inside a word (letters on both sides), or $ / @ starting one: plain numbers
    // ("in 3 days", "score = 10") stay as they are.
    .replace(/(?<=\p{L})[013457@$!](?=\p{L})/gu, (c) => LEET[c] as string)
    .replace(/(?<![\p{L}\p{N}])[$@](?=\p{L})/gu, (c) => LEET[c] as string);
  // Single Latin letters split by spaces, dots, dashes, underscores or stars: "k i l l" → "kill".
  t = t.replace(
    new RegExp(`(?<![\\p{L}\\p{M}])[a-z](?:${SPACED_SEPARATORS}+[a-z](?![\\p{L}\\p{M}])){2,}`, 'gu'),
    (m) => m.replace(/[^a-z]/g, ''),
  );
  // Punctuation and symbols (emoji included) become spaces; "/" stays for "w/o".
  return t
    .replace(/[^\p{L}\p{M}\p{N}\s/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Digit words ("want 2 die") and digits on one side of a word ("kil1"). */
function digitWords(t: string): string {
  return t
    .replace(/(?<![\p{L}\p{N}])2(?![\p{L}\p{N}])/gu, 'to')
    .replace(/(?<=\p{L})2(?=\p{L})/gu, ' to ')
    .replace(/(?<![\p{L}\p{N}])4(?![\p{L}\p{N}])/gu, 'for')
    .replace(/(?<=\p{L})[013](?!\p{N})|(?<!\p{N})[013](?=\p{L})/gu, (c) => ONE_SIDED[c] as string)
    .replace(/\s+/g, ' ');
}

/**
 * The forms of `text` the tables are matched against; the first is the plain normalised text.
 * Others: format characters read as spaces, a capital I after a lowercase letter read as l,
 * digit words, and runs of 3+ identical Latin letters squashed to two and to one. Exported for
 * tests.
 */
export function normaliseForDistress(text: string): string[] {
  const base = text
    .normalize('NFKD')
    .replace(LATIN_MARKS, '')
    .normalize('NFC')
    .replace(NUKTA, '')
    .replace(CHANDRABINDU, cp(0x902))
    .replace(CONFUSABLE_RE, (c) => CONFUSABLES.get(c) as string);
  const pre = [base.replace(/\p{Cf}/gu, ''), base.replace(/\p{Cf}/gu, ' ')];
  pre.push(...pre.map((p) => p.replace(/(?<=\p{Ll})I/gu, 'l')));
  const forms: string[] = [];
  for (const p of pre) {
    const t = finish(p);
    forms.push(t, digitWords(t));
  }
  for (const f of [...forms]) {
    forms.push(f.replace(/([a-z])\1{2,}/g, '$1$1'), f.replace(/([a-z])\1{2,}/g, '$1'));
  }
  return [...new Set(forms)];
}

/** The strongest keyword level in `text`, from every language table. */
export function distressKeywordMatch(text: string): DistressKeywordMatch {
  const forms = normaliseForDistress(text);
  const hits = (re: RegExp) => forms.some((f) => re.test(f));
  const hard = HARD.filter((e) => hits(e.re));
  const compact = forms.some((f) => f.split(' ').some((w) => COMPACT.test(w)));
  const game = hits(GAME);
  const softHit = SOFT.filter((e) => hits(e.re));
  let soft = softHit.length;
  const has = (f: SoftFamily) => softHit.some((e) => e.family === f);
  // (a) a method plus any other soft phrase; (b) vanishing plus hopelessness.
  const combination = (has('method') && soft >= 2) || (has('vanish') && has('hopeless'));
  if (!game && (hard.length > 0 || compact || combination)) {
    const kind = hard.length > 0 && hard.every((e) => e.kind === 'abuse') ? 'abuse' : 'distress';
    return { level: 'hard', kind, softHits: soft };
  }
  if (hard.length > 0 || compact) soft++;
  return { level: soft > 0 ? 'soft' : 'none', kind: 'distress', softHits: soft };
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

/** Hard or soft: for the runner when preGuard failed and there is no classifier verdict. */
export function hasAnyDistressKeyword(text: string): boolean {
  return distressKeywordLevel(text) !== 'none';
}
