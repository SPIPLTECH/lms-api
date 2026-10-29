const prisma = require("../../config/database");
const config = require("./learningHealth.config");
const { dateKey } = require("./learningHealth.scoring");

/**
 * Learning Health signals — read from the LMS's existing tables, never from
 * an event stream (the original agents' Observation stream no longer exists).
 *
 * One course at a time, any number of learners: two rounds of queries in
 * Promise.all, so the cost is two DB round-trips whether the course has one
 * learner (a write-path recompute) or two hundred (the nightly sweep).
 */

const DAY_MS = 86_400_000;
const MAX_LEASE_MINUTES = 240;

/**
 * "Hangs off this course at any of the six levels" — Content and Assignment
 * rows below course level carry no courseId of their own. Same shape as
 * assignment.service.js#enrolledVia.
 */
const inCourse = (courseId) => [
  { courseId },
  { module: { courseId } },
  { lesson: { module: { courseId } } },
  { topic: { lesson: { module: { courseId } } } },
  { subTopic: { topic: { lesson: { module: { courseId } } } } },
  { concept: { subTopic: { topic: { lesson: { module: { courseId } } } } } },
];

/** UTC midnight at the start of the window that ends today. */
const windowStart = (now) => {
  const start = new Date(now.getTime() - (config.WINDOW_DAYS - 1) * DAY_MS);
  start.setUTCHours(0, 0, 0, 0);
  return start;
};

