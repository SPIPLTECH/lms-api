const prisma = require("../../config/database");

/**
 * Test-series feedback, switched on per course by Course.testReview
 * ({ enabled, weakThreshold, purchaseUrl, sections: { [moduleId]: { label, course } } }).
 *
 * - After each Final quiz: the subject/topic areas the student scored below
 *   the threshold on in that attempt.
 * - Once every Final quiz in the course is submitted: section scores, the
 *   weakest areas across all of them, and which section's course to take.
 *
 * Areas come from Question.subject / Question.topic. An unanswered question
 * counts as not correct.
 */

const DEFAULT_THRESHOLD = 40;
const QUIZ_WEAK_AREA_LIMIT = 5;
const COURSE_WEAK_AREA_LIMIT = 6;

/** The course's review settings, or null when the course has none switched on. */
const reviewConfigOf = (course) => {
  const config = course?.testReview;
  if (!config || typeof config !== "object" || !config.enabled) return null;
  const threshold = Number(config.weakThreshold);
  return {
    threshold: Number.isFinite(threshold) ? threshold : DEFAULT_THRESHOLD,
    purchaseUrl: typeof config.purchaseUrl === "string" ? config.purchaseUrl : null,
    sections: config.sections && typeof config.sections === "object" ? config.sections : {}
  };
};

const percentOf = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * Correct/total per area. `rows` are { isCorrect, question: { subject, topic } },
 * optionally with `section` (a label) when areas span several sections.
 */
const tallyAreas = (rows) => {
  const areas = new Map();
  for (const row of rows) {
    const subject = row.question?.subject || "General";
    const topic = row.question?.topic || "General";
    const key = [row.section || "", subject, topic].join("\u0000");
    const area = areas.get(key) || { section: row.section || null, subject, topic, correct: 0, total: 0 };
    area.total += 1;
    if (row.isCorrect === true) area.correct += 1;
    areas.set(key, area);
  }
  return [...areas.values()].map((a) => ({ ...a, percentage: percentOf(a.correct, a.total) }));
};

/** Areas below the threshold, weakest first; ties go to the area with more questions. */
const weakestAreas = (areas, threshold, limit) =>
  areas
    .filter((a) => a.percentage < threshold)
    .sort((a, b) => a.percentage - b.percentage || b.total - a.total)
    .slice(0, limit);

/**
 * Weak areas for one attempt of one quiz, or null when the quiz's course has
 * no review switched on, or the quiz is not a Final.
 *
 * @param {object} quiz  with `course.testReview` and `quizQuestions[].question`
 * @param {Array} questionAttempts  this attempt's rows ({ questionId, isCorrect })
 */
const buildQuizWeakAreas = (quiz, questionAttempts) => {
  const config = reviewConfigOf(quiz?.course);
  if (!config || quiz.quizTag !== "FINAL") return null;
  // Read the tags off the quiz's own question set, so attempts rebuilt from
  // stored answers (which carry no question relation) tally the same way.
  const byId = new Map((quiz.quizQuestions || []).map((qq) => [qq.question?.id ?? qq.questionId, qq.question]));
  const rows = (questionAttempts || []).map((qa) => ({ isCorrect: qa.isCorrect, question: byId.get(qa.questionId) }));
  return {
    threshold: config.threshold,
    weakAreas: weakestAreas(tallyAreas(rows), config.threshold, QUIZ_WEAK_AREA_LIMIT)
  };
};

/**
 * The student's whole-course review, or null when the course has no review
 * switched on. Before every Final quiz is submitted it carries only the
 * progress (`completed` / `total`); after, the full review.
 */
const getCourseTestReview = async (studentId, courseId) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true, testReview: true }
  });
  const config = reviewConfigOf(course);
  if (!config) return null;

  const quizzes = await prisma.quiz.findMany({
    where: { courseId, quizTag: "FINAL", isPublished: true },
    select: { id: true, moduleId: true, module: { select: { title: true, order: true } } }
  });
  const attempts = await prisma.quizAttempt.findMany({
    where: { studentId, quizId: { in: quizzes.map((q) => q.id) } },
    orderBy: { attemptNumber: "asc" },
    select: {
      quizId: true,
      score: true,
      totalMarks: true,
      questionAttempts: { select: { isCorrect: true, question: { select: { subject: true, topic: true } } } }
    }
  });

  // A quiz counts from its latest attempt.
  const latestByQuiz = new Map(attempts.map((a) => [a.quizId, a]));
  const base = {
    courseId: course.id,
    courseTitle: course.title,
    threshold: config.threshold,
    completed: latestByQuiz.size,
    total: quizzes.length,
    isComplete: quizzes.length > 0 && latestByQuiz.size === quizzes.length
  };
  if (!base.isComplete) return base;

  const sectionOf = (quiz) => {
    const configured = config.sections[quiz.moduleId] || {};
    return {
      moduleId: quiz.moduleId,
      label: configured.label || quiz.module?.title || "Course",
      course: configured.course || null,
      order: quiz.module?.order ?? 0
    };
  };

  const sections = new Map();
  const rows = [];
  for (const quiz of quizzes) {
    const section = sectionOf(quiz);
    const attempt = latestByQuiz.get(quiz.id);
    const entry = sections.get(section.moduleId) || { ...section, score: 0, totalMarks: 0 };
    entry.score += attempt.score;
    entry.totalMarks += attempt.totalMarks;
    sections.set(section.moduleId, entry);
    for (const qa of attempt.questionAttempts) rows.push({ ...qa, section: section.label });
  }

  const sectionResults = [...sections.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ moduleId, label, course: sectionCourse, score, totalMarks }) => {
      // Negative marking can take a section below zero; the review reports 0.
      const percentage = Math.max(0, percentOf(score, totalMarks));
      return { moduleId, label, course: sectionCourse, percentage, weak: percentage < config.threshold };
    });

  // The weak sections' courses; with none weak, the lower-scoring section's
  // course as a way to improve further.
  const weakSections = sectionResults.filter((s) => s.weak);
  const recommended = weakSections.length
    ? weakSections.map((s) => ({ ...s, reason: "WEAK" }))
    : [...sectionResults].sort((a, b) => a.percentage - b.percentage).slice(0, 1).map((s) => ({ ...s, reason: "IMPROVE" }));

  return {
    ...base,
    purchaseUrl: config.purchaseUrl,
    sections: sectionResults,
    weakAreas: weakestAreas(tallyAreas(rows), config.threshold, COURSE_WEAK_AREA_LIMIT),
    recommendations: recommended.map(({ moduleId, label, course: sectionCourse, percentage, reason }) => ({
      moduleId,
      label,
      course: sectionCourse,
      percentage,
      reason
    }))
  };
};

/**
 * Sends the student one notification when their review unlocks. Safe to call
 * after every submission: it does nothing until the last Final quiz is in,
 * and the eventId keeps it to one notification per student and course.
 */
const notifyTestReviewUnlocked = async (studentId, courseId, notificationService) => {
  const review = await getCourseTestReview(studentId, courseId);
  if (!review?.isComplete) return;
  const student = await prisma.studentProfile.findUnique({ where: { id: studentId }, select: { userId: true } });
  if (!student) return;
  await notificationService.createNotification(student.userId, {
    title: "Your Test Series review is ready 📊",
    message: `You have finished all ${review.total} tests in "${review.courseTitle}". See your weak areas and what to study next.`,
    type: "TEST_REVIEW",
    link: `/student/courses/${courseId}`,
    eventId: `test_review_${courseId}_${studentId}`
  });
};

module.exports = {
  buildQuizWeakAreas,
  getCourseTestReview,
  notifyTestReviewUnlocked
};
