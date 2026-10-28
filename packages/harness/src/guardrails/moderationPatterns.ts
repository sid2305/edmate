// The moderationIn rule table (task 4.4). Pure, no model call. Built in, not locale-pack data
// (LocalePack has no keyword field; same precedent as 4.2 and 4.3).
//
// - Phrase-level patterns only (lead answer 9): a word like "kill", "bomb", "hate" or "nafrat" on
//   its own never hits, so "kill my program", "I bombed my quiz" or "ValueError se nafrat" pass.
// - Decisive rules block on their own; ambiguous rules only flag the message for the classifier
//   (fix round HIGH 1), so everyday text that shares words with a rule ("write my test cases",
//   "usne mujhe dhamki di") never costs the student a block or a safety event by rule.
// - Coding context is exempt: gun or weapon words next to game words ("a gun game in unity"),
//   "explicit content-type header", "threat model".
// - Every table (English, romanised Hindi, Devanagari) runs on every message whatever `lang` is.
// - The table also reads decoded payloads and the ROT13 and backwards readings (lead answer 5).
// - Self-harm is told apart first (lead answer 1): harm aimed at the self returns `self_harm`,
//   which moderationIn escalates through the distress path, never blocks. "cut myself some slack"
//   is not harm (fix round MEDIUM 3).
// - Sexual content with a minor marker in the message or the recent turns ("im 15", "14 year
//   olds", "from my school") is `sexual_minors`.
import type { SafetyEventCode } from '@edmate/contracts';
import {
  anyForm,
  firstRuleHit,
  formsOf,
  gap,
  phrase,
  type Rule,
  ruleFor,
  type RuleHit,
  scanTexts,
  SELF,
} from './rulePhrases.js';

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

const decisive = ruleFor<ModerationCode>(true);
const ambiguous = ruleFor<ModerationCode>(false);

const HARM_VERB = '(?:hurt|harm|injure|beat up|attack|poison|stab|punch|kill|murder|suffer)';
const OTHER_PERSON =
  '(?:him|her|them|someone|somebody|a person|people|my (?:classmate|brother|sister|teacher|friend|' +
  'neighbou?r|cousin|bully|roommate|room mate|flatmate|boss|dad|father|mom|mother|ex|boyfriend|' +
  'girlfriend|stepdad)|(?:the|that|this|a) (?:kid|boy|girl|guy|bully|teacher|classmate|man|woman))';
const GROUP =
  '(?:religion|religions|caste|castes|community|communities|race|races|muslims?|hindus?|christians?|' +
  'sikhs?|jews?|dalits?|disabled|gay|gays|lgbt\\S*|black people|tribals?|minorities|minority)';
/** Words that make weapon talk about code ("a gun game in unity"), not a weapon. */
const GAME =
  '(?:game|games|unity|godot|unreal|roblox|pygame|sprite|sprites|minecraft|fortnite|asset|assets|' +
  'animation|simulator|simulation|level|mod|class|object|3d|player|enemy|enemies|shooter)';
/** Nouns after "explicit", "adult" and so on that are about code or data, not content. */
const NOT_CONTENT =
  '(?:type|types|header|headers|policy|rating|filter|filters|flag|warning|cast|conversion)';
const SEX_ADJ =
  '(?:explicit|adult|erotic|sexual|sexy|dirty|nsfw|porn\\S*|xxx|smut\\S*|lewd|steamy)';
const SEX_NOUN =
  '(?:story|stories|content|roleplay|role play|fanfic|fan fiction|chat|scene|scenes|pics?|pictures?|' +
  'images?|videos?|photos?|kahani|kahaniyan|kahaani|novel|poem)';

