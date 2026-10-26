'use strict';

// Request validation for the evaluation endpoints. No database.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  rubricSchema, acceptSchema, overrideSchema, reEvaluateSchema,
} = require('../assignmentEvaluation.validation');

const validRubric = {
  idealAnswer: 'Chlorophyll absorbs light energy.',
  maxMarks: 2,
  markStep: 0.5,
  criteria: [{ description: 'Chlorophyll absorbs light', marks: 2, keywords: ['chlorophyll', 'light'] }],
};
const check = (schema, value) => schema.validate(value, { abortEarly: true, stripUnknown: true });

test('rubric: total marks are a whole number, because they become the assignment\'s marks', () => {
  assert.equal(check(rubricSchema, validRubric).error, undefined);
  assert.match(check(rubricSchema, { ...validRubric, maxMarks: 7.5 }).error.message, /whole number/);
  assert.ok(check(rubricSchema, { ...validRubric, maxMarks: 0 }).error);
  assert.ok(check(rubricSchema, { ...validRubric, maxMarks: 1001 }).error);
});

test('rubric: automatic publishing cannot be switched on', () => {
  assert.equal(check(rubricSchema, validRubric).value.autoPublish, false);
  assert.equal(check(rubricSchema, { ...validRubric, autoPublish: false }).error, undefined);
  assert.match(check(rubricSchema, { ...validRubric, autoPublish: true }).error.message, /only after you approve/);
});

test('rubric: ideal answer, mark step and list sizes are enforced', () => {
  assert.match(check(rubricSchema, { ...validRubric, idealAnswer: '  ' }).error.message, /ideal answer is required/);
  assert.ok(check(rubricSchema, { ...validRubric, markStep: 0.3 }).error);
  const many = Array.from({ length: 21 }, (_, i) => ({ description: `c${i}`, marks: 1, keywords: ['x'] }));
  assert.ok(check(rubricSchema, { ...validRubric, criteria: many }).error);
});

test('approve: the evaluation version being approved is required', () => {
  assert.match(check(acceptSchema, {}).error.message, /expectedVersion is required/);
  assert.ok(check(acceptSchema, { expectedVersion: 0 }).error);
  assert.ok(check(acceptSchema, { expectedVersion: 1.5 }).error);
  assert.equal(check(acceptSchema, { expectedVersion: 3, comment: 'Well done' }).error, undefined);
});

test('override: version, reason and marks are required; null version means "not evaluated yet"', () => {
  const base = { expectedVersion: 2, marksAwarded: 4, reason: 'Answer explained it in other words' };
  assert.equal(check(overrideSchema, base).error, undefined);
  assert.equal(check(overrideSchema, { ...base, expectedVersion: null }).error, undefined);
  const { expectedVersion, ...noVersion } = base;
  assert.match(check(overrideSchema, noVersion).error.message, /expectedVersion is required/);
  assert.match(check(overrideSchema, { ...base, reason: 'ok' }).error.message, /reason/);
  assert.match(check(overrideSchema, { expectedVersion: 2, reason: 'Long enough reason' }).error.message, /criterion marks or a total/);
  assert.ok(check(overrideSchema, { ...base, marksAwarded: -1 }).error);
  assert.equal(check(overrideSchema, {
    expectedVersion: 2, reason: 'Per point', criteria: [{ criterionId: 'c1', awarded: 1.5 }],
  }).error, undefined);
});

test('re-evaluate: reopening a graded submission must be asked for explicitly', () => {
  assert.equal(check(reEvaluateSchema, {}).value.reopen, false);
  assert.equal(check(reEvaluateSchema, { reopen: true }).value.reopen, true);
  assert.ok(check(reEvaluateSchema, { reopen: 'yes please' }).error);
});
