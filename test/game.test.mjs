import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { LINES, FREE, deal, normaliseMarks, toggle, completeLine, needed, isMarked } from '../lambda/game.mjs';
import { THEMES, DEFAULT_THEME, themeOf } from '../lambda/themes.mjs';

const marksFor = squares => squares.reduce((m, i) => m | (1 << i), normaliseMarks(0));

for (const [id, theme] of Object.entries(THEMES)) {
  test(`${id}: enough words, no repeats, each short enough for a phone-width square`, () => {
    assert.ok(theme.name && theme.kicker && theme.blurb && theme.free);
    assert.ok(theme.words.length >= 40, `${theme.words.length} words`);
    assert.equal(new Set(theme.words.map(w => w.toLowerCase())).size, theme.words.length);
    for (const w of theme.words) assert.ok(w.length <= 34, `too long for a square: ${w}`);
  });

  test(`${id}: a card has 24 different words from the theme and a free centre`, () => {
    const card = deal(randomInt, id);
    assert.equal(card.length, 25);
    assert.equal(card[FREE], null);
    const words = card.filter(Boolean);
    assert.equal(new Set(words).size, 24);
    assert.ok(words.every(w => theme.words.includes(w)));
  });
}

test('an unknown or missing theme deals business cards', () => {
  assert.equal(themeOf('nope'), THEMES[DEFAULT_THEME]);
  assert.equal(themeOf('toString'), THEMES[DEFAULT_THEME]);
  assert.ok(deal(randomInt).filter(Boolean).every(w => THEMES.business.words.includes(w)));
});

test('two cards are (almost certainly) different', () => {
  assert.notDeepEqual(deal(randomInt), deal(randomInt));
});

test('there are 12 lines and the free square is always marked', () => {
  assert.equal(LINES.length, 12);
  assert.ok(isMarked(normaliseMarks(0), FREE));
  assert.ok(isMarked(toggle(normaliseMarks(0), FREE), FREE));
});

test('marks outside 25 bits are refused', () => {
  assert.equal(normaliseMarks(-1), null);
  assert.equal(normaliseMarks(1 << 25), null);
  assert.equal(normaliseMarks(1.5), null);
  assert.equal(normaliseMarks('3'), null);
});

test('a row, a column and a diagonal each count as a line', () => {
  assert.deepEqual(completeLine(marksFor([0, 1, 2, 3, 4])), [0, 1, 2, 3, 4]);
  assert.deepEqual(completeLine(marksFor([2, 7, 17, 22])), [2, 7, 12, 17, 22]);
  assert.deepEqual(completeLine(marksFor([0, 6, 18, 24])), [0, 6, 12, 18, 24]);
  assert.equal(completeLine(marksFor([0, 1, 2, 3])), null);
});

test('needed counts the squares left on the nearest line', () => {
  assert.equal(needed(normaliseMarks(0)), 4);     // the free square starts the middle row, column and diagonals
  assert.equal(needed(marksFor([10, 11, 13])), 1);
  assert.equal(needed(marksFor([10, 11, 13, 14])), 0);
});
