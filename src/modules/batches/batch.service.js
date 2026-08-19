const prisma = require("../../config/database");

const BATCH_COURSES_SELECT = { select: { id: true, title: true } };

/**
 * A batch now spans one-or-more courses (many-to-many via the implicit
 * `courses` relation), instead of belonging to exactly one course. Creation
 * always takes an explicit courseIds list rather than a single courseId.
 */
const createBatch = async (data, courseIds) => {
  return prisma.batch.create({
    data: {
      name: data.name,
      startDate: new Date(data.startDate),
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      availableFrom: data.availableFrom ? new Date(data.availableFrom) : null,
      availableUntil: data.availableUntil ? new Date(data.availableUntil) : null,
      startTime: data.startTime || null,
      endTime: data.endTime || null,
      meetingLink: data.meetingLink || null,
      status: data.status || "ACTIVE",
      isPublished: data.isPublished !== undefined ? data.isPublished : true,
      courses: { connect: courseIds.map((id) => ({ id })) },
    },
    include: { courses: BATCH_COURSES_SELECT },
  });
};

/**
 * Unified batch listing. Non-admins only ever see batches tied to a course
 * they created. `filters.courseId` (used by course-scoped "batches for this
 * course" views) is folded into the same `courses.some` clause as the
 * ownership filter so both constraints resolve against the same course.
 */
const listBatches = async (user, filters = {}) => {
  const courseFilter = {};
  if (user.role !== "ADMIN") courseFilter.creatorId = user.id;
  if (filters.courseId) courseFilter.id = filters.courseId;

  const where = {};
  if (Object.keys(courseFilter).length > 0) {
    where.courses = { some: courseFilter };
  }
  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.startDate || filters.endDate) {
    where.startDate = {};
    if (filters.startDate) where.startDate.gte = new Date(filters.startDate);
    if (filters.endDate) where.startDate.lte = new Date(filters.endDate);
  }
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { courses: { some: { title: { contains: filters.search, mode: "insensitive" } } } },
      { students: { some: { user: { name: { contains: filters.search, mode: "insensitive" } } } } },
    ];
  }

  const batches = await prisma.batch.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      courses: BATCH_COURSES_SELECT,
      _count: { select: { students: true } },
    },
  });

  return batches.map(({ _count, ...batch }) => ({
    ...batch,
    studentsCount: _count.students,
  }));
};

const buildWeeklyBuckets = (weeks = 6) => {
  const now = new Date();
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now);
    end.setDate(end.getDate() - i * 7);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    buckets.push({ label: `W${weeks - i}`, start, end });
  }
  return buckets;
};

/**
 * Batch Performance Overview — instructor Home dashboard widget. Every
 * metric is computed from real rows (Progress/QuizSubmission/
 * AssignmentSubmission), pooled across all of a batch's linked courses.
 * There is no attendance-tracking feature anywhere in this schema, so
 * attendanceRate is intentionally null rather than a fabricated number.
 */
