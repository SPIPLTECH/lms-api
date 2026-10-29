/**
 * Admin Intelligence engine — pure. One layer above Analytics, as in the
 * original agent: it reads Analytics' already-computed course/platform
 * metrics and turns them into institution health, department and faculty
 * views, and alerts. It never re-derives what Analytics measured.
 *
 * "Department" is Course.category (the only institutional grouping this LMS
 * has) and "Faculty" is the course's instructor — the original's own
 * resolution of those gaps.
 */

const T = Object.freeze({
  // Original thresholds.
  RISK_SURGE_COUNT: 10,
  DEPARTMENT_ALERT_BELOW: 40,
  // New (no original equivalent existed for these data).
  RISK_SURGE_PERCENT: 20,
  COURSE_AT_RISK_PERCENT: 30,
  COURSE_AT_RISK_MIN_LEARNERS: 5,
  LOW_COMPLETION_PERCENT: 20,
  LOW_COMPLETION_MIN_ENROLLED: 10,
  LOW_COMPLETION_MIN_AGE_DAYS: 30,
  ENGAGEMENT_DROP_PERCENT: 20,
  HEALTH_GOOD_AT: 70,
  HEALTH_FAIR_AT: 40,
});

const DAY_MS = 86_400_000;
const round = (v) => (v === null || v === undefined ? null : Math.round(v));

/**
 * Health (0-100) of a set of courses, weighted by enrolment:
 * 0.4 x progress + 0.3 x (100 - at-risk %) + 0.3 x engagement. Terms with no
 * data are dropped and the rest renormalised.
 */
function healthOf(courses) {
  const withLearners = courses.filter((c) => (c.enrolled ?? 0) > 0);
  const learners = withLearners.reduce((s, c) => s + c.enrolled, 0);
  if (!learners) return { score: null, level: null, learners: 0, atRiskPercent: null, avgProgress: null, avgEngagement: null };

  const weighted = (field) => {
    const usable = withLearners.filter((c) => typeof c[field] === "number");
    const w = usable.reduce((s, c) => s + c.enrolled, 0);
    return w ? usable.reduce((s, c) => s + c[field] * c.enrolled, 0) / w : null;
  };
  const atRisk = withLearners.reduce((s, c) => s + (c.atRiskLearners ?? 0), 0);
  const atRiskPercent = (atRisk / learners) * 100;
  const avgProgress = weighted("avgProgress");
  const avgEngagement = weighted("avgEngagement");

  const terms = [
    { value: avgProgress, weight: 0.4 },
    { value: 100 - atRiskPercent, weight: 0.3 },
    { value: avgEngagement, weight: 0.3 },
  ].filter((t) => typeof t.value === "number");
  const total = terms.reduce((s, t) => s + t.weight, 0);
  const score = round(terms.reduce((s, t) => s + t.value * t.weight, 0) / total);

  return {
    score,
    level: score >= T.HEALTH_GOOD_AT ? "GOOD" : score >= T.HEALTH_FAIR_AT ? "FAIR" : "POOR",
    learners,
    atRiskPercent: round(atRiskPercent),
    avgProgress: round(avgProgress),
    avgEngagement: round(avgEngagement),
  };
}

const groupBy = (items, keyFn) => {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
};

/**
 * @param {{
 *   platform: object|null,            // analytics.getPlatformKPIs()
 *   previousPlatform: object|null,    // platform metrics from ~7 days earlier
 *   courses: object[],                // analytics.getCourseKPIsBatch()
 *   instructorNames: Map<string, string>,
 *   now: Date,
 * }} input
 */
