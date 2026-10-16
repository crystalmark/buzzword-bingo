// The rules of the game, shared by the Lambda (which deals the cards and decides who got a line first) and the browser
// (which draws them, and deals solo cards on its own). deploy/deploy.sh copies this file to /bingo/js/game.mjs.

export const SIZE = 5;
export const FREE = 12; // the centre square, always marked
export const FREE_LABEL = 'Free square ☕';

export const WORDS = [
  'Synergy', 'Circle back', 'Low-hanging fruit', 'Move the needle', 'Deep dive', 'Touch base', 'Blue-sky thinking',
  'Think outside the box', 'Paradigm shift', 'Leverage', 'Bandwidth', 'Take it offline', 'Ducks in a row',
  'Boil the ocean', 'Run it up the flagpole', 'Helicopter view', 'Drill down', 'Game changer', 'Win-win',
  'Going forward', 'Quick win', 'Ballpark figure', 'Pivot', 'Disrupt', 'Thought leadership', 'Best practice',
  'Core competency', 'Value add', 'Holistic', 'Agile', 'Actionable insights', 'Deliverables', 'Stakeholder buy-in',
  'Mission-critical', 'Scalable', 'Seamless', 'Ecosystem', 'Empower', 'On a journey', 'North star',
  'Single source of truth', 'Lots of moving parts', 'Herding cats', 'Peel the onion', 'Parking lot',
  'Let’s unpack that', 'Hard stop', 'Ping me', 'Loop you in', 'Reach out', 'Granular', 'Learnings',
  'The ask', 'Double-click on that', 'Level set', 'Pain point', 'Tiger team', 'Swim lane', 'Hit the ground running',
  'Heavy lifting', 'Secret sauce', 'Skin in the game', 'Bleeding edge', 'Next-gen', 'Best-in-class', 'World-class',
  'Key takeaways', 'On my radar', 'Put a pin in it', 'Bake it in', 'Socialise it', 'Sense check', 'Wash its face',
  'Joined-up thinking', 'Direction of travel', 'Piece of work', 'Across the piece', 'Horizon scanning',
  'Lessons learned', 'Spin up', 'MVP', 'Pushback', 'Bring to the table', 'Mindshare', 'Lean in', 'Wheelhouse',
  'Elevator pitch', 'Alignment', 'Transformation', 'Digital-first', 'AI-powered', 'Hockey stick', 'Runway',
  'Burning platform', 'Can you see my screen?', 'You’re on mute', 'Sorry, go ahead', 'Bear with',
  'I’ll keep this brief', 'Any other business?', 'Just to piggyback', 'Per my last email', 'Reinvent the wheel',
  'Rightsizing', 'Cadence', 'Ideate', 'Operationalise', 'Bottleneck', 'Headwinds', 'Tailwinds', 'Data-driven',
  'Customer-centric', 'Future-proof', 'Fail fast', 'Net-net', 'At the end of the day', 'Cross-functional',
  'Proactive', 'Out of the gate', 'Open the floodgates', 'Gain traction', 'Hearts and minds',
  'Take it to the next level', 'Laser focus', 'Above my pay grade', 'Drink our own champagne',
];

// Every winning line, as the indexes of its squares: five rows, five columns, two diagonals
export const LINES = [
  ...[0, 1, 2, 3, 4].map(r => [0, 1, 2, 3, 4].map(c => r * SIZE + c)),
  ...[0, 1, 2, 3, 4].map(c => [0, 1, 2, 3, 4].map(r => r * SIZE + c)),
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];

const ALL = (1 << (SIZE * SIZE)) - 1;
const bit = i => 1 << i;

// A card: 24 different words, picked by randomInt(n) (an integer from 0 to n - 1), with null in the free square
export function deal(randomInt) {
  const words = WORDS.slice();
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
