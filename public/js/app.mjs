// Buzzword Bingo in the browser. Routes on the path: /bingo/ (home), /bingo/solo/<theme>, /bingo/new (your own words,
// after choosing a file), /bingo/<CODE> (a group game).
// In a group game the server deals the card and keeps score; this polls it every few seconds for the room's progress.
// The token that proves you're you in a game is kept in localStorage, so a reload or a closed tab puts you back in.
import { FREE, deal, normaliseMarks, toggle, isMarked, completeLine, needed } from './game.mjs';
import { THEMES, DEFAULT_THEME, isTheme, themeOf } from './themes.mjs';
import { readDocument, ACCEPT, MAX_BYTES } from './extract.mjs';
import { findKeywords } from './keywords.mjs';
import { rudeWord } from './moderation.mjs';

const API = '/bingo/api';
const POLL_VISIBLE = 3000;
const POLL_BIG_ROOM = 6000; // a room of more than 30, like a talk's audience
const POLL_HIDDEN = 20000;
const $ = id => document.getElementById(id);

// ---------- small helpers ----------

const saved = {
  get(code) { try { return JSON.parse(localStorage.getItem('bingo:' + code)); } catch { return null; } },
  set(code, v) { try { localStorage.setItem('bingo:' + code, JSON.stringify(v)); } catch { /* private mode: no rejoin */ } },
  drop(code) { try { localStorage.removeItem('bingo:' + code); } catch { /* nothing to drop */ } },
  get name() { try { return localStorage.getItem('bingo:name') ?? ''; } catch { return ''; } },
  set name(v) { try { localStorage.setItem('bingo:name', v); } catch { /* fine */ } },
  get theme() { try { const t = localStorage.getItem('bingo:theme'); return isTheme(t) ? t : DEFAULT_THEME; } catch { return DEFAULT_THEME; } },
  set theme(v) { try { localStorage.setItem('bingo:theme', v); } catch { /* fine */ } },
};

async function api(method, path, { body, token } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { 'x-player-token': token }) },
    body: body && JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error ?? `Something went wrong (${r.status})`), { status: r.status });
  return data;
}

let toastTimer;
function toast(message) {
  const t = $('error');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

const randomInt = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const timeOf = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const shareUrl = code => `${location.origin}/bingo/${code}`;
const ordinal = n => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');

function show(view) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== 'view-' + view;
  window.scrollTo(0, 0);
}

// ---------- the card ----------

// What's on screen: a card, its marks, and (in a group game) which round it belongs to
let play = null; // { mode: 'solo' | 'group', theme, name, free, card, marks, round?, code?, token?, open?, size? }
let celebrated = false;

function buildCard() {
  const el = $('card');
  el.replaceChildren(...'BINGO'.split('').map(l => Object.assign(document.createElement('div'), { className: 'head', textContent: l, ariaHidden: 'true' })));
  play.card.forEach((word, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    // smaller type for long phrases, and for single words too long to fit a phone-width square whole
    const long = word && (word.length > 16 || Math.max(...word.split(/[\s-]/).map(w => w.length)) > 10);
    b.className = 'cell' + (i === FREE ? ' free' : '') + (long ? ' long' : '');
    const w = document.createElement('span');
    w.className = 'w';
    w.textContent = word ?? play.free;
    b.append(w);
    b.addEventListener('click', () => mark(i));
    el.append(b);
  });
  celebrated = false;
  paintCard();
}

function paintCard() {
  const line = completeLine(play.marks);
  const cells = $('card').querySelectorAll('.cell');
  cells.forEach((c, i) => {
    const on = isMarked(play.marks, i);
    c.classList.toggle('on', on);
    c.classList.toggle('line', !!line?.includes(i));
    c.setAttribute('aria-pressed', on);
    c.setAttribute('aria-label', `${play.card[i] ?? 'Free square'}${on ? ', marked' : ''}`);
  });
  const left = needed(play.marks);
  $('card-status').textContent = line ? 'Line complete!' : left === 1 ? 'One more for a line…' : `${left} more for a line`;
  if (line && !celebrated) {
    celebrated = true;
    const s = $('stamp');
    s.classList.remove('show');
    void s.offsetWidth; // restart the animation
    s.classList.add('show');
    navigator.vibrate?.([60, 40, 120]);
  }
}

