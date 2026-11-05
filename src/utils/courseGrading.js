/**
 * Centralized Course Assessment and Grading Engine for Orange Tree LMS.
 *
 * Implements the approved course-level grading policy:
 * - Includes all published, active FINAL quizzes belonging to the course (course-level and across all modules).
 * - Excludes SELF_TEST and QUALIFYING quizzes.
 * - Excludes assignments from numerical course score calculation.
 * - Computes weighted-by-marks aggregate percentage:
 *     Course Score (%) = (Sum of marks obtained across all FINAL quizzes / Sum of maximum possible marks across all FINAL quizzes) * 100
 * - Clamps percentage between 0 and 100, rounded to the nearest integer.
 * - Derives authoritative letter grade from the centralized grade scale:
 *     90–100: A+ (Distinction)
 *     80–89:  A  (Excellent)
 *     70–79:  B  (Very Good)
 *     60–69:  C  (Good)
 *     50–59:  D  (Pass)
 *     Below 50: F (Needs Improvement)
 * - Edge case handling:
 *     Courses with no FINAL quizzes -> score = null, grade = "Completed", description = "Successfully completed all curriculum requirements".
 *     Quizzes with 0 total marks are excluded to prevent division by zero.
 */

const GRADE_SCALE = [
  { min: 90, max: 100, grade: "A+", description: "Distinction" },
  { min: 80, max: 89,  grade: "A",  description: "Excellent" },
  { min: 70, max: 79,  grade: "B",  description: "Very Good" },
  { min: 60, max: 69,  grade: "C",  description: "Good" },
  { min: 50, max: 59,  grade: "D",  description: "Pass" },
  { min: 0,  max: 49,  grade: "F",  description: "Needs Improvement" },
];

/**
 * Derives the letter grade and performance description from a numeric percentage.
 *
 * @param {number|null|undefined} percentage - Integer 0..100, or null if unassessed
 * @returns {{ grade: string, description: string }}
 */
function deriveGradeFromPercentage(percentage) {
  if (percentage === null || percentage === undefined || isNaN(percentage)) {
    return {
      grade: "Completed",
      description: "Successfully completed all curriculum requirements",
    };
  }

  const rounded = Math.round(Number(percentage));
  const clamped = Math.max(0, Math.min(100, rounded));

  for (const tier of GRADE_SCALE) {
    if (clamped >= tier.min && clamped <= tier.max) {
      return {
        grade: tier.grade,
        description: tier.description,
      };
    }
  }

  return {
    grade: "F",
    description: "Needs Improvement",
  };
}

/**
 * Calculates the course-level score and grade from eligible FINAL quizzes and student submissions.
 *
 * @param {Object} params
 * @param {Array<Object>} params.finalQuizzes - List of eligible FINAL quizzes
 * @param {Array<Object>} params.quizSubmissions - Student's submissions for those quizzes
 * @returns {Object} Grading summary
 */
