const prisma = require("../../config/database");
const { recomputeCourseProgress } = require("../../utils/progressRollup");

// Thresholds behind each Student Directory status (see classifyStudent).
const STATUS_RULES = { topPerformerAt: 80, failingFinalBelow: 50, behindClassBy: 15 };

/**
 * One student's standing in one course, from real progress:
 * - Not Started:    nothing opened or completed yet.
 * - Struggling:     averaging under 50% across their Final test attempts.
 * - Top Performer:  80%+ of the course done (and not struggling).
 * - Behind Average: 15+ points under the course's average progress — only
 *                   when there are classmates to compare against.
 * - On Track:       everyone else.
 */
function classifyStudent({ progress, started, finalAverage = null, courseAverage = 0, classmates = 1 }) {
  if (!started) return "Not Started";
  if (finalAverage != null && finalAverage < STATUS_RULES.failingFinalBelow) return "Struggling";
  if (progress >= STATUS_RULES.topPerformerAt) return "Top Performer";
  if (classmates > 1 && progress < courseAverage - STATUS_RULES.behindClassBy) return "Behind Average";
  return "On Track";
}

/**
 * Across several courses the most urgent status wins, so struggling in one
 * course is never hidden by doing well in another. Not Started only when the
 * student hasn't started any of them.
 */
function overallStatus(statuses) {
  const started = statuses.filter((s) => s !== "Not Started");
  if (started.length === 0) return "Not Started";
  for (const status of ["Struggling", "Behind Average", "On Track"]) {
    if (started.includes(status)) return status;
  }
  return "Top Performer";
}

/**
 * What a student has actually done in one course, from its progress tree:
 * every content item, quiz and assignment, at all four levels, counts once.
 *
 * The roll-up's own course % only counts whole modules — a one-module course
 * reads 0% until that entire module is finished, hiding real work (a student
 * 16/38 items in showed "0%, Not Started") — so the directory counts items.
 */
function treeStats(hierarchy) {
  const tally = () => ({ total: 0, done: 0, opened: 0 });
  let assignmentsTotal = 0;
  let assignmentsDone = 0;

  const addLevel = (node, t) => {
    for (const key of ["contents", "quizzes", "assignments"]) {
      for (const item of node[key] || []) {
        t.total += 1;
        if (item.completed) t.done += 1;
        if (item.completed || item.visited) t.opened += 1;
        // Lesson-composer assignments are Content rows of type ASSIGNMENT.
        const isAssignment = key === "assignments" || item.contentType === "ASSIGNMENT";
        if (isAssignment) {
          assignmentsTotal += 1;
          if (item.completed) assignmentsDone += 1;
        }
      }
    }
  };

  const course = tally();
  addLevel(hierarchy, course);

  const modules = [];
  for (const mod of hierarchy.modules || []) {
    const m = tally();
    addLevel(mod, m);
    for (const lesson of mod.lessons || []) {
      addLevel(lesson, m);
      for (const topic of lesson.topics || []) addLevel(topic, m);
    }
    course.total += m.total;
    course.done += m.done;
    course.opened += m.opened;
    if (m.total === 0) continue;
    modules.push({
      title: mod.title,
      progress: Math.round((m.done / m.total) * 100),
      status: m.done === m.total ? "Completed" : m.opened > 0 ? "In Progress" : "Not Started",
    });
  }

  return {
    progress: course.total > 0 ? Math.round((course.done / course.total) * 100) : 0,
    started: course.opened > 0,
    assignmentsTotal,
    assignmentsDone,
    modules,
  };
}

const formatDate = (value) =>
  new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const contentCourseId = (c) =>
  c?.courseId ||
  c?.module?.courseId ||
  c?.lesson?.module?.courseId ||
  c?.topic?.lesson?.module?.courseId ||
  null;

