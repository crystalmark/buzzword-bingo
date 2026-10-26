import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handler, useStore } from '../lambda/index.mjs';
import { memoryStore } from '../lambda/store.mjs';
import { LINES } from '../lambda/game.mjs';
import { THEMES } from '../lambda/themes.mjs';

beforeEach(() => {
  useStore(memoryStore());
  delete process.env.ORIGIN_SECRET;
});

async function call(method, path, { body, token, headers = {} } = {}) {
  const r = await handler({
    rawPath: '/bingo/api' + path,
    requestContext: { http: { method } },
    headers: { ...headers, ...(token && { 'x-player-token': token }) },
    body: body && JSON.stringify(body),
  });
  return { status: r.statusCode, ...JSON.parse(r.body) };
}

const lineMarks = line => line.reduce((m, i) => m | (1 << i), 0);

test('a host starts a game and gets a code, a token and a card', async () => {
  const r = await call('POST', '/games', { body: { name: 'Tim' } });
  assert.equal(r.status, 201);
  assert.match(r.code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  assert.ok(r.token);
  assert.equal(r.you.card.length, 25);
  assert.equal(r.you.host, true);
  assert.deepEqual(r.players.map(p => p.name), ['Tim']);
});

test('a game is business bingo unless the host picks another kind, and everyone joining gets that kind', async () => {
  const plain = await call('POST', '/games', { body: { name: 'Tim' } });
  assert.equal(plain.theme, 'business');
  const host = await call('POST', '/games', { body: { name: 'Tim', theme: 'physics' } });
  assert.equal(host.theme, 'physics');
  const jo = await call('POST', `/games/${host.code}/players`, { body: { name: 'Jo' } });
  assert.equal(jo.theme, 'physics');
  for (const card of [host.you.card, jo.you.card]) assert.ok(card.filter(Boolean).every(w => THEMES.physics.words.includes(w)));
  const next = await call('POST', `/games/${host.code}/rounds`, { token: host.token });
  assert.ok(next.you.card.filter(Boolean).every(w => THEMES.physics.words.includes(w)), 'a new round keeps the theme');
});

test('an unknown theme is refused', async () => {
  assert.equal((await call('POST', '/games', { body: { name: 'Tim', theme: 'astrology' } })).status, 400);
  assert.equal((await call('POST', '/games', { body: { name: 'Tim', theme: 'toString' } })).status, 400);
});

test('a winning line through the centre shows the theme’s free square', async () => {
  const host = await call('POST', '/games', { body: { name: 'Tim', theme: 'film' } });
  const r = await call('PUT', `/games/${host.code}/marks`, { body: { marks: lineMarks(LINES[2]) }, token: host.token });
  assert.equal(r.players[0].line[2], THEMES.film.free);
});

test('a name is required, and trimmed', async () => {
  assert.equal((await call('POST', '/games', { body: { name: '   ' } })).status, 400);
  const r = await call('POST', '/games', { body: { name: '  Tim \n  Squires  ' } });
  assert.equal(r.you.name, 'Tim Squires');
});

test('a rude name is refused, whether starting a game or joining one', async () => {
  const start = await call('POST', '/games', { body: { name: 'W@nker' } });
  assert.equal(start.status, 400);
  assert.match(start.error, /different name/);
  const host = await call('POST', '/games', { body: { name: 'Charles Dickens' } });
  assert.equal(host.status, 201);
  assert.equal((await call('POST', `/games/${host.code}/players`, { body: { name: 'w a n k' } })).status, 400);
  assert.equal((await call('GET', `/games/${host.code}`)).players.length, 1);
});

test('colleagues join with the code and get cards of their own', async () => {
  const host = await call('POST', '/games', { body: { name: 'Tim' } });
  const jo = await call('POST', `/games/${host.code.toLowerCase()}/players`, { body: { name: 'Jo' } });
  assert.equal(jo.status, 201);
  assert.equal(jo.you.host, false);
  assert.notDeepEqual(jo.you.card, host.you.card);
  assert.equal(jo.players.length, 2);
});

test('the room never shows other players’ cards, and you only see your own with your token', async () => {
  const host = await call('POST', '/games', { body: { name: 'Tim' } });
  await call('POST', `/games/${host.code}/players`, { body: { name: 'Jo' } });
  const anon = await call('GET', `/games/${host.code}`);
  assert.equal(anon.you, null);
  assert.ok(anon.players.every(p => !('card' in p) && !('tokenHash' in p) && !('marks' in p)));
  const mine = await call('GET', `/games/${host.code}`, { token: host.token });
  assert.deepEqual(mine.you.card, host.you.card);
});

test('an unknown game is a 404', async () => {
  assert.equal((await call('GET', '/games/ZZZZ')).status, 404);
  assert.equal((await call('POST', '/games/ZZZZ/players', { body: { name: 'Jo' } })).status, 404);
});

test('marking needs your token', async () => {
  const host = await call('POST', '/games', { body: { name: 'Tim' } });
  assert.equal((await call('PUT', `/games/${host.code}/marks`, { body: { marks: 1 } })).status, 403);
  assert.equal((await call('PUT', `/games/${host.code}/marks`, { body: { marks: 1 }, token: 'nope' })).status, 403);
  assert.equal((await call('PUT', `/games/${host.code}/marks`, { body: { marks: 2 ** 30 }, token: host.token })).status, 400);
});

test('the first to a line is first in the room, with the words of their line', async () => {
  const host = await call('POST', '/games', { body: { name: 'Tim' } });
  const jo = await call('POST', `/games/${host.code}/players`, { body: { name: 'Jo' } });
  const almost = await call('PUT', `/games/${host.code}/marks`, { body: { marks: lineMarks([0, 1, 2, 3]) }, token: jo.token });
  assert.equal(almost.players[0].name, 'Jo');
  assert.equal(almost.players[0].needed, 1);
  assert.equal(almost.players[0].lineAt, null);

  const bingo = await call('PUT', `/games/${host.code}/marks`, { body: { marks: lineMarks(LINES[0]) }, token: jo.token });
  assert.ok(bingo.players[0].lineAt);
  assert.deepEqual(bingo.players[0].line, LINES[0].map(i => jo.you.card[i]));

  await new Promise(r => setTimeout(r, 5));
  const second = await call('PUT', `/games/${host.code}/marks`, { body: { marks: lineMarks(LINES[1]) }, token: host.token });
  assert.deepEqual(second.players.map(p => p.name), ['Jo', 'Tim']);
  assert.ok(second.players[1].lineAt > second.players[0].lineAt);
});

test('a line, once called, stands even if squares are unmarked', async () => {
  const host = await call('POST', '/games', { body: { name: 'Tim' } });
  const first = await call('PUT', `/games/${host.code}/marks`, { body: { marks: lineMarks(LINES[0]) }, token: host.token });
  const after = await call('PUT', `/games/${host.code}/marks`, { body: { marks: 0 }, token: host.token });
  assert.equal(after.players[0].lineAt, first.players[0].lineAt);
});

test('only the host starts a new round, which deals everyone a fresh card', async () => {
  const host = await call('POST', '/games', { body: { name: 'Tim' } });
  const jo = await call('POST', `/games/${host.code}/players`, { body: { name: 'Jo' } });
  await call('PUT', `/games/${host.code}/marks`, { body: { marks: lineMarks(LINES[0]) }, token: jo.token });
  assert.equal((await call('POST', `/games/${host.code}/rounds`, { token: jo.token })).status, 403);

  const r = await call('POST', `/games/${host.code}/rounds`, { token: host.token });
  assert.equal(r.round, 2);
  assert.ok(r.players.every(p => p.lineAt === null && p.needed === 4));
  const joNow = await call('GET', `/games/${host.code}`, { token: jo.token });
  assert.notDeepEqual(joNow.you.card, jo.you.card);
  // marks sent for the old card are refused rather than applied to the new one
  assert.equal((await call('PUT', `/games/${host.code}/marks`, { body: { marks: 1, round: 1 }, token: jo.token })).status, 409);
});

test('with an origin secret set, requests that did not come through CloudFront are refused', async () => {
  process.env.ORIGIN_SECRET = 's3cret';
  assert.equal((await call('POST', '/games', { body: { name: 'Tim' } })).status, 403);
  const ok = await call('POST', '/games', { body: { name: 'Tim' }, headers: { 'x-origin-secret': 's3cret' } });
  assert.equal(ok.status, 201);
});

test('bad JSON and unknown routes', async () => {
  const r = await handler({ rawPath: '/bingo/api/games', requestContext: { http: { method: 'POST' } }, headers: {}, body: '{' });
  assert.equal(r.statusCode, 400);
  assert.equal((await call('DELETE', '/games')).status, 404);
});

// ---------- a game of your own words ----------

const OWN = Array.from({ length: 30 }, (_, i) => `Keyword ${i + 1}`);

test('a game of your own words deals cards from them, under its title, with its own free square', async () => {
  const host = await call('POST', '/games', { body: { name: 'Dr Squires', words: OWN, title: 'Diabetes update' } });
  assert.equal(host.status, 201);
  assert.equal(host.theme, 'custom');
  assert.deepEqual(host.kind, { name: 'Diabetes update', free: 'Free square ★' });
  const jo = await call('POST', `/games/${host.code}/players`, { body: { name: 'Jo' } });
  for (const card of [host.you.card, jo.you.card]) assert.ok(card.filter(Boolean).every(w => OWN.includes(w)));
  const next = await call('POST', `/games/${host.code}/rounds`, { token: host.token });
  assert.ok(next.you.card.filter(Boolean).every(w => OWN.includes(w)), 'a new round deals from the same words');
});

test('own words are tidied and de-duplicated, and need at least 24 different ones', async () => {
  const messy = [...OWN.slice(0, 23), '  keyword 1 ', 'KEYWORD 2', '', '   '];
  const few = await call('POST', '/games', { body: { name: 'Tim', words: messy } });
  assert.equal(few.status, 400);
  assert.match(few.error, /at least 24 different words \(there are 23\)/);
  const ok = await call('POST', '/games', { body: { name: 'Tim', words: [...messy, '  Insulin   resistance '] } });
  assert.equal(ok.status, 201);
  assert.ok(ok.you.card.includes('Insulin resistance') || ok.you.card.filter(Boolean).length === 24);
  assert.equal(ok.kind.name, 'Your own words', 'no title, a sensible name');
});

test('own words are refused when too long, too many, rude or not a list — but anatomy is fine', async () => {
  const bad = async words => (await call('POST', '/games', { body: { name: 'Tim', words } }));
  assert.match((await bad([...OWN, 'x'.repeat(35)])).error, /too long/);
  assert.equal((await bad(Array.from({ length: 201 }, (_, i) => `w${i}`))).status, 400);
  assert.match((await bad([...OWN, 'Bullshit bingo'])).error, /can’t go on a card/);
  assert.equal((await bad('not a list')).status, 400);
  assert.equal((await bad([...OWN, 'Penis', 'Vagina', 'Finger prick', 'Spastic paraplegia'])).status, 201);
  assert.equal((await call('POST', '/games', { body: { name: 'Tim', words: OWN, title: 'Wank' } })).status, 400);
});

test('squares stay locked until the minimum number of players have joined', async () => {
  const host = await call('POST', '/games', { body: { name: 'Dr Squires', words: OWN, minPlayers: 3 } });
  assert.equal(host.open, false);
  assert.equal(host.minPlayers, 3);
  const early = await call('PUT', `/games/${host.code}/marks`, { body: { marks: 1 }, token: host.token });
  assert.equal(early.status, 423);
  assert.match(early.error, /when 3 have joined \(1 so far\)/);
  await call('POST', `/games/${host.code}/players`, { body: { name: 'Jo' } });
  const third = await call('POST', `/games/${host.code}/players`, { body: { name: 'Sam' } });
  assert.equal(third.open, true);
  assert.equal((await call('PUT', `/games/${host.code}/marks`, { body: { marks: 1 }, token: third.token })).status, 200);
});

test('the host can unlock the squares early; nobody else can', async () => {
  const host = await call('POST', '/games', { body: { name: 'Dr Squires', words: OWN, minPlayers: 50 } });
  const jo = await call('POST', `/games/${host.code}/players`, { body: { name: 'Jo' } });
  assert.equal((await call('POST', `/games/${host.code}/start`, { token: jo.token })).status, 403);
  const started = await call('POST', `/games/${host.code}/start`, { token: host.token });
  assert.equal(started.open, true);
  assert.equal((await call('PUT', `/games/${host.code}/marks`, { body: { marks: 1 }, token: jo.token })).status, 200);
});

test('the minimum number of players must be sensible, and themed games can have one too', async () => {
  for (const minPlayers of [0, 101, 2.5, '3']) {
    assert.equal((await call('POST', '/games', { body: { name: 'Tim', minPlayers } })).status, 400, String(minPlayers));
  }
  const themed = await call('POST', '/games', { body: { name: 'Tim', theme: 'physics', minPlayers: 2 } });
  assert.equal(themed.open, false);
  assert.equal(themed.kind.name, 'Physics');
});
