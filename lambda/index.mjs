// Buzzword Bingo API: one Lambda behind an HTTP API, reached through CloudFront at https://crystalmark.co.uk/bingo/api/*.
//   POST /bingo/api/games           {name, theme}  start a game; you're its host        → 201 {token, ...state}
//        or                  {name, words, title}  …with a card of your own words (24 to 200, picked from your slides)
//                                 + {minPlayers}  squares stay locked until that many have joined (default 1)
//   POST /bingo/api/games/{code}/players   {name}  join one                              → 201 {token, ...state}
//   GET  /bingo/api/games/{code}                   the room: everyone's progress, and your card if you send your token
//   PUT  /bingo/api/games/{code}/marks     {marks} mark your card (a bitmask); the server notes when you get a line
//   POST /bingo/api/games/{code}/rounds            host only: everyone gets a fresh card
//   POST /bingo/api/games/{code}/start             host only: unlock the squares now, however many have joined
// Players prove who they are with the token they were given on joining, in X-Player-Token; only its hash is stored.
// The server deals the cards and timestamps each player's first line, so "who called it first" isn't up to the browser.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { deal, normaliseMarks, completeLine, needed } from './game.mjs';
import { DEFAULT_THEME, isTheme, themeOf } from './themes.mjs';
import { dynamoStore } from './store.mjs';
import { rudeName, rudeWord, rudeCode } from './moderation.mjs';

const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels, so no words; easy to read out on a call
const CODE_LENGTH = 4;
const MAX_PLAYERS = 100; // a presentation's audience
const MAX_NAME = 24;
const LIFETIME = 24 * 60 * 60; // seconds a game lasts after it starts, or after its latest round
// A game of your own words: the page picks them from your document (in the browser; the file never comes here)
const CUSTOM = 'custom';
const CUSTOM_FREE = 'Free square ★';
const MIN_WORDS = 24;
const MAX_WORDS = 200;
const MAX_WORD = 34;
const MAX_TITLE = 60;

let store;
export function useStore(s) { store = s; }

