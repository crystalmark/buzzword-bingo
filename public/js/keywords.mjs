// Picking buzzwords out of a document's text (segments from extract.mjs), in the browser.
// Phrases are runs of up to three meaningful words, broken at punctuation and at everyday words ("the", "of", "using",
// "slide"); each counts once per time it appears, titles and headings three times. Phrases beat single words, and a word
// that mostly appears inside a longer phrase gives way to it ("insulin" to "insulin resistance"). Acronyms and terms
// like HbA1c count even if they're short. What comes back is ranked, best first; the page offers the top of the list
// and keeps the rest as suggestions.

const STOP = new Set(`
a about above after again against all almost also although always am among an and another any anyone anything are
around as at away back be because been before being below between both but by can cannot could did do does doing done
down during each either else enough etc even ever every everything few for from further get gets getting give given go
goes going gone got had has have having he her here hers him his how however i if in including into is it its itself
just keep last least less let like likely made make makes making many may maybe me might more most much must my need
needs neither never next no nor not nothing now of off often on once one only onto or other others otherwise our ours
out over own per perhaps put quite rather really same see seen several shall she should since so some something
sometimes still such than that the their theirs them then there therefore these they thing things this those though
through thus to too toward towards under until up upon us use used uses using usually various very via want was way
ways we well were what whatever when where whether which while who whom whose why will with within without would yes
yet you your yours
able across already ask asked based become becomes best better come comes considered different e.g eg i.e ie example
examples find found first good great help helps important include includes included know known look looks lot lots
mean means new number numbers part parts people person point points provide provided second say says said set show
shows shown take takes tell third think time times today try two three four five year years month months week weeks
day days
slide slides click presentation agenda overview introduction summary conclusion conclusions question questions
thank thanks page pages figure fig table chart source sources reference references notes note www http https com
org uk html pdf vs versus approx dr mr mrs ms prof
matter matters drive drives driving update updates updated reduce reduces reduced reducing start starts started
starting affect affects affected achieve achieves achieved carry carries carried change changes changed agree agreed
mention remind everyone someone real early late high higher low lower big small large larger smaller main major minor
old certain clear simple easy hard possible likely unlikely available required require requires needed allow allows
ensure ensures improve improves improved increase increases increased decrease decreases lead leads work works working
worked add adds added remain remains continue continues follow follows following consider considered discuss unless
whereas despite beyond instead according due overall particularly especially currently recently generally simply
actually why
zero ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty
seventy eighty ninety hundred thousand million billion half quarter percent per cent once twice
mmol mol mg mcg kg ml mm cm km bpm mmhg hrs mins
`.split(/\s+/).filter(Boolean));

const WORD = /[\p{L}\p{N}](?:[\p{L}\p{N}'’.-]*[\p{L}\p{N}])?/gu;
const BREAK = /[,;:!?()[\]{}"“”•·|/\\…]+|\.(?=\s|$)|\s[-–—]\s|[–—]/u;
const MAX_LENGTH = 34; // what fits a phone-width square
const isNumber = w => /^[\d.,%]+$/.test(w);
const isYear = w => /^(19|20)\d\d$/.test(w);
// An acronym or technical term (NICE, GP, HbA1c, COVID-19): kept even if short or rare
const isTerm = w => /^[A-Z][A-Z0-9-]{1,7}s?$/.test(w) || /[a-z][A-Z]|[A-Za-z]\d|\d[A-Za-z]/.test(w);
// Plurals counted together ("patient", "patients")
const keyOf = w => {
  const l = w.toLowerCase().replace(/['’]s$/, '');
  return l.length > 4 && /[^su]s$/.test(l) && !/(ss|is|ics)$/.test(l) ? l.slice(0, -1) : l;
};

export function findKeywords(segments, { max = 150 } = {}) {
  const found = new Map(); // key → { count, forms: Map(form → n), words, term }
  for (const { text, weight = 1 } of segments) {
    for (const chunk of text.split(BREAK)) {
      // Runs of meaningful words; everyday words and years end a run, numbers may sit inside one ("Type 2 diabetes")
      const runs = [[]];
      for (const raw of chunk.match(WORD) ?? []) {
        const w = raw.replace(/['’]s$/, '');
        const stop = STOP.has(w.toLowerCase()) || isYear(w) || (w.length < 3 && !isTerm(w) && !isNumber(w));
        if (stop) runs.push([]);
        else runs.at(-1).push(w);
      }
      for (const run of runs) {
        for (let i = 0; i < run.length; i++) {
          for (let n = 1; n <= 3 && i + n <= run.length; n++) {
            const words = run.slice(i, i + n);
            if (isNumber(words[0]) || words.every(isNumber)) continue;
            if (isNumber(words.at(-1)) && (n === 1 || words.at(-1).length > 2)) continue;
            const form = words.join(' ');
            if (form.length > MAX_LENGTH) continue;
            const key = words.map(keyOf).join(' ');
            const f = found.get(key) ?? { count: 0, whole: 0, forms: new Map(), n, term: words.some(isTerm), title: false };
            f.count += weight;
            if (n === run.length) f.whole++; // the phrase stands on its own between breaks, not a piece of a longer run
            f.title ||= weight > 1;
            f.forms.set(form, (f.forms.get(form) ?? 0) + 1);
            found.set(key, f);
          }
        }
      }
    }
  }

  // A phrase mostly seen inside longer, repeated ones gives way to them ("diabetes" to "type 2 diabetes"), except an
  // acronym on its own, which is worth a square whatever surrounds it
  const keys = [...found.keys()];
  for (const [key, f] of found) {
    if (f.term && f.n === 1) continue;
    const inside = keys.filter(k => found.get(k).n > f.n && found.get(k).count >= 2 && ` ${k} `.includes(` ${key} `))
      .reduce((sum, k) => sum + found.get(k).count, 0);
    if (inside >= 2 && inside >= f.count * 0.6) f.gone = true;
  }

  const ranked = [];
  for (const f of found.values()) {
    if (f.gone) continue;
    // An acronym on its own is worth having even once; a phrase that merely contains one isn't
    const term = f.term && f.n === 1;
    const strong = f.count >= 2 || term || f.title;
    if (!strong && !f.whole) continue; // a one-off piece of a longer run is usually a fragment, not a buzzword
    const score = f.count * [0, 1, 1.6, 1.8][f.n] * (term ? 1.3 : 1) * (f.whole ? 1.3 : 1);
    ranked.push({ text: display(f.forms), score, strong });
  }
  ranked.sort((a, b) => b.strong - a.strong || b.score - a.score || a.text.localeCompare(b.text));
  const seen = new Set();
  return ranked.filter(k => !seen.has(k.text.toLowerCase()) && seen.add(k.text.toLowerCase())).slice(0, max)
    .map(({ text, score }) => ({ text, score }));
}

// How a phrase is shown: its commonest spelling, shouting turned down, with a capital at the start
function display(forms) {
  let [best] = [...forms.entries()].sort((a, b) => b[1] - a[1])[0];
  const shouty = best === best.toUpperCase() && /[A-Z]{3}/.test(best) && (best.includes(' ') || (best.length > 8 && !/\d/.test(best)));
  if (shouty) best = best.toLowerCase(); // CARDIOVASCULAR RISK, but not COVID-19 or NICE
  return best.charAt(0).toUpperCase() + best.slice(1);
}