const RULES: readonly Rule<ModerationCode>[] = [
  // ---- Self-harm (escalated through distress, lead answer 1) ----------------------------------
  decisive(
    'self_harm',
    `(?:blade|blades|knife|razor|compass|pills?|tablets?|poison|rope|weapon|gun)${gap(5)} ` +
      `(?:on|against|to hurt|to harm|to cut) ${SELF}`,
  ),
  decisive(
    'self_harm',
    `(?:hurt|harm|injure|cut|burn|poison|starve|punish) ${SELF}` +
      '(?! (?:some|a|an|off|short|loose|free|slack|out|in|into|up|down|back|time)(?![\\p{L}]))',
  ),
  decisive(
    'self_harm',
    '(?:khud ?ko|apne aap ko|apne ap ko|khud par|khud pe)' +
      `${gap(1)} (?:chot|hurt|nuksan|nuksaan|harm|kaat|maar|zakhmi)`,
  ),
  decisive('self_harm', '(?:खुद|अपने आप|स्वयं) (?:को|पर) (?:चोट|नुकसान|हानि|काट|मार|घायल)'),

  // ---- Sexual content (upgraded to sexual_minors with a minor marker) --------------------------
  decisive('sexual', `${SEX_ADJ}${gap(1)} ${SEX_NOUN}(?! ${NOT_CONTENT}(?![\\p{L}]))`),
  decisive('sexual', '(?:nude|nudes|naked|topless) (?:pics?|photos?|images?|videos?|selfies?)'),
  decisive('sexual', 'sex (?:chat|story|video)|(?:have|having|had|has) sex'),
  decisive(
    'sexual',
    '(?:you are|youre|ur|u r|be|act as|pretend to be|pretend youre|ban jao|bano)' +
      `${gap(1)} (?:my|meri|mera) (?:girlfriend|boyfriend|gf|bf|wife|husband|lover|crush|date|biwi)`,
  ),
  decisive(
    'sexual',
    '(?:what|things) (?:we|you and i|u and me|you and me) (?:would|will|could|can|gonna) do ' +
      '(?:alone|together in (?:bed|my room)|in bed)',
  ),
  decisive('sexual', '(?:अश्लील|सेक्सी|गंदी) (?:कहानी|कहानियां|वीडियो|फोटो|बातें|बात)'),
  decisive(
    'sexual',
    '(?:ashleel|ashlil|sexy|gandi) (?:kahani|kahaniyan|kahaani|video|photo|baatein)',
  ),
  ambiguous('sexual', 'nude|nudes|naked|porn\\S*|sexting'),

  // ---- Hate ---------------------------------------------------------------------------------------
  decisive(
    'hate',
    '(?:caste|racial|racist|religious|ethnic|homophobic|transphobic|disability|ableist) ' +
      '(?:slurs?|insults?|jokes?|abuse|memes?|gaali\\S*)',
  ),
  decisive('hate', 'slurs? (?:for|about|against|to use|i can use|to call)'),
  decisive(
    'hate',
    `(?:insults?|jokes?|memes?|slurs?|abuse|hate speech)${gap(1)} (?:about|against|on|for) ` +
      `(?:people of |the |all )?(?:a |an |any |one |some |that |this )?` +
      `(?:particular |certain |specific |other |lower )?${GROUP}`,
  ),
  decisive(
    'hate',
    `${GROUP}${gap(2)} (?:ke|ka|ki) (?:liye )?(?:gaali|gaaliyan|gaaliyon|galiyan|galiyon|gaaliya)`,
  ),
  decisive(
    'hate',
    `(?:community|jaati|jati|dharam|dharm|mazhab|religion|caste)${gap(5)} ` +
      '(?:gaali|gaaliyan|gaaliyon|galiyan|galiyon|gaaliya)',
  ),
  decisive(
    'hate',
    '(?:disabled|viklang|handicapped|apahij|andhe|langde|dalit|muslim|hindu)' +
      `${gap(2)} (?:ka|ki|ke) (?:mazaak|mazak|majak|mazaq)`,
  ),
  decisive(
    'hate',
    '(?:धर्म|जाति|मजहब|समुदाय|विकलांग|दलित)' + `${gap(3)} (?:का|की|के) (?:मजाक|गाली|गालियां)`,
  ),

  // ---- Harm to others -----------------------------------------------------------------------------
  decisive('harm_to_others', `(?:way|ways|how) to ${HARM_VERB}${gap(1)} ${OTHER_PERSON}`),
  decisive(
    'harm_to_others',
    `(?:how (?:do|can|could|should) i|help me|tell me how to|teach me how to|show me how to) ` +
      `${HARM_VERB}${gap(1)} ${OTHER_PERSON}`,
  ),
  decisive(
    'harm_to_others',
    '(?:hurt|harm|injure|beat up) (?:him|her|them) (?:so bad|so badly|badly|really bad)',
  ),
  // Item 9 (4.4d): "make <person> suffer" is a different verb shape than "<lead-in> HARM_VERB
  // <person>" above, so it needs its own row.
  decisive(
    'harm_to_others',
    `(?:how (?:do|can|could|should) i|help me|tell me how to|teach me how to|show me how to) ` +
      `make${gap(1)} ${OTHER_PERSON}${gap(2)} suffer|` +
      `(?:way|ways|how) to make${gap(1)} ${OTHER_PERSON}${gap(2)} suffer`,
  ),
  decisive(
    'harm_to_others',
    `(?:use|usko|unko|ladke ko|ladki ko|bande ko|teacher ko)${gap(4)} ` +
      '(?:hurt|chot|nuksan|nuksaan) (?:karna|karni|pahuchana|pahunchana|pahuchani|dena)',
  ),
  decisive(
    'harm_to_others',
    `(?:use|usko|unko|usse|tujhe|tumhe|ladke ko|ladki ko|teacher ko)${gap(4)} (?:maar|mar) ` +
      '(?:dalunga|daalunga|dalungi|daalungi|dunga|doonga|dungi|dalenge|daalenge)',
  ),
  // Item 11 (4.4d, unit test only): "maarun" is a different conjugation ("kaise usko maarun"),
  // not in the suffix family above. The lead-in "kaise" must come first so a stuck-loop near-miss
  // in the opposite order ("isko maarun kaise") stays clear.
  decisive(
    'harm_to_others',
    `kaise${gap(1)} (?:use|usko|unko|usse|tujhe|tumhe|ladke ko|ladki ko|teacher ko)${gap(2)} maarun`,
  ),
  decisive(
    'harm_to_others',
    `(?:उसे|उसको|उन्हें|उनको|तुझे|तुम्हें|लडके को|लडकी को)${gap(4)} (?:चोट|नुकसान) (?:पहुंचा\\S*|पहुचा\\S*)`,
  ),
  decisive(
    'harm_to_others',
    `(?:उसे|उसको|उन्हें|उनको|तुझे|तुम्हें|लडके को|लडकी को)${gap(4)} ` +
      '(?:मार डालूंगा|मार डालूंगी|मार दूंगा|मार दूंगी|मार डालेंगे|मार डालूगा)',
  ),
  ambiguous(
    'harm_to_others',
    '(?:maar|mar) (?:dalunga|daalunga|dalungi|daalungi)|मार (?:डालूंगा|डालूंगी)',
  ),

  // ---- Weapons --------------------------------------------------------------------------------------
  decisive(
    'weapons',
    `(?:make|build|making|building|create|assemble|bana|banana)${gap(3)} ` +
      '(?:bomb|bombs|pipe bomb|explosive|explosives|ied|grenade|molotov|gun|pistol|katta|weapon)',
    {
      unless: `(?:bomb|bombs|explosive|explosives|grenade|gun|guns|pistol|weapon|weapons)${gap(3)} ${GAME}`,
    },
  ),
  // The game exemption downgrades a bomb or explosive to ambiguous, never drops it (fix round 2):
  // "a pipe bomb in minecraft" is flagged for the classifier; "a gun game in unity" is no hit.
  ambiguous(
    'weapons',
    `(?:make|build|making|building|create|assemble|bana|banana)${gap(3)} ` +
      '(?:bomb|bombs|pipe bomb|explosive|explosives|ied|grenade|molotov)',
  ),
  decisive(
    'weapons',
    `(?:bomb|bum|explosive|katta|desi katta|pistol|bandook|banduk)${gap(2)} ` +
      '(?:kaise|kese) (?:banaye|banaen|banau|banate|banta|bane)',
  ),
  decisive(
    'weapons',
    '(?:bomb|bum|explosive|katta|pistol|bandook|banduk) (?:banane|banana|banaane) (?:ka|ki|ke) ' +
      '(?:tarika|tareeka|tarike|vidhi|process|formula)',
  ),
  decisive(
    'weapons',
    '(?:बम|विस्फोटक|बंदूक|कट्टा) (?:कैसे|किस तरह) (?:बनाते|बनाएं|बनाऊं|बनता|बनाया|बनाए)',
  ),
  decisive('weapons', '(?:बम|विस्फोटक|बंदूक|कट्टा) बनाने (?:का|की) (?:तरीका|विधि)'),
  decisive(
    'weapons',
    `(?:sneak|smuggle|bring|carry|hide|take)${gap(2)} (?:a |my )?(?:knife|gun|weapon|blade|pistol)` +
      `${gap(2)} (?:into|to|in|at) (?:the |my |our )?(?:school|class|college)`,
  ),
  decisive(
    'weapons',
    `(?:hathiyar|hathyar|chaku|chaaku|chaakoo|knife|gun|pistol|katta|bandook)${gap(4)} ` +
      '(?:chhupa|chupa|chhupake|chupake|le ja|le jaane|le jane|le jau)',
  ),
  // Fail-closed by design (7.2l decision log): a factual/news-style past-tense sentence
  // ("चोर चाकू ले गया") blocks too, same as a real admission — telling the two
  // apart needs subject/person detection this phrase table doesn't do, and that's
  // disproportionate before real Devanagari traffic exists (Devanagari is a safety-net table
  // during the English-only, US-first pilot). Don't "fix" this over-block without reopening
  // that decision.
  decisive(
    'weapons',
    '(?:हथियार|चाकू|बंदूक|बम)' +
      `${gap(4)} (?:छुपाया|छुपाई|छिपाया|छिपाई|ले गया|ले गई|छुपा|छिपा|ले जा)`,
  ),
  // 7.2k: infinitives (new verb लाना, plus छुपाना/छिपाना/ले जाना) need an adjacent intent/need
  // marker, directly after the infinitive, or an essay-style "X karna illegal hai" question would
  // match too (same reasoning as the vapes rule below).
  decisive(
    'weapons',
    '(?:हथियार|चाकू|बंदूक|बम)' +
      `${gap(4)} (?:लाना|छुपाना|छिपाना|ले जाना) ` +
      '(?:है|हूँ|हूं|चाहता|चाहती|चाहिए|पड़ेगा|पड़ेगी)',
  ),

  // ---- Threats --------------------------------------------------------------------------------------
  decisive(
    'threat',
    'threatening (?:message|msg|text|note|letter|dm|post|email|mail|voice note)|' +
      `threat (?:message|letter|note)|(?:write|send|make)${gap(3)} (?:a )?threat` +
      '(?! (?:model|models|modeling|modelling|matrix|assessment|analysis|actor|actors|intelligence|' +
      'vector|vectors|landscape|detection|hunting|report|level|surface)(?![\\p{L}]))',
  ),
  decisive(
    'threat',
    'dhamki (?:wala|wali|bhara|bhari|de do|dedo|dena|bhej\\S*|likh\\S*)|' +
      `(?:likh|bhej)\\S*${gap(2)} dhamki`,
  ),
  decisive('threat', `धमकी (?:भरा|भरी|वाला|वाली)|धमकी${gap(2)} (?:भेज|लिख|दे दो)`),
  ambiguous('threat', 'dhamki\\S*|dhamkee|dhamaki|धमकी'),

  // ---- Harassment -----------------------------------------------------------------------------------
  decisive(
    'harassment',
    '(?:mean|nasty|cruel|embarrassing|humiliating|insulting|savage|roast)' +
      ' (?:post|message|comment|caption|meme|tweet|story|joke|jokes|status|reel)' +
      `${gap(3)} (?:about|on|for|to) (?:a |the |this |that |my )?` +
      '(?:girl|boy|kid|classmate|friend|teacher|student|guy|person|him|her)',
  ),
  decisive(
    'harassment',
    `(?:fake|morphed|edited|photoshopped)${gap(2)} (?:photo|pic|picture|image|video|nude|nudes)` +
      `${gap(4)} (?:of|about) (?:my |a |the |this |that )?` +
      '(?:teacher|classmate|friend|girl|boy|sir|maam|madam|principal|someone|him|her)',
  ),
  decisive(
    'harassment',
    `(?:fake|false|spread|spreading|start|starting)${gap(1)} (?:a )?rumou?rs?`,
  ),
  decisive(
    'harassment',
    '(?:jhoothi|jhuthi|jhooti|jhuti) (?:afwah|afwaah|khabar)|afwah (?:faila|failao)',
  ),
  decisive('harassment', '(?:झूठी|झूठा|झूठे) (?:अफवाह|खबर)|अफवाह (?:फैला|वाला|वाली)'),
  decisive(
    'harassment',
    `(?:classmate|dost|friend|ladki|ladke|ladka|teacher|bhai|behen)${gap(2)} (?:ka|ki|ke) ` +
      '(?:mazaak|mazak|majak|mazaq) (?:udaane|udane|udana|udao|uda)',
  ),
  ambiguous('harassment', 'deepfake\\S*|rumou?rs? about'),
  ambiguous(
    'harassment',
    'so (?:everyone|everybody|the whole class|they all|all of them) (?:laughs?|laugh at)',
  ),

  // ---- Cheating -------------------------------------------------------------------------------------
  decisive(
    'cheating',
    `(?:submit|turn in|hand in|pass off)${gap(3)} (?:as|under) (?:mine|my own|my name)`,
  ),
  decisive('cheating', `pay you${gap(2)} (?:to|if you) (?:write|do|take|solve|complete)`),
  decisive(
    'cheating',
    '(?:take|attend|sit|give|write|do) my (?:\\S+ ){0,2}(?:exam|test|quiz|paper) for me',
  ),
  decisive(
    'cheating',
    `(?:test|exam|paper|assignment|homework)${gap(2)} (?:de|likh|kar|bana|solve kar) ` +
      '(?:do|dena|dijiye|de) (?:mere|meri) (?:liye|jagah|badle)',
  ),
  decisive('cheating', 'answers? copy kar'),
  decisive('cheating', 'अपने नाम से (?:जमा|सबमिट)'),
  decisive(
    'cheating',
    '(?:पूरा|पूरी|सारा) (?:असाइनमेंट|पेपर|होमवर्क|टेस्ट) (?:लिख|कर|बना) (?:दो|दीजिए|देना)',
  ),
  ambiguous(
    'cheating',
    '(?:write|do|solve|complete|finish) my (?:\\S+ ){0,3}(?:exam|test|assignment|quiz|paper)' +
      '(?! (?:cases?|suite|suites|file|files|script|scripts|code|data|runner|plan|function|functions|' +
      'topic|prep|syllabus|question|date)(?![\\p{L}]))',
  ),

  // ---- Extremism -------------------------------------------------------------------------------------
  decisive(
    'extremism',
    `(?:join|joining|become|support|recruit\\S*)${gap(2)} (?:isis|al qaeda|alqaeda|taliban|jihadi\\S*|terrorists?)|` +
      `(?:plan|planning|carry out)${gap(2)} (?:terror|terrorist) attack`,
  ),

  // ---- Other unsafe -----------------------------------------------------------------------------------
  decisive('other_unsafe', `(?:make|cook|synthesi[sz]e)${gap(2)} (?:meth|cocaine|heroin|mdma|lsd)`),
  // Buying or selling vapes at school: the transaction verb requirement (not an `unless`
  // exemption) keeps a vape-detector science project or a health-class essay on vaping risks
  // from ever matching (7.2h).
  decisive(
    'other_unsafe',
    `(?:buy|buying|get|getting|sell|selling|resell|reselling|trade|trading)${gap(2)} ` +
      `(?:vapes?|vaping|juul\\S*)${gap(3)} (?:at|in|into|near|on) (?:the |my |our )?` +
      '(?:school|class|campus|college)',
  ),
  // Hinglish variant (7.2i, code-reviewer MEDIUM on 7.2h): a vape word and a school word near a
  // transaction verb, in either order, bounded (not unbounded) with the existing gap helper.
  decisive(
    'other_unsafe',
    `(?:school|class|college|campus)(?: (?:mein|me|main|pe|par))?${gap(3)} ` +
      `(?:vapes?|vaping|juul\\S*)${gap(3)} (?:bech\\S*|bik\\S*|khareed\\S*|kharid\\S*|le\\S* aa\\S*|` +
      'mang\\S*|supply)|' +
      `(?:vapes?|vaping|juul\\S*)${gap(3)} (?:bech\\S*|bik\\S*|khareed\\S*|kharid\\S*|le\\S* aa\\S*|` +
      `mang\\S*|supply)${gap(3)} (?:school|class|college|campus)(?: (?:mein|me|main|pe|par))?`,
  ),
  // Devanagari variant, same style as the weapons Devanagari rule: no school word required.
  // Fail-closed by design (7.2l decision log): same reasoning as the weapons conceal rule above
  // — a factual/news-style past-tense sentence blocks too rather than risk under-blocking a
  // genuine disclosure. Don't "fix" this over-block without reopening that decision.
  decisive(
    'other_unsafe',
    '(?:वेप|वेप्स|वेपिंग)' + `${gap(4)} (?:बेचा|बेची|खरीदा|खरीदी|बिकता|बिकती|बेच|बिक|खरीद)`,
  ),
  // 7.2k: infinitives need an adjacent intent/need marker, directly after the infinitive, so an
  // essay-style question such as "वेप बेचना गैरकानूनी क्यों है" (an infinitive followed by an
  // adjective, not an intent marker) stays clean while "स्कूल में वेप बेचना है" still blocks.
  decisive(
    'other_unsafe',
    '(?:वेप|वेप्स|वेपिंग)' +
      `${gap(4)} (?:बेचना|बेचूँ|बेचूंगा|बेचूंगी|खरीदना|खरीदूँगा|खरीदूंगी|बिकना) ` +
      '(?:है|हूँ|हूं|चाहता|चाहती|चाहिए|पड़ेगा|पड़ेगी)',
  ),
  ambiguous(
    'other_unsafe',
    `(?:buy|get|order)${gap(2)} (?:meth|cocaine|heroin|mdma|lsd|charas|ganja|drugs)`,
  ),
  ambiguous(
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

/**
 * The moderation rule hit for `text`, or null: decisive hits before ambiguous ones, the message
 * before what an encoding hides. `context` is the student's last few messages (scrubbed), read
 * only for a minor marker: a hit always comes from this message.
 */
export function matchModeration(
  text: string,
  context: readonly string[] = [],
): RuleHit<ModerationCode> | null {
  const s = scanTexts(text);
  const all = [s.forms, ...s.hidden.map((h) => h.forms)];
  let hit: RuleHit<ModerationCode> | null = null;
  for (const decisiveOnly of [true, false]) {
    for (const forms of all) {
      const h = firstRuleHit(RULES, forms);
      if (h !== null && (h.decisive || !decisiveOnly)) {
        hit = h;
        break;
      }
    }
    if (hit !== null) break;
  }
  if (hit?.code !== 'sexual') return hit;
  const marked = [...all, ...context.map(formsOf)].some((f) => anyForm(f, MINOR));
  return marked ? { ...hit, code: 'sexual_minors' } : hit;
}