// Marks go to the server whole (a bitmask), newest wins: while one is on its way, polls don't overwrite the card
let inFlight = 0;
async function mark(i) {
  if (i === FREE) return;
  if (play.mode === 'group' && !play.open) return;
  play.marks = toggle(play.marks, i);
  paintCard();
  if (play.mode !== 'group') return;
  const sent = play.marks;
  inFlight++;
  try {
    const s = await api('PUT', `/games/${play.code}/marks`, { body: { marks: sent, round: play.round }, token: play.token });
    if (inFlight === 1) renderGame(s);
  } catch (e) {
    if (e.status === 409) poll(true); // a new round started under us: fetch the new card
    else {
      if (e.status === 423) { play.marks = toggle(play.marks, i); paintCard(); } // not unlocked after all
      toast(e.message);
    }
  } finally { inFlight--; }
}

// ---------- group game ----------

function renderGame(s) {
  Object.assign(play, { theme: s.theme, name: s.kind.name, free: s.kind.free, size: s.players.length });
  if (s.you && (s.round !== play.round || !play.card)) {
    Object.assign(play, { card: s.you.card, marks: s.you.marks, round: s.round });
    buildCard();
    $('banner').hidden = true;
  } else if (s.you && inFlight === 0) {
    play.marks = s.you.marks;
    paintCard();
  }
  play.host = s.you?.host;
  $('strip-game').innerHTML = '';
  $('strip-game').append('Game ', Object.assign(document.createElement('strong'), { textContent: s.code }),
    ` · ${s.kind.name} · Round ${s.round}`);
  $('btn-new-round').hidden = !play.host;

  // Locked until enough players are in (or the host starts it)
  if (play.open === false && s.open) toast('Everyone’s here — eyes down!');
  play.open = s.open;
  $('waiting').hidden = s.open;
  if (!s.open) {
    const left = s.minPlayers - s.players.length;
    $('waiting-text').replaceChildren(`Waiting for ${left} more ${left === 1 ? 'player' : 'players'}…`,
      Object.assign(document.createElement('small'), { textContent: `${s.players.length} of ${s.minPlayers} here · the squares unlock when everyone’s in` }));
    $('btn-start-now').hidden = !play.host;
  }

  // The banner: who called it first, and with what
  const first = s.players.find(p => p.lineAt);
  const banner = $('banner');
  if (first) {
    const you = first.id === s.you?.id;
    banner.className = 'banner' + (you ? ' win' : '');
    banner.replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: you ? 'BINGO! You called it first.' : `${first.name} called Bingo!` }),
      Object.assign(document.createElement('span'), { textContent: you ? 'Go on — say it out loud.' : `at ${timeOf(first.lineAt)}` }),
      Object.assign(document.createElement('span'), { className: 'words', textContent: first.line.join(' · ') }),
    );
    banner.hidden = false;
  } else banner.hidden = true;

  // The room: finishers in order, then everyone else by how close they are
  $('room-count').textContent = s.players.length;
  let place = 0;
  $('room').replaceChildren(...s.players.map(p => {
    const li = document.createElement('li');
    const done = !!p.lineAt;
    if (done) place++;
    li.className = [p.id === s.you?.id && 'you', done && 'done', !done && p.needed === 1 && 'close'].filter(Boolean).join(' ');
    const pos = Object.assign(document.createElement('span'), { className: 'pos', textContent: done ? (place === 1 ? '🏆' : ordinal(place)) : '' });
    const who = Object.assign(document.createElement('span'), { className: 'who', textContent: p.name });
    if (p.id === s.you?.id) who.append(Object.assign(document.createElement('small'), { textContent: 'you' }));
    else if (p.host) who.append(Object.assign(document.createElement('small'), { textContent: 'host' }));
    const left = Object.assign(document.createElement('span'), {
      className: 'left',
      textContent: done ? timeOf(p.lineAt) : p.needed === 1 ? '1 away!' : `needs ${p.needed}`,
    });
    li.append(pos, who, left);
    return li;
  }));
}

