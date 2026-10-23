'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../engine/normalization/normalizer');
const { SynonymDictionary } = require('../engine/synonyms/synonymDictionary');
const { matchKeyword } = require('../engine/keywords/keywordMatcher');
const { matchPhrase } = require('../engine/phrases/phraseMatcher');
const { TfidfModel, termsFromTokens } = require('../engine/similarity/tfidf');

const dict = new SynonymDictionary([['carbon dioxide', 'co2'], ['glucose', 'sugar']]);
const kw = (keyword, text) => matchKeyword(keyword, analyze(text, { synonyms: dict }), dict);
const ph = (phrase, text) => matchPhrase(phrase, analyze(text, { synonyms: dict }), dict);

test('keyword: exact match across inflections', () => {
  const r = kw('absorb', 'Chlorophyll absorbed the light');
  assert.equal(r.matchType, 'exact');
  assert.equal(r.score, 1);
});

test('keyword: synonym match is reported as synonym with full weight', () => {
  const r = kw('carbon dioxide', 'Leaves take in CO2');
  assert.equal(r.matchType, 'synonym');
  assert.equal(r.score, 1);
});

test('keyword: multi-word keyword matches with words in between at reduced weight', () => {
  const r = kw('chemical energy', 'energy that is stored in chemical bonds');
  assert.equal(r.matchType, 'proximity');
  assert.ok(r.score < 1 && r.score > 0.5);
});

test('keyword: misspelling of a long word is tolerated at reduced weight', () => {
  const r = kw('photosynthesis', 'Photosynthsis happens in leaves');
  assert.equal(r.matchType, 'fuzzy');
  assert.equal(r.score, 0.8);
});

test('keyword: short words are never fuzzy-matched', () => {
  assert.equal(kw('form', 'they are from the leaf').score, 0);
});

test('keyword: negated occurrence is a contradiction, not a match', () => {
  const r = kw('oxygen', 'Photosynthesis does not release oxygen');
  assert.equal(r.score, 0);
  assert.equal(r.contradicted, true);
  assert.match(r.matchedText, /not release oxygen/);
});

test('keyword: a negative keyword expects a negated occurrence', () => {
  assert.equal(kw('without oxygen', 'Anaerobic respiration happens without oxygen').score, 1);
  assert.equal(kw('without oxygen', 'Anaerobic respiration uses oxygen').contradicted, true);
});

test('keyword: affirming and denying the same keyword is mixed polarity', () => {
  const r = kw('oxygen', 'Plants release oxygen. Plants do not release oxygen.');
  assert.equal(r.score, 1);
  assert.equal(r.mixedPolarity, true);
});

test('phrase: same words in the same order score 1', () => {
  assert.equal(ph('converts light energy into chemical energy', 'It converts light energy into chemical energy').score, 1);
});

test('phrase: passive rewording keeps most of the ordered overlap', () => {
  const r = ph('converts light energy into chemical energy', 'Light energy is converted into chemical energy');
  assert.ok(r.score >= 0.75, `score ${r.score}`);
  assert.equal(r.orderMismatch, false);
});

test('phrase: reversed relationship is flagged as an order mismatch', () => {
  const r = ph('converts light energy into chemical energy', 'It converts chemical energy into light energy');
  assert.equal(r.orderMismatch, true);
  assert.ok(r.score <= 0.6);
});

test('phrase: negated statement is a contradiction', () => {
  const r = ph('chlorophyll absorbs light', 'Chlorophyll does not absorb light');
  assert.equal(r.contradicted, true);
  assert.equal(r.score, 0);
});

test('tfidf: identical texts score 1, unrelated texts score 0', () => {
  const t = (s) => termsFromTokens(analyze(s).tokens);
  const a = t('Plants make glucose from carbon dioxide');
  const b = t('The French revolution began in 1789');
  const model = new TfidfModel([a, b]);
  assert.ok(Math.abs(model.similarity(a, a) - 1) < 1e-9);
  assert.equal(model.similarity(a, b), 0);
});

test('tfidf: a negated statement is less similar than the affirmed one', () => {
  const t = (s) => termsFromTokens(analyze(s).tokens);
  const ref = t('plants need light');
  const model = new TfidfModel([ref]);
  assert.ok(model.similarity(ref, t('plants do not need light')) < model.similarity(ref, t('plants really need light')));
});
