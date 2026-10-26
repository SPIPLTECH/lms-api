'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeText, analyze, splitSentences } = require('../engine/normalization/normalizer');
const { stem } = require('../engine/normalization/stemmer');
const { SynonymDictionary } = require('../engine/synonyms/synonymDictionary');

test('stemmer follows the Porter algorithm on reference words', () => {
  const cases = {
    caresses: 'caress', ponies: 'poni', cats: 'cat', agreed: 'agre', plastered: 'plaster',
    motoring: 'motor', hopping: 'hop', relational: 'relat', conditional: 'condit',
    generalization: 'gener', electrical: 'electr', adjustment: 'adjust', controlling: 'control',
    absorbs: 'absorb', absorbed: 'absorb', absorbing: 'absorb',
  };
  for (const [word, expected] of Object.entries(cases)) assert.equal(stem(word), expected, word);
  assert.equal(stem('co2'), 'co2', 'tokens with digits are not stemmed');
});

test('normalizeText folds case, unicode, contractions and hyphens', () => {
  assert.equal(normalizeText('CO₂ isn’t Light-Dependent'), 'co2 is not light dependent');
  assert.equal(normalizeText("Plants can't and won't"), 'plants can not and will not');
  assert.equal(normalizeText('It cannot'), 'it can not');
  assert.equal(normalizeText(null), '');
});

test('splitSentences keeps decimals intact', () => {
  assert.deepEqual(splitSentences('g is 9.8 m/s2. It points down! Really?'), ['g is 9.8 m/s2', 'It points down', 'Really']);
});

test('analyze marks negated tokens within the same clause only', () => {
  const a = analyze('Plants do not need sunlight, but they need water.');
  const byWord = Object.fromEntries(a.tokens.map((t) => [t.surface, t]));
  assert.equal(byWord.sunlight.negated, true);
  assert.equal(byWord.water.negated, false, 'comma and "but" end the negation scope');
  assert.equal(byWord.not.isNegator, true);
});

test('double negation cancels out', () => {
  const a = analyze('Plants cannot make food without sunlight');
  const sunlight = a.tokens.find((t) => t.surface === 'sunlight');
  assert.equal(sunlight.negated, false);
});

test('"not only" is not treated as negation', () => {
  const a = analyze('It is not only green but also absorbs light');
  assert.equal(a.tokens.find((t) => t.surface === 'green').negated, false);
});

test('synonym dictionary collapses multi-word terms to one canonical token', () => {
  const dict = new SynonymDictionary([['carbon dioxide', 'co2']]);
  const a = analyze('Plants absorb CO2', { synonyms: dict });
  const b = analyze('Plants absorb carbon dioxide', { synonyms: dict });
  assert.deepEqual(a.content.map((t) => t.canon), b.content.map((t) => t.canon));
  assert.equal(a.content.at(-1).viaSynonym, true);
});

test('unrelated groups keep separate canonical tokens', () => {
  const dict = new SynonymDictionary([['light', 'sunlight'], ['heavy', 'weighty']]);
  const a = analyze('sunlight', { synonyms: dict });
  const b = analyze('weighty', { synonyms: dict });
  assert.notEqual(a.content[0].canon, b.content[0].canon);
});

test('extend() lets question synonyms join an existing global group', () => {
  const dict = new SynonymDictionary([['carbon dioxide', 'co2']]).extend([['carbon dioxide', 'carbonic gas']]);
  const a = analyze('carbonic gas', { synonyms: dict });
  const b = analyze('co2', { synonyms: dict });
  assert.equal(a.content[0].canon, b.content[0].canon);
});
