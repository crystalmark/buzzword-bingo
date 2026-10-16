// Buzzword Bingo in the browser. Routes on the path: /bingo/ (home), /bingo/solo, /bingo/<CODE> (a group game).
// In a group game the server deals the card and keeps score; this polls it every few seconds for the room's progress.
// The token that proves you're you in a game is kept in localStorage, so a reload or a closed tab puts you back in.
import { FREE, FREE_LABEL, deal, normaliseMarks, toggle, isMarked, completeLine, needed } from './game.mjs';

const API = '/bingo/api';
const POLL_VISIBLE = 3000;
const POLL_HIDDEN = 20000;
const $ = id => document.getElementById(id);

// ---------- small helpers ----------

const saved = {
  get(code) { try { return JSON.parse(localStorage.getItem('bingo:' + code)); } catch { return null; } },
  set(code, v) { try { localStorage.setItem('bingo:' + code, JSON.stringify(v)); } catch { /* private mode: no rejoin */ } },
  drop(code) { try { localStorage.removeItem('bingo:' + code); } catch { /* nothing to drop */ } },
  get name() { try { return localStorage.getItem('bingo:name') ?? ''; } catch { return ''; } },
  set name(v) { try { localStorage.setItem('bingo:name', v); } catch { /* fine */ } },
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
let play = null; // { mode: 'solo' | 'group', card, marks, round?, code?, token?, lineAt? }
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
    w.textContent = word ?? FREE_LABEL;
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
    else toast(e.message);
  } finally { inFlight--; }
}

// ---------- group game ----------

function renderGame(s) {
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
  $('strip-game').append('Game ', Object.assign(document.createElement('strong'), { textContent: s.code }), ` · Round ${s.round}`);
  $('btn-new-round').hidden = !play.host;

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
    pollTimer = setTimeout(() => poll(true), document.hidden ? POLL_HIDDEN : POLL_VISIBLE);
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
  document.title = `Game ${code} — Buzzword Bingo`;
  show('game');
  renderGame(s);
  poll();
}

// ---------- solo ----------

function enterSolo() {
  clearTimeout(pollTimer);
  play = { mode: 'solo', card: deal(randomInt), marks: normaliseMarks(0) };
  $('side').hidden = true;
  $('banner').hidden = true;
  $('btn-new-card').hidden = false;
  $('btn-new-round').hidden = true;
  $('strip-game').textContent = 'Solo';
  document.title = 'Solo — Buzzword Bingo';
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
  if (slug === 'solo') return enterSolo();
  if (/^[A-Za-z]{4}$/.test(slug)) {
    const code = slug.toUpperCase();
    if (slug !== code) history.replaceState(null, '', `/bingo/${code}`);
    const mine = saved.get(code);
    try {
      const s = await api('GET', `/games/${code}`, { token: mine?.token });
      if (s.you) return enterGame(code, mine.token, s);
      saved.drop(code);
      $('invite-code').textContent = code;
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
  show('home');
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
  const s = await api('POST', '/games', { body: { name: f.get('name') } });
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
  navigator.share({ title: 'Buzzword Bingo', text: `Join my Buzzword Bingo game — code ${play.code}`, url: shareUrl(play.code) }).catch(() => {});
});

$('btn-new-card').addEventListener('click', () => enterSolo());

$('btn-new-round').addEventListener('click', async () => {
  if (!confirm('Deal everyone a fresh card and start a new round?')) return;
  try { renderGame(await api('POST', `/games/${play.code}/rounds`, { token: play.token })); }
  catch (e) { toast(e.message); }
});

$('btn-leave').addEventListener('click', e => {
  e.preventDefault();
  if (!confirm('Leave this game? You won’t be able to get this card back.')) return;
  saved.drop(play.code);
  go('/bingo/');
});

route();
