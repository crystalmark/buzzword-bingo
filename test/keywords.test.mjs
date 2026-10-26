import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findKeywords } from '../public/js/keywords.mjs';

const seg = (text, weight = 1) => ({ text, weight });
const texts = segments => findKeywords(segments).map(k => k.text);

// A short talk of the kind the feature is for
const TALK = [
  seg('Type 2 diabetes in primary care', 3),
  seg('Insulin resistance is the starting point for most patients with type 2 diabetes.'),
  seg('Check HbA1c every three months until stable; the HbA1c target is usually 48 mmol/mol.'),
  seg('Insulin resistance improves with weight loss — weight loss is the first conversation.'),
  seg('Follow the NICE guidelines for metformin, and review metformin side effects.', 1),
  seg('Annual review', 3),
  seg('Foot checks, eye screening and kidney function at the annual review.'),
  seg('Patients often ask about diet; a patient-led plan works best.'),
  seg('Click to see the next slide. Thank you! Any questions?'),
];

test('phrases from a talk come out on top, titles and repeats first', () => {
  const top = texts(TALK).slice(0, 8);
  for (const k of ['Type 2 diabetes', 'Insulin resistance', 'HbA1c', 'Weight loss', 'Annual review', 'Metformin']) {
    assert.ok(top.includes(k), `${k} in ${top}`);
  }
});

test('everyday words, slide furniture and lone numbers never become buzzwords', () => {
  const all = texts(TALK).map(t => t.toLowerCase());
  for (const k of ['the', 'click', 'slide', 'thank you', 'questions', 'every', 'usually', '48', 'three months']) {
    assert.ok(!all.includes(k), `${k} should not be a buzzword`);
  }
});

test('a word mostly seen inside a longer phrase gives way to it', () => {
  const all = texts(TALK);
  assert.ok(all.includes('Insulin resistance'));
  assert.ok(!all.includes('Insulin'), 'insulin only ever appears as insulin resistance');
  assert.ok(!all.includes('Resistance'));
});

test('acronyms and technical terms count even when short, and keep their capitals', () => {
  const all = texts([seg('The GP referred to the MDT.'), seg('COVID-19 and HbA1c')]);
  for (const k of ['GP', 'MDT', 'COVID-19', 'HbA1c']) assert.ok(all.includes(k), `${k} in ${all}`);
});

test('plurals are counted together, and shown the commonest way', () => {
  const k = findKeywords([seg('patients'), seg('patients'), seg('patient')]);
  assert.equal(k[0].text, 'Patients');
  assert.equal(k.filter(x => /^patient/i.test(x.text)).length, 1);
});

test('shouty titles are turned down, and nothing is too long for a square', () => {
  const all = texts([seg('CARDIOVASCULAR RISK ASSESSMENT', 3), seg('cardiovascular risk assessment matters')]);
  assert.ok(all.includes('Cardiovascular risk assessment'), all.join(' | '));
  const long = texts([seg('Supercalifragilisticexpialidocious extraordinarily longwinded phrasing here '.repeat(3))]);
  assert.ok(long.every(t => t.length <= 34));
});

test('there is no repeat in what comes back, and at most the number asked for', () => {
  const words = Array.from({ length: 300 }, (_, i) => seg(`term${i} term${i} alpha${i}`));
  const k = findKeywords(words, { max: 60 });
  assert.equal(k.length, 60);
  assert.equal(new Set(k.map(x => x.text.toLowerCase())).size, 60);
});