let pollTimer;
async function poll(now = false) {
  clearTimeout(pollTimer);
  if (!play || play.mode !== 'group') return;
  if (!now) {
    pollTimer = setTimeout(() => poll(true), document.hidden ? POLL_HIDDEN : play.size > 30 ? POLL_BIG_ROOM : POLL_VISIBLE);
    return;
  }
  const code = play.code;
  try {
    const s = await api('GET', `/games/${code}`, { token: play.token });
    if (play?.code !== code) return;
    if (!s.you) { saved.drop(code); return route(); } // our token is no longer in the game
    renderGame(s);
  } catch (e) {
    if (e.status === 404) {
      saved.drop(code);
      toast('That game has finished.');
      return go('/bingo/');
    }
  }
  poll();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(true); });

function enterGame(code, token, s) {
  saved.set(code, { token });
  play = { mode: 'group', code, token, card: null, round: null, marks: 0 };
  $('side').hidden = false;
  $('btn-new-card').hidden = true;
  $('share-code').textContent = code;
  $('share-url').value = shareUrl(code);
  $('btn-share').hidden = !navigator.share;
  document.title = `Game ${code} · ${s.kind.name} — Buzzword Bingo`;
  show('game');
  renderGame(s);
  poll();
}

// ---------- solo ----------

function enterSolo(theme) {
  clearTimeout(pollTimer);
  play = { mode: 'solo', theme, free: themeOf(theme).free, card: deal(randomInt, theme), marks: normaliseMarks(0) };
  $('waiting').hidden = true;
  $('side').hidden = true;
  $('banner').hidden = true;
  $('btn-new-card').hidden = false;
  $('btn-new-round').hidden = true;
  $('strip-game').textContent = `Solo · ${themeOf(theme).name}`;
  document.title = `Solo · ${themeOf(theme).name} — Buzzword Bingo`;
  show('game');
  buildCard();
}

// ---------- routing ----------

function go(path) {
  history.pushState(null, '', path);
  route();
}

async function route() {
  clearTimeout(pollTimer);
  play = null;
  $('strip-game').textContent = '';
  document.title = 'Buzzword Bingo — Crystalmark';
  const slug = location.pathname.replace(/^\/bingo\/?/, '').replace(/\/$/, '');
  if (slug === 'new') return own ? showOwn() : go('/bingo/');
  const solo = slug.match(/^solo(?:\/([a-z]+))?$/);
  if (solo) return enterSolo(isTheme(solo[1]) ? solo[1] : saved.theme);
  if (/^[A-Za-z]{4}$/.test(slug)) {
    const code = slug.toUpperCase();
    if (slug !== code) history.replaceState(null, '', `/bingo/${code}`);
    const mine = saved.get(code);
    try {
      const s = await api('GET', `/games/${code}`, { token: mine?.token });
      if (s.you) return enterGame(code, mine.token, s);
      saved.drop(code);
      $('invite-code').textContent = code;
      $('invite-theme').textContent = `${s.kind.name} bingo`;
      const names = s.players.map(p => p.name);
      $('invite-who').textContent = names.length === 1 ? `${names[0]} is waiting for you. Pick a name and you’ll get your own card.`
        : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are already playing. Pick a name and you’ll get your own card.`;
      $('form-invite').name.value = saved.name;
      show('invite');
      $('form-invite').name.focus();
    } catch (e) {
      toast(e.message);
      history.replaceState(null, '', '/bingo/');
      showHome();
    }
    return;
  }
  showHome();
}

function showHome() {
  for (const f of [$('form-start'), $('form-join')]) if (!f.name.value) f.name.value = saved.name;
  pickTheme(saved.theme);
  show('home');
}

// The picker on the home page: the kind of bingo a new game, or a solo card, will be
$('themes').replaceChildren(...Object.entries(THEMES).map(([id, t]) => {
  const label = document.createElement('label');
  const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'theme', value: id });
  input.addEventListener('change', () => { saved.theme = id; pickTheme(id); });
  label.append(input, Object.assign(document.createElement('span'), { textContent: t.name }));
  return label;
}));
const chosenTheme = () => document.querySelector('#themes input:checked')?.value ?? DEFAULT_THEME;
function pickTheme(id) {
  const t = themeOf(id);
  document.querySelector(`#themes input[value="${isTheme(id) ? id : DEFAULT_THEME}"]`).checked = true;
  $('home-kicker').textContent = t.kicker;
  $('theme-blurb').textContent = t.blurb;
  $('solo-link').setAttribute('href', `/bingo/solo/${chosenTheme()}`);
}

addEventListener('popstate', route);
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-nav]');
  if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute('href')); }
});