const getBatchPerformanceOverview = async (user, filters = {}) => {
  const courseFilter = {};
  if (user.role !== "ADMIN") courseFilter.creatorId = user.id;
  if (filters.courseId) courseFilter.id = filters.courseId;

  const where = {};
  if (Object.keys(courseFilter).length > 0) {
    where.courses = { some: courseFilter };
  }
  if (filters.batchId) {
    where.id = filters.batchId;
  }
  if (filters.startDate || filters.endDate) {
    where.startDate = {};
    if (filters.startDate) where.startDate.gte = new Date(filters.startDate);
    if (filters.endDate) where.startDate.lte = new Date(filters.endDate);
  }
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { courses: { some: { title: { contains: filters.search, mode: "insensitive" } } } },
      { students: { some: { user: { name: { contains: filters.search, mode: "insensitive" } } } } },
    ];
  }

  const batches = await prisma.batch.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      courses: {
        select: {
          id: true,
          title: true,
          modules: { select: { lessons: { select: { id: true } } } },
          quizzes: { select: { id: true } },
          assignments: { select: { id: true } },
        },
      },
      students: { select: { id: true } },
    },
  });

  const weeklyBuckets = buildWeeklyBuckets();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const batchCards = await Promise.all(
    batches.map(async (batch) => {
      const studentIds = batch.students.map((s) => s.id);
      const studentsCount = studentIds.length;
      const lessonIds = batch.courses.flatMap((c) => c.modules.flatMap((m) => m.lessons.map((l) => l.id)));
      const quizIds = batch.courses.flatMap((c) => c.quizzes.map((q) => q.id));
      const assignmentIds = batch.courses.flatMap((c) => c.assignments.map((a) => a.id));

      let completion = 0;
      let avgQuizScore = null;
      let assignmentSubmissionRate = null;
      let atRiskStudentIds = [];

      if (studentsCount > 0 && lessonIds.length > 0) {
        const completedCount = await prisma.progress.count({
          where: {
            studentId: { in: studentIds },
            lessonId: { in: lessonIds },
            completed: true,
          },
        });
        completion = Math.round((completedCount / (lessonIds.length * studentsCount)) * 100);

        const perStudentCompleted = await prisma.progress.groupBy({
          by: ["studentId"],
          where: { studentId: { in: studentIds }, lessonId: { in: lessonIds }, completed: true },
          _count: { _all: true },
        });
        const completedByStudent = new Map(perStudentCompleted.map((r) => [r.studentId, r._count._all]));
        atRiskStudentIds = studentIds.filter((id) => {
          const pct = ((completedByStudent.get(id) || 0) / lessonIds.length) * 100;
          return pct < 45;
        });
      } else if (studentsCount > 0) {
        // No lessons at all in these courses yet — every student is at risk by definition.
        atRiskStudentIds = [...studentIds];
      }

      if (studentsCount > 0 && quizIds.length > 0) {
        const submissions = await prisma.quizSubmission.findMany({
          where: { studentId: { in: studentIds }, quizId: { in: quizIds } },
          select: { percentage: true },
        });
        if (submissions.length > 0) {
          avgQuizScore = Math.round(
            submissions.reduce((sum, s) => sum + s.percentage, 0) / submissions.length
          );
        }
      }

      if (studentsCount > 0 && assignmentIds.length > 0) {
        const submittedCount = await prisma.assignmentSubmission.count({
          where: { studentId: { in: studentIds }, assignmentId: { in: assignmentIds } },
        });
        assignmentSubmissionRate = Math.round(
          (submittedCount / (assignmentIds.length * studentsCount)) * 100
        );
      }

      // Weekly trend: cumulative completion snapshot per week-end, and the
      // average quiz score of submissions that landed within each week.
      // Expensive (12 extra queries per batch) and only ever rendered on the
      // single-batch detail page's sparklines — skipped entirely on list
      // views (no batchId filter) where it would just be discarded unused.
      let completionTrend = [];
      let quizTrend = [];
      const computeTrends = Boolean(filters.batchId);
      if (computeTrends && studentsCount > 0 && lessonIds.length > 0) {
        completionTrend = await Promise.all(
          weeklyBuckets.map(async ({ label, end }) => {
            const countByEnd = await prisma.progress.count({
              where: {
                studentId: { in: studentIds },
                lessonId: { in: lessonIds },
                completed: true,
                completedAt: { lte: end },
              },
            });
            return {
              week: label,
              value: Math.round((countByEnd / (lessonIds.length * studentsCount)) * 100),
            };
          })
        );
      }
      if (computeTrends && studentsCount > 0 && quizIds.length > 0) {
        quizTrend = await Promise.all(
          weeklyBuckets.map(async ({ label, start, end }) => {
            const weekSubmissions = await prisma.quizSubmission.findMany({
              where: {
                studentId: { in: studentIds },
                quizId: { in: quizIds },
                submittedAt: { gte: start, lte: end },
              },
              select: { percentage: true },
            });
            return {
              week: label,
              value:
                weekSubmissions.length > 0
                  ? Math.round(weekSubmissions.reduce((sum, s) => sum + s.percentage, 0) / weekSubmissions.length)
                  : null,
            };
          })
        );
      }

      const signals = [completion, avgQuizScore, assignmentSubmissionRate].filter((v) => v !== null);
      const engagementScore = signals.length > 0 ? Math.round(signals.reduce((a, b) => a + b, 0) / signals.length) : 0;

      let engagementStatus = "No Data";
      if (signals.length > 0) {
        if (engagementScore >= 80) engagementStatus = "High";
        else if (engagementScore >= 50) engagementStatus = "Moderate";
        else engagementStatus = "Low";
      }

      return {
        id: batch.id,
        name: batch.name,
        courseIds: batch.courses.map((c) => c.id),
        courseTitles: batch.courses.map((c) => c.title),
        startDate: batch.startDate,
        createdAt: batch.createdAt,
        status: batch.status || "ACTIVE",
        studentsCount,
        completion,
        lessonsCompletedPercent: completion,
        avgQuizScore,
        assignmentSubmissionRate,
        attendanceRate: null,
        engagementScore,
        engagementStatus,
        trend: { completion: completionTrend, quiz: quizTrend, attendance: null },
        atRiskStudentIds,
      };
    })
  );

  const ranked = batchCards.filter((b) => b.studentsCount > 0);
  const bestBatch = ranked.length > 0 ? [...ranked].sort((a, b) => b.completion - a.completion)[0] : null;
  const needsAttentionBatch =
    ranked.length > 1 ? [...ranked].sort((a, b) => a.completion - b.completion)[0] : null;

  const totalBatches = batchCards.length;
  const totalStudents = batchCards.reduce((sum, b) => sum + b.studentsCount, 0);
  const avgCompletion =
    totalBatches > 0 ? Math.round(batchCards.reduce((sum, b) => sum + b.completion, 0) / totalBatches) : 0;
  const newBatchesThisMonth = batchCards.filter((b) => new Date(b.createdAt) >= monthStart).length;
  const atRiskStudentsCount = new Set(batchCards.flatMap((b) => b.atRiskStudentIds)).size;

  const allStudentIds = [...new Set(batches.flatMap((b) => b.students.map((s) => s.id)))];
  const allAssignmentIds = [
    ...new Set(batches.flatMap((b) => b.courses.flatMap((c) => c.assignments.map((a) => a.id)))),
  ];
  const pendingAssignmentReviews =
    allStudentIds.length > 0 && allAssignmentIds.length > 0
      ? await prisma.assignmentSubmission.count({
          where: { studentId: { in: allStudentIds }, assignmentId: { in: allAssignmentIds }, grade: null },
        })
      : 0;

  return {
    batches: batchCards.map(({ atRiskStudentIds, createdAt, ...card }) => card),
    comparison: {
      bestBatch: bestBatch
        ? {
            id: bestBatch.id,
            name: bestBatch.name,
            completion: bestBatch.completion,
            avgQuizScore: bestBatch.avgQuizScore,
            attendanceRate: bestBatch.attendanceRate,
          }
        : null,
      needsAttentionBatch: needsAttentionBatch
        ? {
            id: needsAttentionBatch.id,
            name: needsAttentionBatch.name,
            completion: needsAttentionBatch.completion,
            attendanceRate: needsAttentionBatch.attendanceRate,
          }
        : null,
    },
    stats: {
      totalBatches,
      totalStudents,
      avgCompletion,
      avgAttendance: null,
      newBatchesThisMonth,
      pendingAssignmentReviews,
      atRiskStudentsCount,
    },
  };
};

