const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateSubmissionResult } = require('../src/modules/quizzes/quiz.service');

test('calculateSubmissionResult handles MCQ_SINGLE (one option selected)', () => {
  const quiz = {
    passingScore: 50,
    questions: [
      { id: 'q1', type: 'MCQ_SINGLE', correctAnswer: 'A', marks: 1 }
    ]
  };

  const correctAnswers = [{ questionId: 'q1', selectedOption: 'A' }];
  const wrongAnswers = [{ questionId: 'q1', selectedOption: 'B' }];

  assert.equal(calculateSubmissionResult(quiz, correctAnswers).score, 1);
  assert.equal(calculateSubmissionResult(quiz, wrongAnswers).score, 0);
});

test('calculateSubmissionResult handles MCQ_MULTI (multiple options selected)', () => {
  const quiz = {
    passingScore: 50,
    questions: [
      { id: 'q1', type: 'MCQ_MULTI', correctAnswer: ['A', 'B'], marks: 2 }
    ]
  };

  const correctAnswers = [{ questionId: 'q1', selectedOption: ['B', 'A'] }]; // order shouldn't matter
  const wrongAnswers1 = [{ questionId: 'q1', selectedOption: ['A'] }]; // incomplete
  const wrongAnswers2 = [{ questionId: 'q1', selectedOption: ['A', 'C'] }]; // incorrect option

  assert.equal(calculateSubmissionResult(quiz, correctAnswers).score, 2);
  assert.equal(calculateSubmissionResult(quiz, wrongAnswers1).score, 0);
  assert.equal(calculateSubmissionResult(quiz, wrongAnswers2).score, 0);
});

test('calculateSubmissionResult handles ARRANGE_TOKENS (arrangement/rearrange)', () => {
  const quiz = {
    passingScore: 50,
    questions: [
      { id: 'q1', type: 'ARRANGE_TOKENS', correctAnswer: ['first', 'second', 'third'], marks: 3 }
    ]
  };

  const correctAnswers = [{ questionId: 'q1', selectedOption: ['first', 'second', 'third'] }];
  const wrongAnswers = [{ questionId: 'q1', selectedOption: ['second', 'first', 'third'] }]; // order matters

  assert.equal(calculateSubmissionResult(quiz, correctAnswers).score, 3);
  assert.equal(calculateSubmissionResult(quiz, wrongAnswers).score, 0);
});

test('calculateSubmissionResult handles MATCH_PAIRS (connect options from different columns/tables)', () => {
  const quiz = {
    passingScore: 50,
    questions: [
      { id: 'q1', type: 'MATCH_PAIRS', correctAnswer: { 'cat': 'mammal', 'snake': 'reptile' }, marks: 4 }
    ]
  };

  const correctAnswers = [{ questionId: 'q1', selectedOption: { 'snake': 'reptile', 'cat': 'mammal' } }]; // key order shouldn't matter
  const wrongAnswers1 = [{ questionId: 'q1', selectedOption: { 'cat': 'reptile', 'snake': 'mammal' } }]; // wrong mapping
  const wrongAnswers2 = [{ questionId: 'q1', selectedOption: { 'cat': 'mammal' } }]; // missing mapping
  const wrongAnswersKeyMismatch = [{ questionId: 'q1', selectedOption: { 'cat': 'mammal', 'dog': 'reptile' } }]; // key mismatch

  assert.equal(calculateSubmissionResult(quiz, correctAnswers).score, 4);
  assert.equal(calculateSubmissionResult(quiz, wrongAnswers1).score, 0);
  assert.equal(calculateSubmissionResult(quiz, wrongAnswers2).score, 0);
  assert.equal(calculateSubmissionResult(quiz, wrongAnswersKeyMismatch).score, 0);
});
