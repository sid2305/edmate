// The moderationIn rule table (task 4.4). Pure, no model call. Built in, not locale-pack data
// (LocalePack has no keyword field; same precedent as 4.2 and 4.3).
//
// - Phrase-level patterns only (lead answer 9): a word like "kill", "bomb", "hate" or "nafrat" on
//   its own never hits, so "kill my program", "I bombed my quiz" or "ValueError se nafrat" pass.
// - Every table (English, romanised Hindi, Devanagari) runs on every message whatever `lang` is.
// - The table also reads decoded payloads and the ROT13 and backwards readings (lead answer 5).
// - Self-harm is told apart first (lead answer 1): harm aimed at the self returns `self_harm`,
//   which moderationIn escalates through the distress path, never blocks.
// - Sexual content with a minor marker in the message or the recent turns ("im 15", "14 year
//   olds", "from my school") is `sexual_minors`.
import type { SafetyEventCode } from '@edmate/contracts';
import { anyForm, formsOf, gap, phrase, scanTexts, SELF } from './rulePhrases.js';

/** The moderation part of the safety-event codes. */
export type ModerationCode = Exclude<SafetyEventCode, `jailbreak_${string}`>;

/** The codes the moderation classifier may answer, besides `none`. */
export const MODERATION_CODES = [
  'self_harm',
  'harm_to_others',
  'sexual',
  'sexual_minors',
  'hate',
  'harassment',
  'threat',
  'weapons',
  'extremism',
  'cheating',
  'other_unsafe',
] as const satisfies readonly ModerationCode[];

interface Rule {
  code: ModerationCode;
  re: RegExp;
}
const rule = (code: ModerationCode, src: string): Rule => ({ code, re: phrase(src) });

const OTHER_PERSON =
  '(?:him|her|them|someone|somebody|a person|people|my (?:classmate|brother|sister|teacher|friend|' +
  'neighbou?r|cousin|bully)|(?:the|that|this|a) (?:kid|boy|girl|guy|bully|teacher|classmate|man|woman))';
const GROUP =
  '(?:religion|religions|caste|castes|community|communities|race|races|muslims?|hindus?|christians?|' +
  'sikhs?|jews?|dalits?|disabled|gay|gays|lgbt\\S*|black people|tribals?|minorities|minority)';

