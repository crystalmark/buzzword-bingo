// Keeping it safe for work. Player names and the words on a custom card are the free text other players see, and
// game codes are four random consonants, so those are what's checked here. This file is shared with the page, which
// checks custom words as they're added; the Lambda checks everything again.
//
// Names: rude words are caught through the usual disguises (w@nk3r, w.a.n.k, w a n k, waaank, f**k), but real names
// with rude letters inside them — Dickens, Hancock, Cockburn, Scunthorpe, Dikshit, Swankie, Cumberbatch — get through,
// because most words only count as a whole word (with the endings listed), and the few that count anywhere skip the
// known innocent spellings. test/moderation.test.mjs holds both lists: add to it whenever something slips through or
// someone real is refused.

// Count wherever they appear, even inside a longer word ("BigWankerDave")
const ANYWHERE = ['fuck', 'wank', 'cunt', 'nigger', 'nigga', 'faggot', 'bollock', 'dildo', 'blowjob', 'bullshit',
  'motherf', 'dickhead', 'shithead', 'twat', 'arsehole', 'asshole', 'knobhead', 'cocksuck'];
// Innocent words that contain one of those: removed before looking
const INNOCENT = ['scunth', 'swank', 'wankel'];

// Count only as a whole word, with these endings. Dick, Dicks and Cocks are surnames, so they aren't here.
const WHOLE = [
  'shit(e|es|s|ty|ting|face|hole|bag)?', 'cock', 'cocky', 'dick(face|wad)', 'bellends?', 'pricks?', 'knob(s|end|ends)?',
  'arse(s|d)?', 'ass(hat|wipe)', 'piss(ed|er|y|flaps)?', 'tits?', 'titties', 'slags?', 'sluts?', 'slutty', 'whores?',
  'bitch(es|y)?', 'bastards?', 'tossers?', 'spunk', 'jizz', 'shag(s|ger|ging|ged)?', 'minge', 'porno?', 'cum',
  'penis(es)?', 'vagina', 'fags?', 'paki(s)?', 'spaz', 'spastics?', 'retard(s|ed)?', 'kikes?', 'chinks?', 'wogs?',
  'gooks?', 'tranny', 'nonces?', 'bollocks', 'fck', 'fk', 'stfu', 'wtf',
];

const LEET = { '@': 'a', 4: 'a', 3: 'e', 1: 'i', '!': 'i', '|': 'i', 0: 'o', 5: 's', $: 's', 7: 't', 8: 'b' };

// Each letter may be repeated ("waaank") or starred out ("f*ck", "f**k")
const loose = word => word.split('').map(c => (c === '(' || c === ')' || c === '?' || c === '|' ? c : `[${c}*]+`)).join('');
const ANYWHERE_RE = new RegExp(ANYWHERE.map(loose).join('|'));
// (an optional letter, like the s of "bastards?", stays optional)
const WHOLE_RE = new RegExp(`^(?:${WHOLE.map(w => w.replace(/([a-z])(\?)?/g, (_, c, opt) => `[${c}*]${opt ? '*' : '+'}`)).join('|')})$`);

// The ways a name might spell something: each word on its own, with dots and dashes inside it dropped ("w.a.n.k"), and
// runs of single letters joined up ("w a n k")
function readings(name) {
  const plain = String(name).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[@431!|05$78]/g, c => LEET[c]);
  const words = plain.split(/\s+/).map(w => w.replace(/[^a-z*]/g, '')).filter(Boolean);
  const out = [...words];
  let run = '';
  for (const w of [...words, '']) {
    if (w.length === 1) { run += w; continue; }
    if (run.length > 1) out.push(run);
    run = '';
  }
  return out;
}

const swears = w => ANYWHERE_RE.test(INNOCENT.reduce((s, ok) => s.replaceAll(ok, '-'), w));

export const rudeName = name => readings(name).some(w => swears(w) || WHOLE_RE.test(w));

// A word for a custom card, taken from someone's own slides. Medical and science talks are full of words the name check
// refuses (penis, vagina, finger prick, spastic paraplegia), so only swearing and slurs are refused here.
const SLUR_RE = new RegExp(`^(?:${['fags?', 'paki(s)?', 'spaz', 'kikes?', 'chinks?', 'wogs?', 'gooks?', 'tranny', 'retards?']
  .map(w => w.replace(/([a-z])(\?)?/g, (_, c, opt) => `[${c}*]${opt ? '*' : '+'}`)).join('|')})$`);
export const rudeWord = word => readings(word).some(w => swears(w) || SLUR_RE.test(w));

// Letter runs that read as rude even without vowels. A code containing one is never handed out.
const RUDE_CODE = ['WNK', 'FCK', 'FK', 'CNT', 'KNT', 'SHT', 'TWT', 'CCK', 'KCK', 'DCK', 'DK', 'PRK', 'PSS', 'KNB',
  'SHG', 'BLX', 'WTF', 'FFS', 'SX', 'XXX', 'NGR', 'NGG', 'FGT', 'JZZ', 'KKK', 'TTS', 'PNS', 'CM', 'SLT', 'WHR', 'BTCH'];

export const rudeCode = code => RUDE_CODE.some(r => code.includes(r));