function buildDashboard({ platform, previousPlatform, courses, instructorNames, now }) {
  const alerts = [];

  // Institution-wide risk surge (original: 10+ at-risk learners).
  if (platform && typeof platform.atRiskLearners === "number") {
    const share = platform.students ? (platform.atRiskLearners / platform.students) * 100 : 0;
    if (platform.atRiskLearners >= T.RISK_SURGE_COUNT || (platform.atRiskLearners > 0 && share >= T.RISK_SURGE_PERCENT)) {
      alerts.push({
        type: "HIGH_RISK_SURGE",
        severity: "HIGH",
        title: `${platform.atRiskLearners} ${platform.atRiskLearners === 1 ? "learner" : "learners"} at high risk`,
        detail: `${round(share)}% of students are at high or critical risk in at least one course.`,
      });
    }
  }

  // Platform engagement drop vs a week ago.
  if (typeof platform?.activeLearners7d === "number" && typeof previousPlatform?.activeLearners7d === "number" && previousPlatform.activeLearners7d > 0) {
    const change = ((platform.activeLearners7d - previousPlatform.activeLearners7d) / previousPlatform.activeLearners7d) * 100;
    if (change <= -T.ENGAGEMENT_DROP_PERCENT) {
      alerts.push({
        type: "ENGAGEMENT_DROP",
        severity: "MEDIUM",
        title: `Active learners down ${Math.abs(round(change))}% on last week`,
        detail: `${platform.activeLearners7d} active in the last 7 days, compared with ${previousPlatform.activeLearners7d} a week ago.`,
      });
    }
  }

  for (const c of courses) {
    const ageDays = c.createdAt ? (now.getTime() - new Date(c.createdAt).getTime()) / DAY_MS : 0;

    if ((c.enrolled ?? 0) >= T.COURSE_AT_RISK_MIN_LEARNERS && (c.atRiskPercent ?? 0) >= T.COURSE_AT_RISK_PERCENT) {
      alerts.push({
        type: "COURSE_AT_RISK",
        severity: "HIGH",
        courseId: c.courseId,
        title: `${c.title}: ${c.atRiskPercent}% of learners at risk`,
        detail: `${c.atRiskLearners} of ${c.enrolled} learners are at high or critical risk.`,
      });
    }
    if ((c.enrolled ?? 0) >= T.LOW_COMPLETION_MIN_ENROLLED && ageDays >= T.LOW_COMPLETION_MIN_AGE_DAYS && typeof c.completionRate === "number" && c.completionRate < T.LOW_COMPLETION_PERCENT) {
      alerts.push({
        type: "LOW_COMPLETION",
        severity: "MEDIUM",
        courseId: c.courseId,
        title: `${c.title}: ${c.completionRate}% completion`,
        detail: `Only ${c.completed} of ${c.enrolled} learners have completed it.`,
      });
    }
    if (c.status === "PUBLISHED" && (c.enrolled ?? 0) > 0 && (c.activeLearners7d ?? 0) === 0) {
      alerts.push({
        type: "INACTIVE_COURSE",
        severity: "MEDIUM",
        courseId: c.courseId,
        title: `${c.title}: no active learners this week`,
        detail: `${c.enrolled} enrolled, none active in the last 7 days.`,
      });
    }
  }

  const departments = [...groupBy(courses, (c) => c.category || "Uncategorized").entries()]
    .map(([name, list]) => ({ name, courses: list.length, ...healthOf(list) }))
    .sort((a, b) => (b.learners ?? 0) - (a.learners ?? 0));

  for (const d of departments) {
    if (d.score !== null && d.score < T.DEPARTMENT_ALERT_BELOW) {
      alerts.push({
        type: "DEPARTMENT_DECLINE",
        severity: "MEDIUM",
        title: `${d.name}: health ${d.score}/100`,
        detail: `Across ${d.courses} course(s) and ${d.learners} learners — progress ${d.avgProgress ?? "—"}%, at risk ${d.atRiskPercent}%.`,
      });
    }
  }

  const faculty = [...groupBy(courses, (c) => c.creatorId).entries()]
    .map(([instructorId, list]) => {
      const learners = list.reduce((s, c) => s + (c.enrolled ?? 0), 0);
      const completed = list.reduce((s, c) => s + (c.completed ?? 0), 0);
      const atRisk = list.reduce((s, c) => s + (c.atRiskLearners ?? 0), 0);
      return {
        instructorId,
        name: instructorNames.get(instructorId) ?? "Instructor",
        courses: list.length,
        learners,
        completionRate: learners ? round((completed / learners) * 100) : null,
        atRiskPercent: learners ? round((atRisk / learners) * 100) : null,
      };
    })
    .sort((a, b) => b.learners - a.learners);

  const SEVERITY = { HIGH: 0, MEDIUM: 1 };
  alerts.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);

  return { institutionHealth: healthOf(courses), alerts, departments, faculty, platform };
}

module.exports = { buildDashboard, healthOf, THRESHOLDS: T };
