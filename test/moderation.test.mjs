import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rudeName, rudeCode } from '../lambda/moderation.mjs';
import { newCode } from '../lambda/index.mjs';

// Names that must be refused: the rude words themselves, and the usual ways of disguising them
const RUDE = [
  'Wank', 'wanker', 'Wanky McWankface', 'BigWankerDave', 'W@nk3r', 'w a n k', 'w.a.n.k', 'Waaaank', 'WANK',
  'f*ck', 'f**k off', 'fuuuck', 'Fucking Dave', 'Sh1t', 'shite', 'shithead', 'c u n t', 'Twat', 'tw@t',
  'Dickhead Dan', 'dickface', 'Cock', 'Knobhead', 'Bellend', 'Prick', 'arsehole', 'Pissflaps', 'Tits McGee',
  'Slut', 'Bitch', 'Bastard', 'Tosser', 'Bollocks', 'Spunk', 'Porn star', 'Dildo Baggins',
  'Retard', 'Spaz', 'faggot', 'Paki', 'n1gger', 'Wtf', 'stfu',
];

// Real names and words with rude letters inside them, which must get through
const FINE = [
  'Tim', 'Priya', 'Dick', 'Dick Van Dyke', 'Terrance Dicks', 'Charles Dickens', 'Tony Hancock', 'Cockburn', 'Jarvis Cocker',
  'Seymour Cocks', 'Babcock', 'Peacock', 'Hitchcock', 'Scunthorpe', 'Scunthorpe United fan', 'Swankie', 'Swanky Sue',
  'Felix Wankel', 'Dikshit', 'Matsushita', 'Shittu', 'Benedict Cumberbatch', 'Kumar', 'Penistone', 'Pratt', 'Titus',
  'Tittensor', 'Cassidy', 'Glasgow', 'Bass', 'Arsenal fan', 'Fanny', 'Willy', 'Hooker', 'Fagan', 'Pakistan',
  'Bellenden', 'Kuntz', 'Nigel', 'Niger', 'Assange', 'Shagufta', 'Cowan Kerr', 'Dan Kelly', 'Ian Kerr',
  'Mary-Jane O’Brien', 'Zoë', 'José', 'Player 1', 'Dr Smith', 'R2-D2',
];

for (const name of RUDE) test(`refused: ${name}`, () => assert.ok(rudeName(name)));
for (const name of FINE) test(`allowed: ${name}`, () => assert.ok(!rudeName(name)));

test('codes that read as rude are spotted', () => {
  for (const code of ['WNKR', 'XWNK', 'FCKS', 'CNTS', 'SHTZ']) assert.ok(rudeCode(code), code);
  for (const code of ['KPTZ', 'BJTW', 'HRMN']) assert.ok(!rudeCode(code), code);
});

test('a rude-looking code is never handed out', () => {
  for (let i = 0; i < 20000; i++) assert.ok(!rudeCode(newCode()));
});