const RULES: readonly Rule[] = [
  // ---- Self-harm (escalated through distress, lead answer 1) ----------------------------------
  rule(
    'self_harm',
    `(?:blade|blades|knife|razor|compass|pills?|tablets?|poison|rope|weapon|gun)${gap(5)} ` +
      `(?:on|against|for|to hurt|to harm|to cut) ${SELF}`,
  ),
  rule('self_harm', `(?:hurt|harm|injure|cut|burn|poison|kill|starve|punish)${gap(1)} ${SELF}`),
  rule(
    'self_harm',
    '(?:khud ?ko|apne aap ko|apne ap ko|khud par|khud pe)' +
      `${gap(1)} (?:chot|hurt|nuksan|nuksaan|harm|kaat|maar|zakhmi)`,
  ),
  rule('self_harm', '(?:खुद|अपने आप|स्वयं) (?:को|पर) (?:चोट|नुकसान|हानि|काट|मार|घायल)'),

  // ---- Sexual content (upgraded to sexual_minors with a minor marker) --------------------------
  rule(
    'sexual',
    '(?:explicit|adult|erotic|sexual|sexy|dirty|nsfw|porn\\S*|xxx|smut\\S*|lewd|steamy|18)' +
      `${gap(1)} (?:story|stories|content|roleplay|role play|fanfic|fan fiction|chat|scene|scenes|` +
      'pics?|pictures?|images?|videos?|photos?|kahani|kahaniyan|kahaani|novel|poem)',
  ),
  rule('sexual', '(?:nude|nudes|naked|topless)(?: (?:pics?|photos?|images?|videos?|selfies?))?'),
  rule('sexual', 'porn\\S*|sex (?:chat|story|video)|sexting'),
  rule(
    'sexual',
    '(?:you are|youre|ur|u r|be|act as|pretend to be|pretend youre|ban jao|bano)' +
      `${gap(1)} (?:my|meri|mera) (?:girlfriend|boyfriend|gf|bf|wife|husband|lover|crush|date|biwi)`,
  ),
  rule(
    'sexual',
    '(?:what|things) (?:we|you and i|u and me|you and me) (?:would|will|could|can|gonna) do ' +
      '(?:alone|together in (?:bed|my room)|in bed)',
  ),
  rule('sexual', '(?:अश्लील|सेक्सी|गंदी) (?:कहानी|कहानियां|वीडियो|फोटो|बातें|बात)'),
  rule('sexual', '(?:ashleel|ashlil|sexy|gandi) (?:kahani|kahaniyan|kahaani|video|photo|baatein)'),

  // ---- Hate ---------------------------------------------------------------------------------------
  rule(
    'hate',
    '(?:caste|racial|racist|religious|ethnic|homophobic|transphobic|disability|ableist) ' +
      '(?:slurs?|insults?|jokes?|abuse|memes?|gaali\\S*)',
  ),
  rule('hate', 'slurs? (?:for|about|against|to use|i can use|to call)'),
  rule(
    'hate',
    `(?:insults?|jokes?|memes?|slurs?|abuse|hate speech)${gap(1)} (?:about|against|on|for) ` +
      `(?:people of |the |all )?(?:a |an |any |one |some |that |this )?` +
      `(?:particular |certain |specific |other |lower )?${GROUP}`,
  ),
  rule(
    'hate',
    `${GROUP}${gap(2)} (?:ke|ka|ki) (?:liye )?(?:gaali|gaaliyan|gaaliyon|galiyan|galiyon|gaaliya)`,
  ),
  rule(
    'hate',
    `(?:community|jaati|jati|dharam|dharm|mazhab|religion|caste)${gap(5)} ` +
      '(?:gaali|gaaliyan|gaaliyon|galiyan|galiyon|gaaliya)',
  ),
  rule(
    'hate',
    '(?:disabled|viklang|handicapped|apahij|andhe|langde|dalit|muslim|hindu)' +
      `${gap(2)} (?:ka|ki|ke) (?:mazaak|mazak|majak|mazaq)`,
  ),
  rule(
    'hate',
    '(?:धर्म|जाति|मजहब|समुदाय|विकलांग|दलित)' + `${gap(3)} (?:का|की|के) (?:मजाक|गाली|गालियां)`,
  ),

  // ---- Harm to others ---------------------------------------------------------------------------
  rule(
    'harm_to_others',
    '(?:way|ways|how) to (?:hurt|harm|injure|beat up|attack|poison|stab|punch|kill|break the (?:arm|leg|nose) of)' +
      `${gap(1)} ${OTHER_PERSON}`,
  ),
  rule(
    'harm_to_others',
    '(?:hurt|harm|injure|beat up) (?:him|her|them) (?:so bad|so badly|badly|really bad)',
  ),
  rule(
    'harm_to_others',
    `(?:use|usko|unko|ladke ko|ladki ko|bande ko|teacher ko)${gap(4)} ` +
      '(?:hurt|chot|nuksan|nuksaan) (?:karna|karni|pahuchana|pahunchana|pahuchani|dena)',
  ),
  rule(
    'harm_to_others',
    `(?:उसे|उसको|उन्हें|उनको|लडके को|लडकी को)${gap(3)} (?:चोट|नुकसान) (?:पहुंचा\\S*|पहुचा\\S*)`,
  ),

  // ---- Weapons --------------------------------------------------------------------------------------
  rule(
    'weapons',
    `(?:make|build|making|building|create|assemble|bana|banana)${gap(3)} ` +
      '(?:bomb|bombs|pipe bomb|explosive|explosives|ied|grenade|molotov|gun|pistol|katta)',
  ),
  rule(
    'weapons',
    `(?:bomb|bum|explosive|katta|desi katta|pistol|bandook|banduk)${gap(2)} ` +
      '(?:kaise|kese) (?:banaye|banaen|banau|banate|banta|bane)',
  ),
  rule(
    'weapons',
    `(?:sneak|smuggle|bring|carry|hide|take)${gap(2)} (?:a |my )?(?:knife|gun|weapon|blade|pistol)` +
      `${gap(2)} (?:into|to|in|at) (?:school|class|college)`,
  ),
  rule(
    'weapons',
    `(?:hathiyar|hathyar|chaku|chaaku|chaakoo|knife|gun|pistol|katta|bandook)${gap(4)} ` +
      '(?:chhupa|chupa|chhupake|chupake|le ja|le jaane|le jane|le jau)',
  ),
  rule('weapons', '(?:हथियार|चाकू|बंदूक|बम)' + `${gap(4)} (?:छुपा|छिपा|ले जा|बना)`),

  // ---- Threats --------------------------------------------------------------------------------------
  rule(
    'threat',
    'threatening (?:message|msg|text|note|letter|dm|post|email|mail|voice note)|' +
      `threat (?:message|letter|note)|(?:write|send|make)${gap(3)} (?:a )?threat`,
  ),
  rule('threat', 'dhamki\\S*|dhamkee|dhamaki'),
  rule('threat', 'धमकी'),

  // ---- Harassment -----------------------------------------------------------------------------------
  rule(
    'harassment',
    '(?:mean|nasty|cruel|embarrassing|humiliating|insulting|savage|roast)' +
      ' (?:post|message|comment|caption|meme|tweet|story|joke|jokes|status|reel)' +
      `${gap(3)} (?:about|on|for|to) (?:a |the |this |that |my )?` +
      '(?:girl|boy|kid|classmate|friend|teacher|student|guy|person|him|her)',
  ),
  rule(
    'harassment',
    'so (?:everyone|everybody|the whole class|they all|all of them) (?:laughs?|laugh at)',
  ),
  rule(
    'harassment',
    `(?:fake|morphed|edited|photoshopped)${gap(2)} (?:photo|pic|picture|image|video|nude|nudes)` +
      `${gap(4)} (?:of|about) (?:my |a |the |this |that )?` +
      '(?:teacher|classmate|friend|girl|boy|sir|maam|madam|principal|someone|him|her)',
  ),
  rule('harassment', 'deepfake\\S*'),
  rule(
    'harassment',
    `(?:fake|false|spread|spreading|start|starting)${gap(1)} (?:a )?rumou?rs?|rumou?rs? about`,
  ),
  rule(
    'harassment',
    '(?:jhoothi|jhuthi|jhooti|jhuti) (?:afwah|afwaah|khabar)|afwah (?:faila|failao)',
  ),
  rule('harassment', '(?:झूठी|झूठा|झूठे) (?:अफवाह|खबर)|अफवाह (?:फैला|वाला|वाली)'),
  rule(
    'harassment',
    `(?:classmate|dost|friend|ladki|ladke|ladka|teacher|bhai|behen)${gap(2)} (?:ka|ki|ke) ` +
      '(?:mazaak|mazak|majak|mazaq) (?:udaane|udane|udana|udao|uda)',
  ),

  // ---- Cheating -------------------------------------------------------------------------------------
  rule(
    'cheating',
    `(?:submit|turn in|hand in|pass off)${gap(3)} (?:as|under) (?:mine|my own|my name)`,
  ),
  rule(
    'cheating',
    '(?:write|do|take|solve|complete|finish) my (?:\\S+ ){0,3}(?:exam|test|assignment|quiz|paper)' +
      '(?: answers?)?(?: for me)?(?! (?:topic|prep|syllabus|question|date))',
  ),
  rule('cheating', `pay you${gap(2)} (?:to|if you) (?:write|do|take|solve|complete)`),
  rule(
    'cheating',
    `(?:test|exam|paper|assignment|homework)${gap(2)} (?:de|likh|kar|bana|solve kar) ` +
      '(?:do|dena|dijiye|de) (?:mere|meri) (?:liye|jagah|badle)',
  ),
  rule('cheating', 'answers? copy kar'),
  rule('cheating', 'अपने नाम से (?:जमा|सबमिट)'),
  rule(
    'cheating',
    '(?:पूरा|पूरी|सारा) (?:असाइनमेंट|पेपर|होमवर्क|टेस्ट) (?:लिख|कर|बना) (?:दो|दीजिए|देना)',
  ),

  // ---- Extremism -------------------------------------------------------------------------------------
  rule(
    'extremism',
    `(?:join|joining|become|support|recruit\\S*)${gap(2)} (?:isis|al qaeda|alqaeda|taliban|jihadi\\S*|terrorists?)|` +
      `(?:plan|planning|carry out)${gap(2)} (?:terror|terrorist) attack`,
  ),

  // ---- Other unsafe -----------------------------------------------------------------------------------
  rule(
    'other_unsafe',
    `(?:make|cook|buy|get|order)${gap(2)} (?:meth|cocaine|heroin|mdma|lsd|charas|ganja|drugs)`,
  ),
  rule(
    'other_unsafe',
    `hack${gap(3)} (?:account|instagram|insta|email|whatsapp|portal|password|phone|facebook)`,
  ),
];