function calculateCourseGrade({ finalQuizzes = [], quizSubmissions = [] }) {
  if (!Array.isArray(finalQuizzes) || finalQuizzes.length === 0) {
    return {
      score: null,
      grade: "Completed",
      performanceDescription: "Successfully completed all curriculum requirements",
      totalMarksObtained: 0,
      totalPossibleMarks: 0,
      eligibleQuizCount: 0,
      submittedQuizCount: 0,
      hasAssessments: false,
    };
  }

  // Create submission map by quizId
  const submissionMap = new Map();
  if (Array.isArray(quizSubmissions)) {
    for (const sub of quizSubmissions) {
      if (sub && sub.quizId) {
        submissionMap.set(sub.quizId, sub);
      }
    }
  }

  let totalMarksObtained = 0;
  let totalPossibleMarks = 0;
  let validQuizCount = 0;
  let submittedQuizCount = 0;

  for (const quiz of finalQuizzes) {
    if (!quiz || !quiz.id) continue;

    // Filter out non-FINAL or non-published if caller didn't pre-filter
    if (quiz.quizTag && quiz.quizTag !== "FINAL") continue;
    if (quiz.isPublished === false || quiz.status === "ARCHIVED") continue;

    const submission = submissionMap.get(quiz.id);

    // Determine max marks for this quiz
    let quizMaxMarks = 0;
    if (submission && typeof submission.totalMarks === "number" && submission.totalMarks > 0) {
      quizMaxMarks = submission.totalMarks;
    } else if (Array.isArray(quiz.quizQuestions) && quiz.quizQuestions.length > 0) {
      quizMaxMarks = quiz.quizQuestions.reduce((sum, qq) => {
        const m = qq.marks !== undefined && qq.marks !== null ? Number(qq.marks) : (qq.question?.marks ?? 1);
        return sum + (m > 0 ? m : 1);
      }, 0);
    } else if (typeof quiz.totalMarks === "number" && quiz.totalMarks > 0) {
      quizMaxMarks = quiz.totalMarks;
    }

    // Exclude zero-mark quizzes from division to prevent division by zero
    if (quizMaxMarks <= 0) continue;

    validQuizCount++;

    if (submission) {
      submittedQuizCount++;
      // Score obtained cannot be negative in the aggregate pool
      const obtained = Math.max(0, Number(submission.score ?? 0));
      totalMarksObtained += obtained;
      totalPossibleMarks += quizMaxMarks;
    } else {
      // Unsubmitted quiz counts as 0 obtained out of its full possible marks
      totalPossibleMarks += quizMaxMarks;
    }
  }

  if (totalPossibleMarks <= 0 || validQuizCount === 0) {
    return {
      score: null,
      grade: "Completed",
      performanceDescription: "Successfully completed all curriculum requirements",
      totalMarksObtained: 0,
      totalPossibleMarks: 0,
      eligibleQuizCount: 0,
      submittedQuizCount: 0,
      hasAssessments: false,
    };
  }

  const rawPercentage = (totalMarksObtained / totalPossibleMarks) * 100;
  const clampedPercentage = Math.max(0, Math.min(100, rawPercentage));
  const roundedScore = Math.round(clampedPercentage);

  const gradeInfo = deriveGradeFromPercentage(roundedScore);

  return {
    score: roundedScore,
    grade: gradeInfo.grade,
    performanceDescription: gradeInfo.description,
    totalMarksObtained,
    totalPossibleMarks,
    eligibleQuizCount: validQuizCount,
    submittedQuizCount,
    hasAssessments: true,
  };
}

/**
 * Loads eligible FINAL quizzes and submissions for a student in a course, and computes the grade.
 *
 * @param {Object} prismaClient - Prisma client or transaction instance
 * @param {string} studentId
 * @param {string} courseId
 * @returns {Promise<Object>}
 */
async function computeCourseGradeForStudent(prismaClient, studentId, courseId) {
  const finalQuizzes = await prismaClient.quiz.findMany({
    where: {
      courseId,
      isPublished: true,
      quizTag: "FINAL",
      status: "ACTIVE",
    },
    include: {
      quizQuestions: {
        select: {
          marks: true,
          question: { select: { marks: true } },
        },
      },
    },
  });

  const quizIds = finalQuizzes.map((q) => q.id);

  const quizSubmissions = quizIds.length > 0
    ? await prismaClient.quizSubmission.findMany({
        where: {
          studentId,
          quizId: { in: quizIds },
        },
        select: {
          quizId: true,
          score: true,
          totalMarks: true,
          percentage: true,
          passed: true,
        },
      })
    : [];

  return calculateCourseGrade({ finalQuizzes, quizSubmissions });
}

module.exports = {
  GRADE_SCALE,
  deriveGradeFromPercentage,
  calculateCourseGrade,
  computeCourseGradeForStudent,
};
