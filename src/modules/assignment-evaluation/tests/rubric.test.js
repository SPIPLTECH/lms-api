'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateQuestion, allocateUnits, RubricError } = require('../engine/scoring/rubric');
const { assertEvaluationInvariants, EvaluationIntegrityError } = require('../engine/scoring/invariants');
const { marksForSatisfaction } = require('../engine/scoring/marks');
const { DEFAULT_POLICY } = require('../engine/scoring/scoringPolicy');
const { photosynthesis } = require('./fixtures');

test('criterion marks must add up to the question maximum', () => {
  const q = { ...photosynthesis, criteria: photosynthesis.criteria.map((c) => ({ ...c, marks: 2 })) };
  assert.throws(() => validateQuestion(q), RubricError);
});

test('maxMarks and criterion marks must sit on the mark step', () => {
  assert.throws(() => validateQuestion({ ...photosynthesis, maxMarks: 5.25, criteria: [] }), /multiple of markStep/);
  assert.throws(() => validateQuestion({ ...photosynthesis, markStep: 0.3, criteria: [] }), /markStep must be one of/);
});

test('every criterion needs a keyword or phrase', () => {
  const q = { ...photosynthesis, criteria: [{ description: 'x', marks: 5, keywords: [], phrases: [] }] };
  assert.throws(() => validateQuestion(q), /at least one keyword or phrase/);
});

test('minKeywords must not exceed the number of keywords', () => {
  const q = { ...photosynthesis, criteria: [{ description: 'x', marks: 5, keywords: ['a1b'], minKeywords: 2 }] };
  assert.throws(() => validateQuestion(q), /minKeywords/);
});

test('allocateUnits gives every group a share and preserves the total', () => {
  assert.deepEqual(allocateUnits([1, 1, 1], 3), [1, 1, 1]);
  const a = allocateUnits([10, 5, 1], 10);
  assert.equal(a.reduce((x, y) => x + y, 0), 10);
  assert.ok(a.every((u) => u >= 1));
  assert.ok(a[0] > a[2]);
});

test('partial satisfaction never rounds to full or to zero marks', () => {
  const p = DEFAULT_POLICY;
  assert.equal(marksForSatisfaction(0.84, 2, 0.5, p), 1.5);
  assert.equal(marksForSatisfaction(0.36, 1, 0.5, p), 0.5);
  assert.equal(marksForSatisfaction(0.2, 1, 0.5, p), 0);
  assert.equal(marksForSatisfaction(0.9, 1, 0.5, p), 1);
  assert.equal(marksForSatisfaction(0.6, 0.5, 0.5, p), 0.5);
});

test('integrity check rejects marks above the maximum or off the mark step', () => {
  const base = { maxMarks: 2, markStep: 0.5, confidence: 0.9, criteria: [{ description: 'a', maxMarks: 2, awarded: 2 }] };
  assert.doesNotThrow(() => assertEvaluationInvariants({ ...base, marksAwarded: 2 }));
  assert.throws(() => assertEvaluationInvariants({ ...base, marksAwarded: 2.5 }), EvaluationIntegrityError);
  assert.throws(() => assertEvaluationInvariants({ ...base, marksAwarded: 1.3 }), EvaluationIntegrityError);
  assert.throws(() => assertEvaluationInvariants({ ...base, marksAwarded: Number.NaN }), EvaluationIntegrityError);
  assert.throws(() => assertEvaluationInvariants({
    ...base, marksAwarded: 2, criteria: [{ description: 'a', maxMarks: 2, awarded: 3 }],
  }), EvaluationIntegrityError);
});