// ---------- forms and buttons ----------

function busy(form, fn) {
  return async e => {
    e.preventDefault();
    const b = form.querySelector('button[type=submit]');
    b.disabled = true;
    try { await fn(new FormData(form)); } catch (err) { toast(err.message); } finally { b.disabled = false; }
  };
}

$('form-start').addEventListener('submit', busy($('form-start'), async f => {
  saved.name = f.get('name').trim();
  const s = await api('POST', '/games', { body: { name: f.get('name'), theme: chosenTheme() } });
  history.pushState(null, '', `/bingo/${s.code}`);
  enterGame(s.code, s.token, s);
}));

$('form-join').addEventListener('submit', busy($('form-join'), async f => {
  const code = f.get('code').trim().toUpperCase();
  saved.name = f.get('name').trim();
  const s = await api('POST', `/games/${code}/players`, { body: { name: f.get('name') } });
  history.pushState(null, '', `/bingo/${code}`);
  enterGame(code, s.token, s);
}));

$('form-invite').addEventListener('submit', busy($('form-invite'), async f => {
  const code = $('invite-code').textContent;
  saved.name = f.get('name').trim();
  const s = await api('POST', `/games/${code}/players`, { body: { name: f.get('name') } });
  enterGame(code, s.token, s);
}));

$('btn-copy').addEventListener('click', async () => {
  const url = $('share-url').value;
  try { await navigator.clipboard.writeText(url); }
  catch { $('share-url').select(); document.execCommand('copy'); }
  $('btn-copy').textContent = 'Copied ✓';
  setTimeout(() => { $('btn-copy').textContent = 'Copy link'; }, 1800);
});
$('share-url').addEventListener('focus', e => e.target.select());

$('btn-share').addEventListener('click', () => {
  const text = `Join my game of Buzzword Bingo (${play.name}) — code ${play.code}`;
  navigator.share({ title: 'Buzzword Bingo', text, url: shareUrl(play.code) }).catch(() => {});
});

$('btn-new-card').addEventListener('click', () => enterSolo(play.theme));

$('btn-new-round').addEventListener('click', async () => {
  if (!confirm('Deal everyone a fresh card and start a new round?')) return;
  try { renderGame(await api('POST', `/games/${play.code}/rounds`, { token: play.token })); }
  catch (e) { toast(e.message); }
});

$('btn-start-now').addEventListener('click', async () => {
  try { renderGame(await api('POST', `/games/${play.code}/start`, { token: play.token })); }
  catch (e) { toast(e.message); }
});

$('btn-leave').addEventListener('click', e => {
  e.preventDefault();
  if (!confirm('Leave this game? You won’t be able to get this card back.')) return;
  saved.drop(play.code);
  go('/bingo/');
});

// ---------- your own words, from a document ----------
// The file is read here, in the browser (extract.mjs, keywords.mjs); only the words kept are sent, when the game starts.

const MIN_WORDS = 24;
const OFFER = 40;      // words put on the cards to begin with
const SUGGEST = 60;    // more offered below them
let own = null;        // { file, title, parts, unit, found, chosen: [], more: [] }

const tidyWord = w => w.replace(/\s+/g, ' ').trim();
const has = (list, w) => list.some(x => x.toLowerCase() === w.toLowerCase());

