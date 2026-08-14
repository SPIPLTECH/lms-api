const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateSubmissionResult } = require('../src/modules/quizzes/quiz.service');

const createMockQuiz = (questionsData) => {
  return {
    passingScore: 50,
    quizQuestions: questionsData.map((q, index) => ({
      id: `qq${index}`,
      order: index + 1,
      marks: q.marks,
      question: {
        id: q.id,
        type: q.type,
        correctAnswer: q.correctAnswer,
        negativeMarks: q.negativeMarks
      }
    }))
  };
};

test('calculateSubmissionResult handles MCQ_SINGLE (one option selected)', () => {
  const quiz = createMockQuiz([
    { id: 'q1', type: 'MCQ_SINGLE', correctAnswer: 'A', marks: 1 }
  ]);

  const correctAnswers = [{ questionId: 'q1', answer: 'A' }];
  const wrongAnswers = [{ questionId: 'q1', answer: 'B' }];

  assert.equal(calculateSubmissionResult(quiz, correctAnswers).score, 1);
  assert.equal(calculateSubmissionResult(quiz, wrongAnswers).score, 0);
});

test('calculateSubmissionResult handles MCQ_MULTI partial marking', () => {
  const quiz = createMockQuiz([
    { id: 'q1', type: 'MCQ_MULTI', correctAnswer: ['A', 'B'], marks: 2 }
  ]);

  const fullyCorrect = [{ questionId: 'q1', answer: ['B', 'A'] }]; 
  const partiallyCorrect = [{ questionId: 'q1', answer: ['A'] }]; 
  const partiallyWrong = [{ questionId: 'q1', answer: ['A', 'C'] }];
  const completelyWrong = [{ questionId: 'q1', answer: ['C', 'D'] }]; 

  assert.equal(calculateSubmissionResult(quiz, fullyCorrect).score, 2);
  assert.equal(calculateSubmissionResult(quiz, partiallyCorrect).score, 1); // 1/2 correct = 50%
  assert.equal(calculateSubmissionResult(quiz, partiallyWrong).score, 0); // (1 correct - 1 incorrect) / 2 = 0
  assert.equal(calculateSubmissionResult(quiz, completelyWrong).score, 0);
});

test('calculateSubmissionResult handles ARRANGE_TOKENS partial marking', () => {
  const quiz = createMockQuiz([
    { id: 'q1', type: 'ARRANGE_TOKENS', correctAnswer: ['first', 'second', 'third'], marks: 3 }
  ]);

  const correctAnswers = [{ questionId: 'q1', answer: ['first', 'second', 'third'] }];
  const partialAnswers = [{ questionId: 'q1', answer: ['first', 'third', 'second'] }]; // only 1 correct index
  const wrongAnswers = [{ questionId: 'q1', answer: ['second', 'third', 'first'] }]; // 0 correct indices

  assert.equal(calculateSubmissionResult(quiz, correctAnswers).score, 3);
  assert.equal(calculateSubmissionResult(quiz, partialAnswers).score, 1);
  assert.equal(calculateSubmissionResult(quiz, wrongAnswers).score, 0);
});

test('calculateSubmissionResult handles MATCH_PAIRS partial marking', () => {
  const quiz = createMockQuiz([
    { id: 'q1', type: 'MATCH_PAIRS', correctAnswer: { 'cat': 'mammal', 'snake': 'reptile' }, marks: 4 }
  ]);

  const correctAnswers = [{ questionId: 'q1', answer: { 'snake': 'reptile', 'cat': 'mammal' } }]; 
  const partialAnswers = [{ questionId: 'q1', answer: { 'cat': 'mammal', 'snake': 'amphibian' } }];
  const wrongAnswers = [{ questionId: 'q1', answer: { 'cat': 'reptile', 'snake': 'mammal' } }]; 

  assert.equal(calculateSubmissionResult(quiz, correctAnswers).score, 4);
  assert.equal(calculateSubmissionResult(quiz, partialAnswers).score, 2); // 1 out of 2 correct = 50%
  assert.equal(calculateSubmissionResult(quiz, wrongAnswers).score, 0);
});

test('calculateSubmissionResult handles negative marks', () => {
  const quiz = createMockQuiz([
    { id: 'q1', type: 'MCQ_SINGLE', correctAnswer: 'A', marks: 4, negativeMarks: 1 },
    { id: 'q2', type: 'MCQ_SINGLE', correctAnswer: 'B', marks: 4, negativeMarks: 1 }
  ]);

  // one correct, one wrong
  const answers = [
    { questionId: 'q1', answer: 'A' },
    { questionId: 'q2', answer: 'C' }
  ];

  const result = calculateSubmissionResult(quiz, answers);
  // q1: 4, q2: -1. Total = 3
  assert.equal(result.score, 3);
});

test('calculateSubmissionResult handles empty submission and undefined answers', () => {
  const quiz = createMockQuiz([
    { id: 'q1', type: 'MCQ_SINGLE', correctAnswer: 'A', marks: 1 },
    { id: 'q2', type: 'MCQ_SINGLE', correctAnswer: 'B', marks: 1 }
  ]);

  assert.equal(calculateSubmissionResult(quiz, []).score, 0);
  assert.equal(calculateSubmissionResult(quiz, undefined).score, 0);
});

test('calculateSubmissionResult handles unlinked quiz (quizQuestions empty or missing)', () => {
  const quizWithoutQuestions = { passingScore: 50, quizQuestions: [] };
  const answers = [{ questionId: 'unlinked_q1', answer: 'A' }];

  const result = calculateSubmissionResult(quizWithoutQuestions, answers);
  assert.equal(result.score, 0);
  assert.equal(result.questionEvidence.length, 0);
});
