/** Never includes correctAnswerIndex/explanation — the answer key must never reach the client before submission. */
const toQuestionForStudent = (q) => ({
  id: q.id,
  concept: q.concept,
  difficulty: q.difficulty,
  question: q.question,
  options: q.options,
});

const toResultFields = (row) => ({
  overallScore: row.overallScore,
  knowledgeLevel: row.knowledgeLevel,
  confidenceScore: row.confidenceScore,
  conceptScores: row.conceptScores,
  strongConcepts: row.strongConcepts,
  weakConcepts: row.weakConcepts,
  questions: (row.questions || []).map((q) => ({
    id: q.id,
    concept: q.concept,
    difficulty: q.difficulty,
    question: q.question,
    options: q.options,
    correctAnswerIndex: q.correctAnswerIndex,
    explanation: q.explanation,
    selectedIndex: row.answers?.[q.id] ?? null,
    isCorrect: row.answers?.[q.id] === q.correctAnswerIndex,
  })),
  submittedAt: row.submittedAt,
  evaluatedAt: row.evaluatedAt,
});

/** GET /assessment/entry/:courseId and POST .../generate — the answer key is withheld until EVALUATED. */
const toEntryAssessmentForStudent = (row) => ({
  id: row.id,
  studentId: row.studentId,
  courseId: row.courseId,
  status: row.status,
  model: row.model,
  failureReason: row.failureReason,
  questions: row.status === "READY" ? (row.questions || []).map(toQuestionForStudent) : undefined,
  generatedAt: row.generatedAt,
  ...(row.status === "EVALUATED" ? toResultFields(row) : {}),
});

/** POST .../submit and GET .../result — full result including the answer key, only once evaluated. */
const toEntryAssessmentResultResponse = (row) => ({
  id: row.id,
  studentId: row.studentId,
  courseId: row.courseId,
  status: row.status,
  ...toResultFields(row),
});

module.exports = { toEntryAssessmentForStudent, toEntryAssessmentResultResponse };
