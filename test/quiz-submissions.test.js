const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateSubmissionResult } = require('../src/modules/quizzes/quiz.service');

test('calculateSubmissionResult returns score, percentage and pass status from answers', () => {
  const quiz = {
    id: 'quiz-1',
    passingScore: 70,
    questions: [
      { id: 'q1', correctAnswer: 'A', marks: 2 },
      { id: 'q2', correctAnswer: 'B', marks: 3 },
      { id: 'q3', correctAnswer: 'C', marks: 5 }
    ]
  };

  const answers = [
    { questionId: 'q1', selectedOption: 'A' },
    { questionId: 'q2', selectedOption: 'X' },
    { questionId: 'q3', selectedOption: 'C' }
  ];

  const result = calculateSubmissionResult(quiz, answers);

  assert.equal(result.score, 7);
  assert.equal(result.totalMarks, 10);
  assert.equal(result.percentage, 70);
  assert.equal(result.passed, true);
});
