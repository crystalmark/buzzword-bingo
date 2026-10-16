import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { WORDS, LINES, FREE, deal, normaliseMarks, toggle, completeLine, needed, isMarked } from '../lambda/game.mjs';

const marksFor = squares => squares.reduce((m, i) => m | (1 << i), normaliseMarks(0));

test('the word list has no repeats and is long enough for a card', () => {
  assert.equal(new Set(WORDS.map(w => w.toLowerCase())).size, WORDS.length);
  assert.ok(WORDS.length >= 60);
});

test('a card has 24 different words and a free centre', () => {
  const card = deal(randomInt);
  assert.equal(card.length, 25);
  assert.equal(card[FREE], null);
  const words = card.filter(Boolean);
  assert.equal(words.length, 24);
  assert.equal(new Set(words).size, 24);
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
