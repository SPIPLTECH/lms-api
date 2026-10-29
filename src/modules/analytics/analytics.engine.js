/**
 * Analytics engine — pure. Grouped query results in, one metrics object per
 * course (and one for the platform) out. Read-only by design, as in the
 * original agent: it measures, it never decides or recommends.
 */

const round1 = (value) => (value === null || value === undefined ? null : Math.round(value * 10) / 10);
const pct = (part, whole) => (whole ? round1((part / whole) * 100) : null);

const EMPTY_RISK = Object.freeze({ NEW: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 });

/**
 * @param {{
 *   courses: {id: string, title: string, status: string, category: string|null, creatorId: string, createdAt: Date}[],
 *   enrollments: Map<string, {count: number, avgProgress: number|null}>,
 *   completions: Map<string, number>,
 *   newEnrollments: Map<string, number>,
 *   quizAverages: Map<string, number>,
 *   health: Map<string, {riskCounts: object, activeLearners7d: number, avgEngagement: number|null}>,
 * }} input
 * @returns {{courseId: string, metrics: object}[]}
 */
function buildCourseMetrics({ courses, enrollments, completions, newEnrollments, quizAverages, health }) {
  return courses.map((course) => {
    const enrolled = enrollments.get(course.id)?.count ?? 0;
    const h = health.get(course.id);
    const riskCounts = { ...EMPTY_RISK, ...(h?.riskCounts ?? {}) };
    const atRisk = riskCounts.HIGH + riskCounts.CRITICAL;
    return {
      courseId: course.id,
      metrics: {
        title: course.title,
        status: course.status,
        category: course.category ?? null,
        creatorId: course.creatorId,
        createdAt: course.createdAt,
        enrolled,
        newEnrollments7d: newEnrollments.get(course.id) ?? 0,
        completed: completions.get(course.id) ?? 0,
        completionRate: pct(completions.get(course.id) ?? 0, enrolled),
        avgProgress: round1(enrollments.get(course.id)?.avgProgress ?? null),
        avgQuizScore30d: round1(quizAverages.get(course.id) ?? null),
        activeLearners7d: h?.activeLearners7d ?? 0,
        avgEngagement: round1(h?.avgEngagement ?? null),
        riskCounts,
        atRiskLearners: atRisk,
        atRiskPercent: pct(atRisk, enrolled),
      },
    };
  });
}

/**
 * @param {{usersByRole: Record<string, number>, publishedCourses: number, enrollments: number,
 *          newEnrollments7d: number, completions30d: number, aiMessages7d: number,
 *          learners: {activeLearners7d: number|null, atRiskLearners: number|null}}} input
 */
function buildPlatformMetrics({ usersByRole, publishedCourses, enrollments, newEnrollments7d, completions30d, aiMessages7d, learners }) {
  const students = usersByRole.STUDENT ?? 0;
  return {
    students,
    instructors: usersByRole.INSTRUCTOR ?? 0,
    admins: usersByRole.ADMIN ?? 0,
    publishedCourses,
    enrollments,
    newEnrollments7d,
    completions30d,
    activeLearners7d: learners.activeLearners7d,
    activeLearnerPercent: learners.activeLearners7d === null ? null : pct(learners.activeLearners7d, students),
    atRiskLearners: learners.atRiskLearners,
    aiMessages7d,
  };
}

/** Percent change of a metric between two snapshots; null if not comparable. */
function percentChange(current, previous) {
  if (typeof current !== "number" || typeof previous !== "number" || previous === 0) return null;
  return round1(((current - previous) / previous) * 100);
}

module.exports = { buildCourseMetrics, buildPlatformMetrics, percentChange };