/** Age 10 to 17, a class or school, or a child: sexual content about them is `sexual_minors`. */
const MINOR = phrase(
  '(?:[0-9]|1[0-7]) ?(?:year|yr|saal)s? ?olds?|(?:im|i am|main|mai) 1[0-7]|aged? 1[0-7]|' +
    'minors?|underage|kids?|child|children|teen\\S*|(?:my|our|the) (?:school|class)|classmates?|' +
    'bachch\\S*|बच्च\\S*|नाबालिग',
);

/** The first rule that hits any of `forms`, by table order. */
function firstHit(forms: readonly string[]): ModerationCode | null {
  for (const r of RULES) if (anyForm(forms, r.re)) return r.code;
  return null;
}

/**
 * The moderation code a rule gives `text`, or null. `context` is the student's last few messages
 * (scrubbed), read only for a minor marker: a hit always comes from this message.
 */
export function matchModeration(
  text: string,
  context: readonly string[] = [],
): ModerationCode | null {
  const s = scanTexts(text);
  let code = firstHit(s.forms);
  for (const h of s.hidden) code ??= firstHit(h.forms);
  if (code !== 'sexual') return code;
  const marked = [s.forms, ...s.hidden.map((h) => h.forms), ...context.map(formsOf)].some((f) =>
    anyForm(f, MINOR),
  );
  return marked ? 'sexual_minors' : 'sexual';
}