const getStudents = async (user) => {
  const whereClause = {
    user: {
      role: "STUDENT",
    },
  };

  let instructorCourseIds = null;

  if (user && user.role === "INSTRUCTOR") {
    const instructorCourses = await prisma.course.findMany({
      where: { creatorId: user.id },
      select: { id: true },
    });
    instructorCourseIds = instructorCourses.map((c) => c.id);

    whereClause.enrollments = {
      some: {
        courseId: { in: instructorCourseIds },
      },
    };
  }

  const students = await prisma.studentProfile.findMany({
    where: whereClause,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
        },
      },
      enrollments: {
        include: {
          course: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      },
      assignmentSubmissions: {
        include: {
          assignment: {
            select: { id: true, title: true, dueDate: true, courseId: true },
          },
        },
      },
      // Lesson-composer assignment submissions (Content rows of type ASSIGNMENT).
      contentSubmissions: {
        include: {
          content: {
            select: {
              id: true,
              title: true,
              courseId: true,
              module: { select: { courseId: true } },
              lesson: { select: { module: { select: { courseId: true } } } },
              topic: { select: { lesson: { select: { module: { select: { courseId: true } } } } } },
            },
          },
        },
      },
      certificates: {
        include: {
          course: {
            select: { title: true },
          },
        },
      },
    },
  });

  // Scope each student's per-course data to the requesting instructor's own
  // courses: a student may also be enrolled in other instructors' courses,
  // and whereClause.enrollments only guarantees SOME overlap.
  const inScope = (courseId) => !instructorCourseIds || instructorCourseIds.includes(courseId);
  const enrollmentsOf = (student) => student.enrollments.filter((e) => inScope(e.courseId));

  // Real progress per (student, course) from the same roll-up the course
  // player uses — read-only (persist: false), so viewing the directory never
  // writes progress rows or bumps anyone's "last accessed" time.
  const pairs = students.flatMap((student) =>
    enrollmentsOf(student).map((e) => ({ studentId: student.id, courseId: e.courseId }))
  );
  const rollups = new Map(); // `${studentId}:${courseId}` -> roll-up with tree
  await Promise.all(
    pairs.map(async ({ studentId, courseId }) => {
      try {
        const rollup = await recomputeCourseProgress(studentId, courseId, null, {
          includeTree: true,
          persist: false,
        });
        rollups.set(`${studentId}:${courseId}`, rollup);
      } catch {
        // Course removed mid-request — that enrollment simply has no data.
      }
    })
  );

  // What each student has done per course — items, not whole modules. Still
  // used for module-by-module breakdown, "started", and assignment counts;
  // the headline progress number below comes from Enrollment.progressPercent
  // instead (see progressOf), so the directory always agrees with the
  // student's own stored course progress.
  const standings = new Map(); // `${studentId}:${courseId}` -> treeStats
  for (const [key, rollup] of rollups) {
    standings.set(key, { courseId: rollup.courseId, ...treeStats(rollup.hierarchy) });
  }

  // The same Enrollment.progressPercent the student's own My Courses card
  // reads (src/utils/progressRollup.js) — authoritative per (student, course).
  const progressOf = new Map(); // `${studentId}:${courseId}` -> progressPercent
  const courseAverages = new Map(); // courseId -> { average, count }, for "Behind Average"
  for (const student of students) {
    for (const e of enrollmentsOf(student)) {
      progressOf.set(`${student.id}:${e.courseId}`, e.progressPercent);
      const entry = courseAverages.get(e.courseId) || { sum: 0, count: 0 };
      entry.sum += e.progressPercent;
      entry.count += 1;
      courseAverages.set(e.courseId, entry);
    }
  }
  for (const entry of courseAverages.values()) entry.average = entry.sum / entry.count;

  // Final-test performance per (student, course), for "Struggling".
  const studentIds = students.map((s) => s.id);
  const scopedCourseIds = [...new Set(pairs.map((p) => p.courseId))];
  const finalAttempts = scopedCourseIds.length
    ? await prisma.quizSubmission.findMany({
        where: { studentId: { in: studentIds }, quiz: { quizTag: "FINAL", courseId: { in: scopedCourseIds } } },
        select: { studentId: true, percentage: true, quiz: { select: { courseId: true } } },
      })
    : [];
  const finalTotals = new Map();
  for (const attempt of finalAttempts) {
    const key = `${attempt.studentId}:${attempt.quiz.courseId}`;
    const entry = finalTotals.get(key) || { sum: 0, count: 0 };
    entry.sum += attempt.percentage;
    entry.count += 1;
    finalTotals.set(key, entry);
  }

  return students.map((student) => {
    const enrollments = enrollmentsOf(student);
    const multiCourse = enrollments.length > 1;

    const courseProgress = {};
    const statuses = [];
    const modules = [];
    let progressSum = 0;
    let assignmentsTotal = 0;
    let assignmentsDone = 0;

    for (const enrollment of enrollments) {
      const key = `${student.id}:${enrollment.courseId}`;
      const stats = standings.get(key);
      const progress = progressOf.get(key) ?? enrollment.progressPercent ?? 0;

      if (!stats) {
        courseProgress[enrollment.courseId] = { progress, status: "Not Started" };
        statuses.push("Not Started");
        progressSum += progress;
        continue;
      }

      const classAverage = courseAverages.get(enrollment.courseId) || { average: 0, count: 1 };
      const final = finalTotals.get(key);
      const status = classifyStudent({
        progress,
        started: stats.started,
        finalAverage: final ? final.sum / final.count : null,
        courseAverage: classAverage.average,
        classmates: classAverage.count,
      });

      courseProgress[enrollment.courseId] = { progress, status };
      statuses.push(status);
      progressSum += progress;

      assignmentsTotal += stats.assignmentsTotal;
      assignmentsDone += stats.assignmentsDone;
      stats.modules.forEach((m) =>
        modules.push({
          name: multiCourse ? `${enrollment.course?.title}: ${m.title}` : m.title,
          progress: m.progress,
          status: m.status,
        })
      );
    }

    // Assignment grades are free text ("A", "9", "8/10"), shown as written.
    const assignmentRows = [
      ...student.assignmentSubmissions
        .filter((as) => inScope(as.assignment?.courseId))
        .map((as) => ({
          id: as.id,
          title: as.assignment?.title || "Assignment",
          status: as.status || "Submitted",
          score: as.grade || null,
          maxScore: null,
          date: formatDate(as.submittedAt),
          at: as.submittedAt,
        })),
      ...student.contentSubmissions
        .filter((cs) => inScope(contentCourseId(cs.content)))
        .map((cs) => ({
          id: cs.id,
          title: cs.content?.title || "Assignment",
          status: cs.status || "Submitted",
          score: cs.grade || null,
          maxScore: null,
          date: formatDate(cs.submittedAt),
          at: cs.submittedAt,
        })),
    ]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .map(({ at, ...row }) => row);

    return {
      id: student.id,
      userId: student.user.id,
      name: student.user.name,
      email: student.user.email,
      role: student.user.role,
      course: enrollments[0]?.course?.title || "General Course",
      courses: enrollments.map((e) => ({ id: e.courseId, title: e.course?.title || "Course" })),
      courseIds: enrollments.map((e) => e.courseId),
      // Across the instructor's courses: average progress, most urgent status.
      progress: enrollments.length ? Math.round(progressSum / enrollments.length) : 0,
      status: overallStatus(statuses),
      // Per course, for when the directory is filtered to one course.
      courseProgress,
      modules,
      // Share of assignments (standalone + lesson-composer) submitted; null
      // when the courses have no assignments at all.
      assignmentRate: assignmentsTotal > 0 ? Math.round((assignmentsDone / assignmentsTotal) * 100) : null,
      // No attendance-tracking feature exists yet, so this is intentionally
      // null rather than a fabricated number - frontend should render "N/A".
      attendanceRate: null,
      joinedDate: formatDate(student.createdAt || student.user.createdAt),
      assignments: assignmentRows,
      certificates: student.certificates
        .filter((c) => inScope(c.courseId))
        .map((c) => ({
          id: c.id,
          title: c.course?.title || "Certificate of Completion",
          date: formatDate(c.issuedAt),
          code: c.certificateNo,
        })),
    };
  });
};

const getStudentById = async (studentId) => {
  return await prisma.studentProfile.findUnique({
    where: {
      id: studentId
    },
    include: {
      user: true,
      enrollments: true,
      certificates: true
    }
  });
};

const updateStudent = async (studentId, data) => {
  return await prisma.studentProfile.update({
    where: {
      id: studentId
    },
    data
  });
};

module.exports = {
  classifyStudent,
  overallStatus,
  treeStats,
  getStudents,
  getStudentById,
  updateStudent
};