/**
 * Batch detail view — the batch itself plus its current student roster.
 * Ownership is enforced by verifyBatchOwnership upstream, not here.
 */
const getBatchById = async (batchId) => {
  return prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      courses: BATCH_COURSES_SELECT,
      students: {
        select: {
          id: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
};

const updateBatch = async (batchId, data) => {
  const { courseIds, ...scalars } = data;
  const updateData = { ...scalars };

  if (scalars.startDate) updateData.startDate = new Date(scalars.startDate);
  if (scalars.dueDate !== undefined) {
    updateData.dueDate = scalars.dueDate ? new Date(scalars.dueDate) : null;
  }
  if (scalars.availableFrom !== undefined) {
    updateData.availableFrom = scalars.availableFrom ? new Date(scalars.availableFrom) : null;
  }
  if (scalars.availableUntil !== undefined) {
    updateData.availableUntil = scalars.availableUntil ? new Date(scalars.availableUntil) : null;
  }
  if (courseIds) {
    updateData.courses = { set: courseIds.map((id) => ({ id })) };
  }

  return prisma.batch.update({
    where: { id: batchId },
    data: updateData,
    include: { courses: BATCH_COURSES_SELECT },
  });
};

const updateBatchStatus = async (batchId, status) => {
  return prisma.batch.update({
    where: { id: batchId },
    data: { status },
  });
};

const deleteBatch = async (batchId) => {
  return prisma.batch.delete({ where: { id: batchId } });
};

const addCourseToBatch = async (batchId, courseId) => {
  return prisma.batch.update({
    where: { id: batchId },
    data: { courses: { connect: { id: courseId } } },
    include: { courses: BATCH_COURSES_SELECT },
  });
};

const removeCourseFromBatch = async (batchId, courseId) => {
  return prisma.batch.update({
    where: { id: batchId },
    data: { courses: { disconnect: { id: courseId } } },
    include: { courses: BATCH_COURSES_SELECT },
  });
};

/**
 * Students eligible to be added to this batch — enrolled in ANY of the
 * batch's linked courses, minus whoever is already a member of the batch.
 * Never surfaces students who never enrolled in any of those courses.
 */
const getEnrollableStudentsForBatch = async (batchId) => {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: {
      courses: { select: { id: true } },
      students: { select: { id: true } },
    },
  });

  if (!batch) {
    const error = new Error("Batch not found");
    error.statusCode = 404;
    throw error;
  }

  const existingStudentIds = new Set(batch.students.map((s) => s.id));
  const courseIds = batch.courses.map((c) => c.id);

  if (courseIds.length === 0) return [];

  const enrollments = await prisma.enrollment.findMany({
    where: { courseId: { in: courseIds } },
    include: {
      student: {
        select: {
          id: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  const seen = new Set();
  const eligible = [];
  for (const enrollment of enrollments) {
    const student = enrollment.student;
    if (!student || existingStudentIds.has(student.id) || seen.has(student.id)) continue;
    seen.add(student.id);
    eligible.push(student);
  }

  return eligible;
};

/**
 * Adds a student to a batch. Only students actually enrolled in at least one
 * of the batch's linked courses are eligible — this is a business rule, not
 * just a UI filter, so it's enforced here regardless of what the picker showed
 * the instructor.
 */
const addStudentToBatch = async (batchId, studentId) => {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { id: true, courses: { select: { id: true } } },
  });

  if (!batch) {
    const error = new Error("Batch not found");
    error.statusCode = 404;
    throw error;
  }

  const courseIds = batch.courses.map((c) => c.id);
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId, courseId: { in: courseIds } },
  });

  if (!enrollment) {
    const error = new Error("Student is not enrolled in any of this batch's courses");
    error.statusCode = 400;
    throw error;
  }

  return prisma.batch.update({
    where: { id: batchId },
    data: { students: { connect: { id: studentId } } },
    include: {
      students: {
        select: { id: true, user: { select: { id: true, name: true, email: true } } },
      },
    },
  });
};