const now = () => Date.now();
const hash = token => createHash('sha256').update(token).digest('hex');
// A random code, never one that reads as rude (moderation.mjs)
export function newCode() {
  for (;;) {
    const code = Array.from({ length: CODE_LENGTH }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
    if (!rudeCode(code)) return code;
  }
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

const cleanText = text => String(text ?? '').replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim();

function cleanName(name) {
  const n = cleanText(name).slice(0, MAX_NAME);
  if (!n) throw new HttpError(400, 'Give yourself a name');
  if (rudeName(n)) throw new HttpError(400, 'Please pick a different name — everyone in the game can see it');
  return n;
}

// The words of a custom card: each tidied and checked, repeats dropped
function cleanWords(words) {
  if (!Array.isArray(words)) throw new HttpError(400, 'Words must be a list');
  const seen = new Set();
  const out = [];
  for (const raw of words) {
    const w = cleanText(raw);
    if (!w || seen.has(w.toLowerCase())) continue;
    if (w.length > MAX_WORD) throw new HttpError(400, `“${w}” is too long for a square (${MAX_WORD} characters at most)`);
    if (rudeWord(w)) throw new HttpError(400, `“${w}” can’t go on a card`);
    seen.add(w.toLowerCase());
    out.push(w);
  }
  if (out.length < MIN_WORDS) throw new HttpError(400, `A card needs at least ${MIN_WORDS} different words (there are ${out.length})`);
  if (out.length > MAX_WORDS) throw new HttpError(400, `${MAX_WORDS} words at most`);
  return out;
}

function cleanTitle(title) {
  const t = cleanText(title).slice(0, MAX_TITLE);
  if (rudeWord(t)) throw new HttpError(400, 'Please pick a different title');
  return t;
}

// What the cards are dealt from: a game's own words, or its theme's
const wordsOf = game => game.words ?? game.theme;
// Squares unlock once enough players have joined, or when the host says so; players never leave, so it stays unlocked
const isOpen = (game, players) => !!game.started || players.length >= (game.minPlayers ?? 1);

function newPlayer(name, expires, theme) {
  const token = randomBytes(24).toString('base64url');
  return {
    token,
    player: {
      id: randomBytes(6).toString('base64url'), name, tokenHash: hash(token),
      card: deal(randomInt, theme), marks: normaliseMarks(0), line: null, lineAt: null, joinedAt: now(), expires,
    },
  };
}

function findMe(players, token) {
  if (!token) return null;
  const h = Buffer.from(hash(token));
  return players.find(p => timingSafeEqual(Buffer.from(p.tokenHash), h)) ?? null;
}

// What a player sees: everyone's name and progress (never their cards), and their own card
function state(game, players, me) {
  const { name, free } = game.words ? { name: game.title || 'Your own words', free: CUSTOM_FREE } : themeOf(game.theme);
  const room = players
    .map(p => ({
      id: p.id,
      name: p.name,
      needed: needed(p.marks),
      lineAt: p.lineAt,
      line: p.line && p.line.map(i => p.card[i] ?? free),
      host: p.id === game.hostId,
    }))
    .sort((a, b) => (a.lineAt ?? Infinity) - (b.lineAt ?? Infinity) || a.needed - b.needed || a.name.localeCompare(b.name));
  return {
    code: game.code,
    theme: game.theme ?? DEFAULT_THEME, // games from before there were themes are business ones
    kind: { name, free },
    open: isOpen(game, players),
    minPlayers: game.minPlayers ?? 1,
    round: game.round,
    roundAt: game.roundAt,
    players: room,
    you: me && { id: me.id, name: me.name, card: me.card, marks: me.marks, host: me.id === game.hostId },
  };
}

async function load(code) {
  const g = await store.load(code);
  if (!g) throw new HttpError(404, 'No game with that code — it may have finished');
  return g;
}

async function createGame(body) {
  const name = cleanName(body.name);
  const own = body.words !== undefined;
  const theme = own ? CUSTOM : body.theme ?? DEFAULT_THEME;
  if (!own && !isTheme(theme)) throw new HttpError(400, 'No such kind of bingo');
  const words = own ? cleanWords(body.words) : undefined;
  const title = own ? cleanTitle(body.title) : undefined;
  const minPlayers = body.minPlayers ?? 1;
  if (!Number.isInteger(minPlayers) || minPlayers < 1 || minPlayers > MAX_PLAYERS) {
    throw new HttpError(400, `The minimum number of players must be from 1 to ${MAX_PLAYERS}`);
  }
  const expires = Math.floor(now() / 1000) + LIFETIME;
  const { token, player } = newPlayer(name, expires, words ?? theme);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    const game = { code, theme, words, title, minPlayers, hostId: player.id, round: 1, roundAt: now(), createdAt: now(), expires };
    if (await store.createGame(code, game)) {
      await store.putPlayer(code, player);
      return json(201, { token, ...state(game, [player], player) });
    }
  }
  throw new HttpError(503, 'Couldn’t find a free game code — try again');
}

async function join(code, body) {
  const name = cleanName(body.name);
  const { game, players } = await load(code);
  if (players.length >= MAX_PLAYERS) throw new HttpError(409, `This game is full (${MAX_PLAYERS} players)`);
  const { token, player } = newPlayer(name, game.expires, wordsOf(game));
  await store.putPlayer(code, player);
  return json(201, { token, ...state(game, [...players, player], player) });
}

async function mark(code, token, body) {
  const marks = normaliseMarks(body.marks);
  if (marks === null) throw new HttpError(400, 'Marks must be a 25-bit number');
  const { game, players } = await load(code);
  const me = findMe(players, token);
  if (!me) throw new HttpError(403, 'You’re not in this game');
  if (body.round !== undefined && body.round !== game.round) throw new HttpError(409, 'That card is from an earlier round');
  if (!isOpen(game, players)) {
    throw new HttpError(423, `Hang on — the squares unlock when ${game.minPlayers} have joined (${players.length} so far)`);
  }
  me.marks = marks;
  const patch = { marks };
  // The first line of the round is timestamped here and kept, even if squares are unmarked afterwards
  if (!me.lineAt) {
    const line = completeLine(marks);
    if (line) {
      Object.assign(patch, { line, lineAt: now() });
      Object.assign(me, patch);
    }
  }
  await store.updatePlayer(code, me.id, patch);
  return json(200, state(game, players, me));
}

async function newRound(code, token) {
  const { game, players } = await load(code);
  const me = findMe(players, token);
  if (!me || me.id !== game.hostId) throw new HttpError(403, 'Only the host can start a new round');
  const expires = Math.floor(now() / 1000) + LIFETIME;
  Object.assign(game, { round: game.round + 1, roundAt: now(), expires });
  await store.updateGame(code, { round: game.round, roundAt: game.roundAt, expires });
  await Promise.all(players.map(p => {
    Object.assign(p, { card: deal(randomInt, wordsOf(game)), marks: normaliseMarks(0), line: null, lineAt: null, expires });
    return store.updatePlayer(code, p.id, { card: p.card, marks: p.marks, line: null, lineAt: null, expires });
  }));
  return json(200, state(game, players, me));
}

async function start(code, token) {
  const { game, players } = await load(code);
  const me = findMe(players, token);
  if (!me || me.id !== game.hostId) throw new HttpError(403, 'Only the host can start the game');
  game.started = true;
  await store.updateGame(code, { started: true });
  return json(200, state(game, players, me));
}

function fromCloudFront(headers) {
  const secret = process.env.ORIGIN_SECRET;
  if (!secret) return true;
  const sent = Buffer.from(headers['x-origin-secret'] ?? '');
  const want = Buffer.from(secret);
  return sent.length === want.length && timingSafeEqual(sent, want);
}

export async function handler(event) {
  try {
    const headers = event.headers ?? {};
    if (!fromCloudFront(headers)) return json(403, { error: 'Forbidden' });
    store ??= await dynamoStore(process.env.TABLE_NAME);

    const method = event.requestContext?.http?.method;
    const path = (event.rawPath ?? '').replace(/^\/bingo\/api/, '').replace(/\/+$/, '');
    let body = {};
    if (event.body) {
      if (event.body.length > 16384) throw new HttpError(413, 'Too much'); // room for 200 words of a custom card
      try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) ?? {}; }
      catch { throw new HttpError(400, 'Body must be JSON'); }
    }
    const token = headers['x-player-token'];

    if (path === '/games' && method === 'POST') return await createGame(body);
    const m = path.match(/^\/games\/([A-Za-z]{4})(\/players|\/marks|\/rounds|\/start)?$/);
    if (m) {
      const code = m[1].toUpperCase();
      const action = `${method} ${m[2] ?? ''}`;
      if (action === 'GET ') {
        const { game, players } = await load(code);
        return json(200, state(game, players, findMe(players, token)));
      }
      if (action === 'POST /players') return await join(code, body);
      if (action === 'PUT /marks') return await mark(code, token, body);
      if (action === 'POST /rounds') return await newRound(code, token);
      if (action === 'POST /start') return await start(code, token);
    }
    return json(404, { error: 'Not found' });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: 'Something went wrong' });
  }
}