const groupBy = (rows, field) => {
  const map = new Map();
  for (const row of rows) {
    const key = row[field];
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
};

/**
 * Pure: the batched rows of one course -> one signals object per enrolment.
 * See learningHealth.scoring.js#LearnerSignals for the output shape.
 */
function assembleSignals({ now, since, enrollments, contents, assignments, lessonRows, contentRows, leases, attempts, submissions, masteries, previous }) {
  const lessonsBy = groupBy(lessonRows, "studentId");
  const contentsBy = groupBy(contentRows, "studentId");
  const leasesBy = groupBy(leases, "userId");
  const attemptsBy = groupBy(attempts, "studentId");
  const submissionsBy = groupBy(submissions, "studentId");
  const masteriesBy = groupBy(masteries, "studentId");
  const previousBy = new Map(previous.map((p) => [p.studentId, p.riskLevel]));

  const courseHasVideo = contents.some((c) => c.type === "VIDEO");
  const datedAssignments = assignments.filter((a) => a.dueDate && a.status === "ACTIVE");

  return enrollments.map((e) => {
    const studentId = e.studentId;
    const myAttempts = attemptsBy.get(studentId) ?? [];
    const mySubmissions = submissionsBy.get(studentId) ?? [];
    const myLeases = leasesBy.get(e.student?.userId) ?? [];

    const stamps = [
      ...(lessonsBy.get(studentId) ?? []).flatMap((r) => [r.visitedAt, r.completedAt]),
      ...(contentsBy.get(studentId) ?? []).flatMap((r) => [r.visitedAt, r.completedAt]),
      ...myLeases.map((l) => l.startedAt),
      ...myAttempts.map((a) => a.submittedAt),
      ...mySubmissions.map((s) => s.submittedAt),
      e.lastAccessedAt,
    ]
      .filter(Boolean)
      .map((d) => new Date(d));

    const activeDates = new Set(stamps.filter((d) => d >= since && d <= now).map(dateKey));
    const lastActivityAt = stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : null;

    const videoMinutes = myLeases.reduce((sum, lease) => {
      const end = lease.stoppedAt ?? lease.lastHeartbeat ?? lease.startedAt;
      const minutes = (new Date(end).getTime() - new Date(lease.startedAt).getTime()) / 60_000;
      return sum + Math.min(MAX_LEASE_MINUTES, Math.max(0, minutes));
    }, 0);

    const submitted = new Set(mySubmissions.map((s) => s.assignmentId));
    let overdue = 0;
    const dueSoonDaysLeft = [];
    for (const a of datedAssignments) {
      if (submitted.has(a.id)) continue;
      const daysLeft = (new Date(a.dueDate).getTime() - now.getTime()) / DAY_MS;
      if (daysLeft < 0) overdue += 1;
      else if (daysLeft <= config.DEADLINE_SOON_DAYS) dueSoonDaysLeft.push(Math.floor(daysLeft));
    }

    const assignmentScores = mySubmissions
      .map((s) => s.evaluations?.[0])
      .filter((ev) => ev && ev.maxMarks > 0)
      .map((ev) => Math.min(100, Math.max(0, (ev.marksAwarded / ev.maxMarks) * 100)));

    return {
      studentId,
      previousRiskLevel: previousBy.get(studentId) ?? null,
      signals: {
        now,
        enrolledAt: e.enrolledAt,
        completed: e.completed,
        progressPercent: e.progressPercent,
        lastActivityAt,
        hasAnyActivity: stamps.length > 0,
        activeDates,
        videoMinutes,
        courseHasVideo,
        quizAttempts: myAttempts,
        assignmentScores,
        masteryScores: (masteriesBy.get(studentId) ?? []).map((m) => m.masteryScore),
        deadlines: { hasDeadlines: datedAssignments.length > 0, overdue, dueSoonDaysLeft },
      },
    };
  });
}

/**
 * Reads everything Learning Health needs for one course.
 *
 * @param {string} courseId
 * @param {{studentIds?: string[]|null, now?: Date}} [options]
 *   studentIds: limit to these learners (write-path recompute); omit for all.
 * @returns {Promise<{studentId: string, previousRiskLevel: string|null, signals: object}[]>}
 */
async function fetchCourseSignals(courseId, { studentIds = null, now = new Date() } = {}) {
  const since = windowStart(now);

  const [enrollments, contents, assignments] = await Promise.all([
    prisma.enrollment.findMany({
      where: { courseId, ...(studentIds ? { studentId: { in: studentIds } } : {}) },
      select: {
        studentId: true,
        enrolledAt: true,
        lastAccessedAt: true,
        progressPercent: true,
        completed: true,
        student: { select: { userId: true } },
      },
    }),
    prisma.content.findMany({ where: { OR: inCourse(courseId) }, select: { id: true, type: true } }),
    prisma.assignment.findMany({ where: { OR: inCourse(courseId) }, select: { id: true, dueDate: true, status: true } }),
  ]);

  if (enrollments.length === 0) return [];

  const ids = enrollments.map((e) => e.studentId);
  const userIds = enrollments.map((e) => e.student?.userId).filter(Boolean);
  const contentIds = contents.map((c) => c.id);
  const assignmentIds = assignments.map((a) => a.id);
  const inWindow = { gte: since };

  const [lessonRows, contentRows, leases, attempts, submissions, masteries, previous] = await Promise.all([
    prisma.lessonProgress.findMany({
      where: { studentId: { in: ids }, lesson: { module: { courseId } }, OR: [{ visitedAt: inWindow }, { completedAt: inWindow }] },
      select: { studentId: true, visitedAt: true, completedAt: true },
    }),
    contentIds.length
      ? prisma.contentProgress.findMany({
          where: { studentId: { in: ids }, contentId: { in: contentIds }, OR: [{ visitedAt: inWindow }, { completedAt: inWindow }] },
          select: { studentId: true, visitedAt: true, completedAt: true },
        })
      : [],
    contentIds.length && userIds.length
      ? prisma.playbackLease.findMany({
          where: { userId: { in: userIds }, contentId: { in: contentIds }, startedAt: inWindow },
          select: { userId: true, startedAt: true, lastHeartbeat: true, stoppedAt: true },
        })
      : [],
    prisma.quizAttempt.findMany({
      where: { studentId: { in: ids }, quiz: { courseId } },
      select: { studentId: true, percentage: true, passed: true, correctCount: true, incorrectCount: true, submittedAt: true },
      orderBy: { submittedAt: "desc" },
    }),
    assignmentIds.length
      ? prisma.assignmentSubmission.findMany({
          where: { studentId: { in: ids }, assignmentId: { in: assignmentIds } },
          select: {
            studentId: true,
            assignmentId: true,
            submittedAt: true,
            evaluations: { where: { isCurrent: true, isPublished: true }, select: { marksAwarded: true, maxMarks: true }, take: 1 },
          },
        })
      : [],
    prisma.conceptMastery.findMany({
      where: { studentId: { in: ids }, lastCourseId: courseId },
      select: { studentId: true, masteryScore: true },
    }),
    prisma.learningHealth.findMany({
      where: { courseId, studentId: { in: ids } },
      select: { studentId: true, riskLevel: true },
    }),
  ]);

  return assembleSignals({ now, since, enrollments, contents, assignments, lessonRows, contentRows, leases, attempts, submissions, masteries, previous });
}

module.exports = { fetchCourseSignals, assembleSignals, inCourse, windowStart };