const removeStudentFromBatch = async (batchId, studentId) => {
  return prisma.batch.update({
    where: { id: batchId },
    data: { students: { disconnect: { id: studentId } } },
    include: {
      students: {
        select: { id: true, user: { select: { id: true, name: true, email: true } } },
      },
    },
  });
};

const AT_RISK_THRESHOLD = 45;

const classifyStudentStatus = (progress) => {
  if (progress >= 85) return "Top Performer";
  if (progress >= 60) return "On Track";
  if (progress >= 40) return "Struggling";
  return "Not Started";
};

/**
 * Full batch detail dashboard — overview stats, activity feed, upcoming
 * schedule, student roster, and announcements, pooled across every course
 * linked to this batch. No attendance anywhere (attendanceRate is always
 * null, same convention as everywhere else in this codebase).
 */
const getBatchDetailDashboard = async (batchId) => {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      courses: {
        select: {
          id: true,
          title: true,
          modules: {
            select: { id: true, title: true, lessons: { select: { id: true, title: true } } },
          },
          quizzes: { select: { id: true, title: true, dueDate: true } },
          assignments: { select: { id: true, title: true, dueDate: true } },
          exams: { select: { id: true, title: true, startDate: true } },
        },
      },
      students: { select: { id: true, user: { select: { id: true, name: true, email: true } } } },
      sessions: true,
    },
  });

  if (!batch) {
    const error = new Error("Batch not found");
    error.statusCode = 404;
    throw error;
  }

  const studentIds = batch.students.map((s) => s.id);
  const lessons = batch.courses.flatMap((c) =>
    c.modules.flatMap((m) => m.lessons.map((l) => ({ ...l, moduleTitle: m.title })))
  );
  const lessonIds = lessons.map((l) => l.id);
  const lessonById = new Map(lessons.map((l) => [l.id, l]));
  const quizzes = batch.courses.flatMap((c) => c.quizzes);
  const assignments = batch.courses.flatMap((c) => c.assignments);
  const exams = batch.courses.flatMap((c) => c.exams);
  const quizIds = quizzes.map((q) => q.id);
  const assignmentIds = assignments.map((a) => a.id);

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const [
    completedProgress,
    quizSubmissions,
    recentProgress,
    recentAssignmentSubmissions,
    recentQuizSubmissions,
    courseContents,
  ] = await Promise.all([
    studentIds.length > 0 && lessonIds.length > 0
      ? prisma.progress.findMany({
          where: { studentId: { in: studentIds }, lessonId: { in: lessonIds }, completed: true },
          select: { studentId: true, lessonId: true, completedAt: true },
        })
      : [],
    studentIds.length > 0 && quizIds.length > 0
      ? prisma.quizSubmission.findMany({
          where: { studentId: { in: studentIds }, quizId: { in: quizIds } },
          select: { studentId: true, percentage: true },
        })
      : [],
    studentIds.length > 0 && lessonIds.length > 0
      ? prisma.progress.findMany({
          where: {
            studentId: { in: studentIds },
            lessonId: { in: lessonIds },
            completed: true,
            completedAt: { not: null },
          },
          include: { student: { select: { user: { select: { name: true } } } } },
          orderBy: { completedAt: "desc" },
          take: 15,
        })
      : [],
    studentIds.length > 0 && assignmentIds.length > 0
      ? prisma.assignmentSubmission.findMany({
          where: { studentId: { in: studentIds }, assignmentId: { in: assignmentIds } },
          include: {
            assignment: { select: { title: true } },
            student: { select: { user: { select: { name: true } } } },
          },
          orderBy: { submittedAt: "desc" },
          take: 15,
        })
      : [],
    studentIds.length > 0 && quizIds.length > 0
      ? prisma.quizSubmission.findMany({
          where: { studentId: { in: studentIds }, quizId: { in: quizIds } },
          include: {
            quiz: { select: { title: true } },
            student: { select: { user: { select: { name: true } } } },
          },
          orderBy: { submittedAt: "desc" },
          take: 15,
        })
      : [],
    lessonIds.length > 0
      ? prisma.content.findMany({
          where: { topic: { lessonId: { in: lessonIds } } },
          select: {
            id: true,
            title: true,
            type: true,
            fileUrl: true,
            videoUrl: true,
            externalUrl: true,
            createdAt: true,
            topic: { select: { lessonId: true } },
          },
          orderBy: { createdAt: "desc" },
        })
      : [],
  ]);

  // Per-student progress% and quiz average — same shape as course.service's
  // getCourseStudents, scoped to this batch's roster instead of one course.
  const completedCountByStudent = {};
  completedProgress.forEach((p) => {
    completedCountByStudent[p.studentId] = (completedCountByStudent[p.studentId] || 0) + 1;
  });
  const scoresByStudent = {};
  quizSubmissions.forEach((s) => {
    if (!scoresByStudent[s.studentId]) scoresByStudent[s.studentId] = [];
    scoresByStudent[s.studentId].push(s.percentage);
  });

  const studentList = batch.students.map((s) => {
    const completed = completedCountByStudent[s.id] || 0;
    const progress = lessonIds.length > 0 ? Math.round((completed / lessonIds.length) * 100) : 0;
    const scores = scoresByStudent[s.id] || [];
    const quizAverage =
      scores.length > 0 ? Math.round(scores.reduce((sum, sc) => sum + sc, 0) / scores.length) : null;

    return {
      id: s.id,
      userId: s.user.id,
      name: s.user.name,
      email: s.user.email,
      progress,
      quizAverage,
      attendanceRate: null,
      status: classifyStudentStatus(progress),
    };
  });

  const activeStudentIds = new Set([
    ...recentProgress.filter((p) => p.completedAt >= fourteenDaysAgo).map((p) => p.studentId),
    ...(
      await prisma.assignmentSubmission.findMany({
        where: {
          studentId: { in: studentIds },
          assignmentId: { in: assignmentIds },
          submittedAt: { gte: fourteenDaysAgo },
        },
        select: { studentId: true },
      })
    ).map((r) => r.studentId),
    ...(
      await prisma.quizSubmission.findMany({
        where: {
          studentId: { in: studentIds },
          quizId: { in: quizIds },
          submittedAt: { gte: fourteenDaysAgo },
        },
        select: { studentId: true },
      })
    ).map((r) => r.studentId),
  ]);

  const studentSummary = {
    total: studentList.length,
    active: activeStudentIds.size,
    completed: studentList.filter((s) => lessonIds.length > 0 && s.progress === 100).length,
    needHelp: studentList.filter((s) => s.progress < AT_RISK_THRESHOLD).length,
  };

  const recentActivity = [
    ...recentProgress.map((p) => ({
      type: "LESSON_COMPLETED",
      studentName: p.student.user.name,
      title: lessonById.get(p.lessonId)?.title || "a lesson",
      subtitle: lessonById.get(p.lessonId)?.moduleTitle,
      date: p.completedAt,
    })),
    ...recentAssignmentSubmissions.map((a) => ({
      type: "ASSIGNMENT_SUBMITTED",
      studentName: a.student.user.name,
      title: a.assignment.title,
      date: a.submittedAt,
    })),
    ...recentQuizSubmissions.map((q) => ({
      type: "QUIZ_SCORED",
      studentName: q.student.user.name,
      title: q.quiz.title,
      percentage: q.percentage,
      date: q.submittedAt,
    })),
  ]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);

  const now = new Date();
  const upcomingSchedule = [
    ...batch.sessions
      .filter((s) => s.startDate && new Date(s.startDate) >= now)
      .map((s) => ({ id: s.id, type: "SESSION", title: s.title, date: s.startDate })),
    ...exams
      .filter((e) => e.startDate && new Date(e.startDate) >= now)
      .map((e) => ({ id: e.id, type: "EXAM", title: e.title, date: e.startDate })),
    ...assignments
      .filter((a) => a.dueDate && new Date(a.dueDate) >= now)
      .map((a) => ({ id: a.id, type: "ASSIGNMENT_DUE", title: a.title, date: a.dueDate })),
    ...quizzes
      .filter((q) => q.dueDate && new Date(q.dueDate) >= now)
      .map((q) => ({ id: q.id, type: "QUIZ_DUE", title: q.title, date: q.dueDate })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  const announcements = await prisma.announcement.findMany({
    where: { batchId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { instructor: { select: { name: true } } },
  });

  return {
    batch: {
      id: batch.id,
      name: batch.name,
      status: batch.status || "ACTIVE",
      startDate: batch.startDate,
      dueDate: batch.dueDate,
      courses: batch.courses.map((c) => ({ id: c.id, title: c.title })),
    },
    studentSummary,
    recentActivity,
    upcomingSchedule,
    studentList,
    announcements: announcements.map((a) => ({
      id: a.id,
      title: a.title,
      message: a.message,
      instructorName: a.instructor.name,
      createdAt: a.createdAt,
    })),
    // Materials belong to the linked courses, not the batch specifically —
    // this schema has no batch-exclusive file concept, so the same list
    // would show on every batch under these courses. Labeled honestly on
    // the frontend as "Course Materials" rather than implying it's batch-only.
    courseMaterials: courseContents.map((c) => ({
      id: c.id,
      title: c.title || "Untitled material",
      type: c.type,
      url: c.fileUrl || c.videoUrl || c.externalUrl || null,
      moduleTitle: lessonById.get(c.topic?.lessonId)?.moduleTitle,
      lessonTitle: lessonById.get(c.topic?.lessonId)?.title,
      createdAt: c.createdAt,
    })),
  };
};

module.exports = {
  createBatch,
  listBatches,
  getBatchPerformanceOverview,
  getBatchById,
  updateBatch,
  updateBatchStatus,
  deleteBatch,
  addCourseToBatch,
  removeCourseFromBatch,
  getEnrollableStudentsForBatch,
  addStudentToBatch,
  removeStudentFromBatch,
  getBatchDetailDashboard,
};
