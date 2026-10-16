/**
 * THE completion rule for every learning-sequence item.
 *
 * Every consumer — the progress roll-up, ContentProgress sync, server-side
 * locking, the learning sequence the player renders, and the data migration
 * — asks this module, so there is exactly one answer to "is this item done?":
 *
 *   ordinary Content  ContentProgress.completed (the student marks it, or a
 *                     video end marks it)
 *   QUIZ  · FINAL     a passing attempt
 *   QUIZ  · SELF_TEST any attempt (practice: unlimited and untimed, so
 *                     having done it is what counts)
 *   ASSIGNMENT        a submission whose status is Submitted or Graded
 *
 * QUALIFYING quizzes are never sequence items (they are the test that lets a
 * student skip a lesson/topic), so they have no rule here.
 */

const ASSIGNMENT_COMPLETED_STATUSES = ["Submitted", "Graded"];

const QUIZ_COMPLETION = Object.freeze({ PASS: "PASS", ATTEMPT: "ATTEMPT" });

/** What a quiz of this tag needs before it counts as complete. */
function quizCompletionRequirement(quizTag) {
  return quizTag === "SELF_TEST" ? QUIZ_COMPLETION.ATTEMPT : QUIZ_COMPLETION.PASS;
}

/**
 * Folds one student's attempts at one quiz into the two facts the rule needs.
 *
 * @param {Array<{passed?: boolean}>} attempts QuizAttempt rows
 * @param {{passed?: boolean, percentage?: number}|null} latestSubmission the
 *   QuizSubmission row (the latest attempt; the only record for attempts that
 *   predate the QuizAttempt log)
 * @param {number} passingScore
 */
function summarizeQuizAttempts(attempts = [], latestSubmission = null, passingScore = 0) {
  const attempted = attempts.length > 0 || Boolean(latestSubmission);
  const passed =
    attempts.some((attempt) => attempt.passed === true) ||
    latestSubmission?.passed === true ||
    (typeof latestSubmission?.percentage === "number" && latestSubmission.percentage >= (passingScore || 0));
  return { attempted, passed };
}

/** Whether a quiz is complete for a student, given what summarizeQuizAttempts found. */
function isQuizComplete(quizTag, { attempted, passed }) {
  return quizCompletionRequirement(quizTag) === QUIZ_COMPLETION.ATTEMPT ? Boolean(attempted) : Boolean(passed);
}

/** Whether an assignment submission completes its assignment. */
function isAssignmentSubmissionComplete(submission) {
  return Boolean(submission) && ASSIGNMENT_COMPLETED_STATUSES.includes(submission.status);
}

/** The student-facing sentence for what is still required. */
function completionHint(kind, quizTag) {
  if (kind === "QUIZ") {
    return quizCompletionRequirement(quizTag) === QUIZ_COMPLETION.ATTEMPT
      ? "Attempt this quiz to complete it."
      : "Pass this quiz to complete it.";
  }
  if (kind === "ASSIGNMENT") return "Submit your assignment to complete it.";
  return "Mark this item complete to continue.";
}

module.exports = {
  ASSIGNMENT_COMPLETED_STATUSES,
  QUIZ_COMPLETION,
  quizCompletionRequirement,
  summarizeQuizAttempts,
  isQuizComplete,
  isAssignmentSubmissionComplete,
  completionHint,
};
