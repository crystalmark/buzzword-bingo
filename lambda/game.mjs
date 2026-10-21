// The rules of the game, shared by the Lambda (which deals the cards and decides who got a line first) and the browser
// (which draws them, and deals solo cards on its own). deploy/deploy.sh copies this file to /bingo/js/game.mjs.
// The words themselves are in themes.mjs.
import { themeOf } from './themes.mjs';

export const SIZE = 5;
export const FREE = 12; // the centre square, always marked

// Every winning line, as the indexes of its squares: five rows, five columns, two diagonals
export const LINES = [
  ...[0, 1, 2, 3, 4].map(r => [0, 1, 2, 3, 4].map(c => r * SIZE + c)),
  ...[0, 1, 2, 3, 4].map(c => [0, 1, 2, 3, 4].map(r => r * SIZE + c)),
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];

const ALL = (1 << (SIZE * SIZE)) - 1;
const bit = i => 1 << i;

// A card: 24 different words from the theme, picked by randomInt(n) (an integer from 0 to n - 1), with null in the
// free square
export function deal(randomInt, theme) {
  const words = themeOf(theme).words.slice();
  for (let i = words.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [words[i], words[j]] = [words[j], words[i]];
  }
  const card = words.slice(0, SIZE * SIZE - 1);
  card.splice(FREE, 0, null);
  return card;
}

// Marks are a 25-bit mask, one bit per square; the free square is always in it
export function normaliseMarks(marks) {
  if (!Number.isInteger(marks) || marks < 0 || marks > ALL) return null;
  return marks | bit(FREE);
}

export const isMarked = (marks, i) => (marks & bit(i)) !== 0;
export const toggle = (marks, i) => (i === FREE ? marks : marks ^ bit(i)) | bit(FREE);

// The first complete line in marks, or null
export function completeLine(marks) {
  return LINES.find(line => line.every(i => isMarked(marks, i))) ?? null;
}

// How many more squares the player needs for their nearest line (0 when they have one)
export function needed(marks) {
  return Math.min(...LINES.map(line => line.filter(i => !isMarked(marks, i)).length));
}