async function useFile(file) {
  if (!file) return;
  if (file.size > MAX_BYTES) return toast('That file is too big (100 MB at most)');
  const panel = $('own-drop');
  panel.classList.add('busy');
  try {
    const doc = await readDocument(file.name, await file.arrayBuffer());
    const words = findKeywords(doc.segments).map(k => k.text).filter(w => !rudeWord(w));
    own = { file: file.name, title: doc.title, parts: doc.parts, unit: doc.unit, found: words.length,
      chosen: words.slice(0, OFFER), more: words.slice(OFFER, OFFER + SUGGEST) };
    go('/bingo/new');
  } catch (e) {
    toast(e.message || 'That file couldn’t be read');
  } finally {
    panel.classList.remove('busy');
    $('own-file').value = '';
  }
}

function showOwn() {
  const { file, parts, unit, found, chosen } = own;
  const where = `${parts} ${unit}${parts === 1 ? '' : 's'} of “${file}”`;
  $('own-found').textContent = found === 0
    ? `No words could be found in ${where} — a scanned PDF, perhaps? Add your own below.`
    : `${found} possible buzzwords in ${where}. ${chosen.length >= MIN_WORDS ? `The best ${chosen.length} are on the cards` : 'They’re all on the cards'}: take off any you don’t want and add your own.`;
  $('own-title').value = own.title;
  const f = $('form-own');
  if (!f.name.value) f.name.value = saved.name;
  renderOwn();
  document.title = 'Your own bingo — Buzzword Bingo';
  show('own');
}

function renderOwn() {
  const chip = (text, label, onClick, plain) => {
    const li = document.createElement('li');
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: plain ? text : '×' });
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    if (!plain) li.append(text);
    li.append(b);
    return li;
  };
  $('own-chosen').replaceChildren(...own.chosen.map(w => chip(w, `Remove ${w}`, () => {
    own.chosen = own.chosen.filter(x => x !== w);
    own.more.unshift(w);
    renderOwn();
  })));
  $('own-more').replaceChildren(...own.more.map(w => chip(w, `Add ${w}`, () => {
    own.more = own.more.filter(x => x !== w);
    own.chosen.push(w);
    renderOwn();
  }, true)));
  $('own-more-section').hidden = own.more.length === 0;
  const n = own.chosen.length;
  const count = $('own-count');
  count.textContent = n >= MIN_WORDS ? `${n} words` : `${n} words — add ${MIN_WORDS - n} more (a card needs ${MIN_WORDS})`;
  count.className = n >= MIN_WORDS ? '' : 'short';
  $('btn-own-start').disabled = n < MIN_WORDS;
}

function addOwn() {
  const input = $('own-add');
  const w = tidyWord(input.value);
  if (!w) return;
  if (w.length > 34) return toast('That’s too long for a square (34 characters at most)');
  if (rudeWord(w)) return toast('That can’t go on a card');
  if (has(own.chosen, w)) return toast('That’s already on the cards');
  own.more = own.more.filter(x => x.toLowerCase() !== w.toLowerCase());
  own.chosen.push(w);
  input.value = '';
  renderOwn();
  input.focus();
}

$('own-file').accept = ACCEPT;
$('own-file').addEventListener('change', e => useFile(e.target.files[0]));
const drop = $('own-drop');
for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add('over'); });
for (const type of ['dragleave', 'drop']) drop.addEventListener(type, () => drop.classList.remove('over'));
drop.addEventListener('drop', e => { e.preventDefault(); useFile(e.dataTransfer.files[0]); });

$('btn-own-add').addEventListener('click', addOwn);
$('own-add').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addOwn(); } });

$('form-own').addEventListener('submit', busy($('form-own'), async f => {
  saved.name = f.get('name').trim();
  const s = await api('POST', '/games', { body: {
    name: f.get('name'), title: f.get('title'), words: own.chosen, minPlayers: Number(f.get('minPlayers')) || 1,
  } });
  own = null;
  history.pushState(null, '', `/bingo/${s.code}`);
  enterGame(s.code, s.token, s);
}));

route();
