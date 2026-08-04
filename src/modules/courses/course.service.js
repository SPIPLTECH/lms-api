const prisma = require("../../config/database");
const notificationService = require("../notifications/notification.service");
// const verifyToken = require(
//   "../../middleware/auth.middleware"
// );

/**
 * Batched stats block for the course card / workspace overview — one set of
 * grouped queries covering every course in `courseIds`, not a per-course
 * round-trip. Every number here is real (derived from actual rows); fields
 * with genuinely no signal (e.g. a course with no reviews yet) come back 0
 * or null rather than a fabricated placeholder.
 */
const buildCourseStatsMap = async (courseIds) => {
  const statsMap = new Map(
    courseIds.map((id) => [
      id,
      {
        lessonsCount: 0,
        contentsCount: 0,
        questionsCount: 0,
        avgRating: 0,
        certificatesIssuedCount: 0,
        upcomingLiveClassesCount: 0,
        pendingSubmissionsCount: 0,
        pendingDoubtsCount: 0,
        completionRate: 0,
        videosCount: 0,
        pdfsCount: 0,
        notesCount: 0,
        activeStudents: 0,
        inactiveStudents: 0,
        contentHealth: "Needs Work",
        engagementHealth: "Needs Work",
        recentActivity: []
      }
    ])
  );

  if (courseIds.length === 0) return statsMap;

  const now = new Date();

  const [
    modules,
    quizQuestions,
    reviewAverages,
    certificateCounts,
    upcomingLiveClasses,
    pendingSubmissions,
    pendingDoubts,
    enrollments,
    contentsList,
    coursesData
  ] = await Promise.all([
    prisma.module.findMany({
      where: { courseId: { in: courseIds } },
      select: {
        courseId: true,
        createdAt: true,
        lessons: { select: { id: true, _count: { select: { contents: true } } } }
      }
    }),
    prisma.quizQuestion.findMany({
      where: { quiz: { courseId: { in: courseIds } } },
      select: { questionId: true, quiz: { select: { courseId: true } } }
    }),
    prisma.review.groupBy({
      by: ["courseId"],
      where: { courseId: { in: courseIds } },
      _avg: { rating: true }
    }),
    prisma.certificate.groupBy({
      by: ["courseId"],
      where: { courseId: { in: courseIds } },
      _count: { id: true }
    }),
    prisma.liveClass.groupBy({
      by: ["courseId"],
      where: {
        courseId: { in: courseIds },
        scheduledAt: { gte: now },
        status: { in: ["SCHEDULED", "LIVE"] }
      },
      _count: { id: true }
    }),
    prisma.assignmentSubmission.findMany({
      where: { grade: null, assignment: { courseId: { in: courseIds } } },
      select: { assignment: { select: { courseId: true } } }
    }),
    prisma.lessonQuery.findMany({
      where: { status: "PENDING", lesson: { module: { courseId: { in: courseIds } } } },
      select: { lesson: { select: { module: { select: { courseId: true } } } } }
    }),
    prisma.enrollment.findMany({
      where: { courseId: { in: courseIds } },
      select: {
        courseId: true,
        studentId: true,
        enrolledAt: true
      }
    }),
    prisma.content.findMany({
      where: { lesson: { module: { courseId: { in: courseIds } } } },
      select: { type: true, lesson: { select: { module: { select: { courseId: true } } } } }
    }),
    prisma.course.findMany({
      where: { id: { in: courseIds } },
      select: { id: true, createdAt: true, updatedAt: true }
    })
  ]);

  // Lessons + contents counts, grouped by course
  const questionSetByCourse = new Map();
  for (const module of modules) {
    const stats = statsMap.get(module.courseId);
    if (!stats) continue;
    stats.lessonsCount += module.lessons.length;
    stats.contentsCount += module.lessons.reduce((sum, l) => sum + l._count.contents, 0);
  }

  // Type-specific content counts
  for (const content of contentsList) {
    const courseId = content.lesson.module.courseId;
    const stats = statsMap.get(courseId);
    if (!stats) continue;
    
    if (content.type === "VIDEO") stats.videosCount += 1;
    else if (content.type === "PDF" || content.type === "DOCUMENT") stats.pdfsCount += 1;
    else if (content.type === "TEXT" || content.type === "HTML") stats.notesCount += 1;
  }

  // Distinct question count per course, via quizzes
  for (const qq of quizQuestions) {
    const courseId = qq.quiz.courseId;
    if (!questionSetByCourse.has(courseId)) questionSetByCourse.set(courseId, new Set());
    questionSetByCourse.get(courseId).add(qq.questionId);
  }
  for (const [courseId, set] of questionSetByCourse.entries()) {
    const stats = statsMap.get(courseId);
    if (stats) stats.questionsCount = set.size;
  }

  for (const row of reviewAverages) {
    const stats = statsMap.get(row.courseId);
    if (stats) stats.avgRating = row._avg.rating ? parseFloat(row._avg.rating.toFixed(1)) : 0;
  }

  for (const row of certificateCounts) {
    const stats = statsMap.get(row.courseId);
    if (stats) stats.certificatesIssuedCount = row._count.id;
  }

  for (const row of upcomingLiveClasses) {
    const stats = statsMap.get(row.courseId);
    if (stats) stats.upcomingLiveClassesCount = row._count.id;
  }

  for (const submission of pendingSubmissions) {
    const stats = statsMap.get(submission.assignment.courseId);
    if (stats) stats.pendingSubmissionsCount += 1;
  }

  for (const doubt of pendingDoubts) {
    const stats = statsMap.get(doubt.lesson.module.courseId);
    if (stats) stats.pendingDoubtsCount += 1;
  }

  // Course-level completion rate: average, across enrolled students, of
  // (lessons that student completed / total lessons in the course).
  const lessonIdsByCourse = new Map();
  for (const module of modules) {
    if (!lessonIdsByCourse.has(module.courseId)) lessonIdsByCourse.set(module.courseId, []);
    lessonIdsByCourse.get(module.courseId).push(...module.lessons.map((l) => l.id));
  }

  const allLessonIds = modules.flatMap((m) => m.lessons.map((l) => l.id));
  const allStudentIds = [...new Set(enrollments.map((e) => e.studentId))];

  const progressRows =
    allLessonIds.length > 0 && allStudentIds.length > 0
      ? await prisma.progress.findMany({
          where: { lessonId: { in: allLessonIds }, studentId: { in: allStudentIds }, completed: true },
          select: { lessonId: true, studentId: true }
        })
      : [];

  const lessonToCourseId = new Map();
  for (const module of modules) {
    for (const lesson of module.lessons) lessonToCourseId.set(lesson.id, module.courseId);
  }

  const completedCountByStudentCourse = new Map();
  for (const row of progressRows) {
    const courseId = lessonToCourseId.get(row.lessonId);
    if (!courseId) continue;
    const key = `${courseId}::${row.studentId}`;
    completedCountByStudentCourse.set(key, (completedCountByStudentCourse.get(key) || 0) + 1);
  }

  const enrollmentsByCourse = new Map();
  for (const e of enrollments) {
    if (!enrollmentsByCourse.has(e.courseId)) enrollmentsByCourse.set(e.courseId, []);
    enrollmentsByCourse.get(e.courseId).push(e.studentId);
  }

  for (const [courseId, studentIds] of enrollmentsByCourse.entries()) {
    const totalLessons = (lessonIdsByCourse.get(courseId) || []).length;
    const stats = statsMap.get(courseId);
    if (!stats || totalLessons === 0 || studentIds.length === 0) continue;

    const percentages = studentIds.map((studentId) => {
      const completed = completedCountByStudentCourse.get(`${courseId}::${studentId}`) || 0;
      return (completed / totalLessons) * 100;
    });
    stats.completionRate = Math.round(percentages.reduce((sum, p) => sum + p, 0) / percentages.length);
    
    // Rough heuristic for active vs inactive students (if they have >0 completion, active)
    stats.activeStudents = percentages.filter((p) => p > 0).length;
    stats.inactiveStudents = percentages.filter((p) => p === 0).length;
    
    if (stats.completionRate > 50) stats.engagementHealth = "Healthy";
    else if (stats.completionRate > 20) stats.engagementHealth = "Average";
  }

  // Generate health metrics and recent activity timeline
  for (const courseId of courseIds) {
    const stats = statsMap.get(courseId);
    if (!stats) continue;

    // Content Health
    if (stats.lessonsCount > 0 && stats.videosCount > 0 && stats.pdfsCount > 0) {
      stats.contentHealth = "Excellent";
    } else if (stats.lessonsCount > 0 && (stats.videosCount > 0 || stats.pdfsCount > 0 || stats.notesCount > 0)) {
      stats.contentHealth = "Good";
    } else if (stats.lessonsCount > 0) {
      stats.contentHealth = "Fair";
    }

    // Recent Activity
    const activities = [];
    const courseInfo = coursesData.find((c) => c.id === courseId);
    if (courseInfo) {
      activities.push({
        type: "COURSE",
        title: "Course updated",
        subtitle: "Last saved",
        date: courseInfo.updatedAt || courseInfo.createdAt
      });
      
      const courseModules = modules.filter(m => m.courseId === courseId);
      if (courseModules.length > 0) {
        const latestModule = courseModules.reduce((latest, current) => 
          new Date(current.createdAt) > new Date(latest.createdAt) ? current : latest
        );
        activities.push({
          type: "MODULE",
          title: "New module added",
          subtitle: "Content expanded",
          date: latestModule.createdAt
        });
      }

      const courseEnrollments = enrollments.filter(e => e.courseId === courseId);
      if (courseEnrollments.length > 0) {
        const latestEnrollment = courseEnrollments.reduce((latest, current) => 
          new Date(current.enrolledAt) > new Date(latest.enrolledAt) ? current : latest
        );
        activities.push({
          type: "ENROLLMENT",
          title: "New student enrolled",
          subtitle: "Milestone reached",
          date: latestEnrollment.enrolledAt
        });
      }

      // Sort descending by date and take top 2
      activities.sort((a, b) => new Date(b.date) - new Date(a.date));
      stats.recentActivity = activities.slice(0, 2);
    }
  }

  return statsMap;
};

const attachCourseStats = async (courses) => {
  const list = Array.isArray(courses) ? courses : [courses];
  const statsMap = await buildCourseStatsMap(list.map((c) => c.id));
  const withStats = list.map((course) => ({ ...course, stats: statsMap.get(course.id) }));
  return Array.isArray(courses) ? withStats : withStats[0];
};

const SORT_MAP = {
  newest: { createdAt: "desc" },
  oldest: { createdAt: "asc" },
  recently_updated: { updatedAt: "desc" },
  most_students: { enrollments: { _count: "desc" } },
  alphabetical: { title: "asc" },
};

const getCourses = async (
  role,
  userId,
  {
    search = "",
    page = 1,
    limit = 10,
    status,
    category,
    level,
    sortBy = "newest",
  } = {}
) => {
  const where = {};
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
      { tags: { has: search } },
      { creator: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const query = {
    where,
    skip: (page - 1) * limit,
    take: limit,
    orderBy: SORT_MAP[sortBy] || SORT_MAP.newest,
  };
  // Student should see only published courses


  const commonInclude = {
    creator: {
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        teacherProfile: true,
        adminProfile: true,
      },
    },
    store: true,
    _count: {
      select: {
        enrollments: true,
        modules: true,
        quizzes: true,
        assignments: true,
        reviews: true,
      },
    },
  };

  if (role === "ADMIN") {
    query.include = commonInclude;
    if (status) where.status = status;
  } else if (role === "INSTRUCTOR") {
    where.creatorId = userId;
    query.include = commonInclude;
    if (status) where.status = status;
  } else {
    where.status = "PUBLISHED";
    query.include = commonInclude;
  }

  if (category) where.category = category;
  if (level) where.level = level;

  const [courses, total] = await Promise.all([
    prisma.course.findMany(query),
    prisma.course.count({ where }),
  ]);

  return { courses: await attachCourseStats(courses), total };
};

/** Real status-breakdown counts for the instructor's own courses (used by the My Courses summary cards). */
const getCourseStatusCounts = async (instructorId) => {
  const [total, published, draft, archived] = await Promise.all([
    prisma.course.count({ where: { creatorId: instructorId } }),
    prisma.course.count({ where: { creatorId: instructorId, status: "PUBLISHED" } }),
    prisma.course.count({ where: { creatorId: instructorId, status: "DRAFT" } }),
    prisma.course.count({ where: { creatorId: instructorId, status: "ARCHIVED" } }),
  ]);

  return { total, published, draft, archived };
};

const getCourseById = async (courseId, role) => {
  const isStudentOrGuest = role === "STUDENT" || role === "GUEST";

  const course = await prisma.course.findUnique({
    where: {
      id: courseId
    },
    include: {
      creator: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          teacherProfile: true,
          adminProfile: true
        }
      },
      store: true,
      _count: {
        select: {
          enrollments: true,
          modules: true,
          quizzes: true,
          assignments: true,
          reviews: true,
        },
      },

      modules: {
        where: isStudentOrGuest ? { isPublished: true } : undefined,
        orderBy: {
          order: "asc"
        },
        include: {
          lessons: {
            where: isStudentOrGuest ? { isPublished: true } : undefined,
            orderBy: {
              order: "asc"
            },
            include: {
              contents: true
            }
          }
        }
      },

      quizzes: {
        include: {
          quizQuestions: {
            orderBy: {
              order: "asc"
            },
            select: {
              id: true,
              quizId: true,
              order: true,
              marks: true,
              question: {
                select: {
                  id: true,
                  title: true,
                  question: true,
                  questionType: true,
                  options: true,
                  difficulty: true,
                  // Sensitive fields are conditionally spread only for ADMIN/INSTRUCTOR.
                  // Omitting a field from select entirely is the only guaranteed way
                  // Prisma will not fetch it — setting a field to false is undefined behavior.
                  ...(isStudentOrGuest
                    ? {}
                    : { correctAnswer: true, explanation: true }),
                }
              }
            }
          }
        }
      },
      enrollments: true
    }
  });

  if (!course) return null;

  if (isStudentOrGuest && course.status !== "PUBLISHED") {
    return null;
  }

  return attachCourseStats(course);
};

const createCourse = async (data, userId) => {
  return await prisma.course.create({
    data: {
      ...data,
      creatorId: userId
    }
  });
};

const updateCourse = async (courseId, data) => {
  return await prisma.course.update({
    where: {
      id: courseId
    },
    data
  });
};

const updateStatus = async (courseId, status) => {
  const isPublished = status === "PUBLISHED" || status === "Published" || status === true;
  const finalStatus = isPublished ? "PUBLISHED" : "DRAFT";

  const course = await prisma.course.update({
    where: {
      id: courseId
    },
    data: {
      status: finalStatus,
      publishedAt: isPublished ? new Date() : null
    }
  });

  try {
    await notificationService.createNotification(course.creatorId, {
      title: "Course Status Updated 📢",
      message: `Your course "${course.title}" status has been updated to "${finalStatus}".`,
      type: "COURSE_STATUS",
      link: `/courses/${courseId}`
    });
  } catch (error) {
    console.error("Error creating course status notification:", error.message);
  }

  return course;
};

const deleteCourse = async (courseId) => {
  return await prisma.course.delete({
    where: {
      id: courseId
    }
  });
};

/**
 * Deep-clones a course's structure (modules -> lessons -> contents) into a
 * new DRAFT course. Enrollments, submissions, reviews, and certificates are
 * intentionally NOT copied — a duplicate is a fresh course, not a snapshot
 * of another course's student data.
 */
const duplicateCourse = async (courseId, instructorId) => {
  const source = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      modules: {
        orderBy: { order: "asc" },
        include: {
          lessons: {
            orderBy: { order: "asc" },
            include: { contents: { orderBy: { order: "asc" } } }
          }
        }
      }
    }
  });

  if (!source) {
    const error = new Error("Course not found");
    error.statusCode = 404;
    throw error;
  }

  return prisma.$transaction(async (tx) => {
    const newCourse = await tx.course.create({
      data: {
        title: `${source.title} (Copy)`,
        description: source.description,
        category: source.category,
        level: source.level,
        thumbnailUrl: source.thumbnailUrl,
        status: "DRAFT",
        creatorId: instructorId,
        visibility: source.visibility,
        language: source.language,
        tags: source.tags,
        certificatesEnabled: source.certificatesEnabled,
        discussionEnabled: source.discussionEnabled,
        dripContentEnabled: source.dripContentEnabled,
        estimatedLearningHours: source.estimatedLearningHours
      }
    });

    for (const module of source.modules) {
      const newModule = await tx.module.create({
        data: {
          title: module.title,
          description: module.description,
          order: module.order,
          isPublished: false,
          courseId: newCourse.id
        }
      });

      for (const lesson of module.lessons) {
        const newLesson = await tx.lesson.create({
          data: {
            title: lesson.title,
            description: lesson.description,
            order: lesson.order,
            isPublished: false,
            moduleId: newModule.id
          }
        });

        if (lesson.contents.length > 0) {
          await tx.content.createMany({
            data: lesson.contents.map((content) => ({
              order: content.order,
              lessonId: newLesson.id,
              type: content.type,
              title: content.title,
              videoUrl: content.videoUrl,
              fileUrl: content.fileUrl,
              htmlContent: content.htmlContent,
              externalUrl: content.externalUrl,
              duration: content.duration
            }))
          });
        }
      }
    }

    return newCourse;
  });
};

const getCourseStudents = async (courseId) => {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      courseId
    },
    include: {
      student: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      }
    }
  });

  const studentIds = enrollments.map((e) => e.studentId);

  const lessons = await prisma.lesson.findMany({
    where: { module: { courseId } },
    select: { id: true }
  });
  const lessonIds = lessons.map((l) => l.id);

  const [progressRows, submissionRows] = await Promise.all([
    lessonIds.length > 0 && studentIds.length > 0
      ? prisma.progress.findMany({
          where: { studentId: { in: studentIds }, lessonId: { in: lessonIds }, completed: true },
          select: { studentId: true }
        })
      : [],
    studentIds.length > 0
      ? prisma.quizSubmission.findMany({
          where: { studentId: { in: studentIds }, quiz: { courseId } },
          select: { studentId: true, percentage: true }
        })
      : []
  ]);

  const completedCountByStudent = {};
  progressRows.forEach((p) => {
    completedCountByStudent[p.studentId] = (completedCountByStudent[p.studentId] || 0) + 1;
  });

  const scoresByStudent = {};
  submissionRows.forEach((s) => {
    if (!scoresByStudent[s.studentId]) scoresByStudent[s.studentId] = [];
    scoresByStudent[s.studentId].push(s.percentage);
  });

  return enrollments.map((enrollment) => {
    const studentId = enrollment.studentId;
    const completed = completedCountByStudent[studentId] || 0;
    const progress = lessonIds.length > 0 ? Math.round((completed / lessonIds.length) * 100) : 0;

    const scores = scoresByStudent[studentId] || [];
    const avgGrade =
      scores.length > 0 ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length) : null;

    return {
      id: enrollment.student.user.id,
      studentProfileId: enrollment.studentId,
      name: enrollment.student.user.name,
      email: enrollment.student.user.email,
      enrolledAt: enrollment.enrolledAt,
      progress,
      avgGrade
    };
  });
};

const getCourseBatches = async (courseId) => {
  const batches = await prisma.batch.findMany({
    where: { courseId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { students: true } }
    }
  });

  return batches.map(({ _count, ...batch }) => ({
    ...batch,
    studentsCount: _count.students
  }));
};

const getInstructorBatches = async (instructorId, filters = {}) => {
  const where = {
    course: { creatorId: instructorId }
  };

  if (filters.courseId) {
    where.courseId = filters.courseId;
  }
  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.startDate || filters.endDate) {
    where.startDate = {};
    if (filters.startDate) where.startDate.gte = new Date(filters.startDate);
    if (filters.endDate) where.startDate.lte = new Date(filters.endDate);
  }

  const batches = await prisma.batch.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      course: { select: { id: true, title: true } },
      _count: { select: { students: true } }
    }
  });

  return batches.map(({ _count, ...batch }) => ({
    ...batch,
    studentsCount: _count.students
  }));
};

/**
 * Batch Performance Overview — instructor Home dashboard widget.
 * Every metric is computed from real rows (Progress/QuizSubmission/
 * AssignmentSubmission). There is no attendance-tracking feature anywhere
 * in this schema, so attendanceRate is intentionally null (same convention
 * as student.service.js) rather than a fabricated number.
 */
/**
 * Last 6 calendar weeks (Mon-Sun), oldest first. Each bucket's `end` is the
 * boundary used for cumulative completion snapshots; `start`/`end` together
 * bucket quiz submissions that fell within that week.
 */
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

const getBatchPerformanceOverview = async (instructorId, filters = {}) => {
  const where = {
    course: { creatorId: instructorId }
  };

  if (filters.courseId) {
    where.courseId = filters.courseId;
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
      { course: { title: { contains: filters.search, mode: "insensitive" } } },
      { students: { some: { user: { name: { contains: filters.search, mode: "insensitive" } } } } }
    ];
  }

  const batches = await prisma.batch.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      course: {
        select: {
          id: true,
          title: true,
          modules: { select: { lessons: { select: { id: true } } } },
          quizzes: { select: { id: true } },
          assignments: { select: { id: true } }
        }
      },
      students: { select: { id: true } }
    }
  });

  const weeklyBuckets = buildWeeklyBuckets();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const batchCards = await Promise.all(
    batches.map(async (batch) => {
      const studentIds = batch.students.map((s) => s.id);
      const studentsCount = studentIds.length;
      const lessonIds = batch.course.modules.flatMap((m) => m.lessons.map((l) => l.id));
      const quizIds = batch.course.quizzes.map((q) => q.id);
      const assignmentIds = batch.course.assignments.map((a) => a.id);

      let completion = 0;
      let avgQuizScore = null;
      let assignmentSubmissionRate = null;
      let atRiskStudentIds = [];

      if (studentsCount > 0 && lessonIds.length > 0) {
        const completedCount = await prisma.progress.count({
          where: {
            studentId: { in: studentIds },
            lessonId: { in: lessonIds },
            completed: true
          }
        });
        completion = Math.round((completedCount / (lessonIds.length * studentsCount)) * 100);

        const perStudentCompleted = await prisma.progress.groupBy({
          by: ["studentId"],
          where: { studentId: { in: studentIds }, lessonId: { in: lessonIds }, completed: true },
          _count: { _all: true }
        });
        const completedByStudent = new Map(perStudentCompleted.map((r) => [r.studentId, r._count._all]));
        atRiskStudentIds = studentIds.filter((id) => {
          const pct = ((completedByStudent.get(id) || 0) / lessonIds.length) * 100;
          return pct < 45;
        });
      } else if (studentsCount > 0) {
        // No lessons at all in this course yet — every student is at risk by definition.
        atRiskStudentIds = [...studentIds];
      }

      if (studentsCount > 0 && quizIds.length > 0) {
        const submissions = await prisma.quizSubmission.findMany({
          where: { studentId: { in: studentIds }, quizId: { in: quizIds } },
          select: { percentage: true }
        });
        if (submissions.length > 0) {
          avgQuizScore = Math.round(
            submissions.reduce((sum, s) => sum + s.percentage, 0) / submissions.length
          );
        }
      }

      if (studentsCount > 0 && assignmentIds.length > 0) {
        const submittedCount = await prisma.assignmentSubmission.count({
          where: { studentId: { in: studentIds }, assignmentId: { in: assignmentIds } }
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
                completedAt: { lte: end }
              }
            });
            return {
              week: label,
              value: Math.round((countByEnd / (lessonIds.length * studentsCount)) * 100)
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
                submittedAt: { gte: start, lte: end }
              },
              select: { percentage: true }
            });
            return {
              week: label,
              value: weekSubmissions.length > 0
                ? Math.round(weekSubmissions.reduce((sum, s) => sum + s.percentage, 0) / weekSubmissions.length)
                : null
            };
          })
        );
      }

      const signals = [completion, avgQuizScore, assignmentSubmissionRate].filter(
        (v) => v !== null
      );
      const engagementScore = signals.length > 0
        ? Math.round(signals.reduce((a, b) => a + b, 0) / signals.length)
        : 0;

      let engagementStatus = "No Data";
      if (signals.length > 0) {
        if (engagementScore >= 80) engagementStatus = "High";
        else if (engagementScore >= 50) engagementStatus = "Moderate";
        else engagementStatus = "Low";
      }

      return {
        id: batch.id,
        name: batch.name,
        courseId: batch.courseId,
        courseTitle: batch.course.title,
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
        atRiskStudentIds
      };
    })
  );

  const ranked = batchCards.filter((b) => b.studentsCount > 0);
  const bestBatch = ranked.length > 0
    ? [...ranked].sort((a, b) => b.completion - a.completion)[0]
    : null;
  const needsAttentionBatch = ranked.length > 1
    ? [...ranked].sort((a, b) => a.completion - b.completion)[0]
    : null;

  const totalBatches = batchCards.length;
  const totalStudents = batchCards.reduce((sum, b) => sum + b.studentsCount, 0);
  const avgCompletion = totalBatches > 0
    ? Math.round(batchCards.reduce((sum, b) => sum + b.completion, 0) / totalBatches)
    : 0;
  const newBatchesThisMonth = batchCards.filter((b) => new Date(b.createdAt) >= monthStart).length;
  const atRiskStudentsCount = new Set(batchCards.flatMap((b) => b.atRiskStudentIds)).size;

  const allStudentIds = [...new Set(batches.flatMap((b) => b.students.map((s) => s.id)))];
  const allAssignmentIds = [
    ...new Set(batches.flatMap((b) => b.course.assignments.map((a) => a.id)))
  ];
  const pendingAssignmentReviews = allStudentIds.length > 0 && allAssignmentIds.length > 0
    ? await prisma.assignmentSubmission.count({
        where: { studentId: { in: allStudentIds }, assignmentId: { in: allAssignmentIds }, grade: null }
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
            attendanceRate: bestBatch.attendanceRate
          }
        : null,
      needsAttentionBatch: needsAttentionBatch
        ? {
            id: needsAttentionBatch.id,
            name: needsAttentionBatch.name,
            completion: needsAttentionBatch.completion,
            attendanceRate: needsAttentionBatch.attendanceRate
          }
        : null
    },
    stats: {
      totalBatches,
      totalStudents,
      avgCompletion,
      avgAttendance: null,
      newBatchesThisMonth,
      pendingAssignmentReviews,
      atRiskStudentsCount
    }
  };
};

const createCourseBatch = async (courseId, data) => {
  return await prisma.batch.create({
    data: {
      name: data.name,
      startDate: new Date(data.startDate),
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      startTime: data.startTime || null,
      endTime: data.endTime || null,
      meetingLink: data.meetingLink || null,
      status: data.status || "ACTIVE",
      isPublished: data.isPublished !== undefined ? data.isPublished : true,
      courseId
    }
  });
};

/**
 * Batch detail view — the batch itself plus its current student roster.
 * Ownership of the underlying course is enforced by verifyBatchOwnership
 * upstream, not here.
 */
const getBatchById = async (batchId) => {
  return await prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      course: { select: { id: true, title: true } },
      students: {
        select: {
          id: true,
          user: { select: { id: true, name: true, email: true } }
        }
      }
    }
  });
};

/**
 * Students eligible to be added to this batch — enrolled in the batch's
 * course, minus whoever is already a member of the batch. Never surfaces
 * students who never enrolled in the course at all.
 */
const getEnrollableStudentsForBatch = async (batchId) => {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { courseId: true, students: { select: { id: true } } }
  });

  if (!batch) {
    const error = new Error("Batch not found");
    error.statusCode = 404;
    throw error;
  }

  const existingStudentIds = new Set(batch.students.map((s) => s.id));

  const enrollments = await prisma.enrollment.findMany({
    where: { courseId: batch.courseId },
    include: {
      student: {
        select: {
          id: true,
          user: { select: { id: true, name: true, email: true } }
        }
      }
    }
  });

  return enrollments
    .map((e) => e.student)
    .filter((student) => student && !existingStudentIds.has(student.id));
};

/**
 * Adds a student to a batch. Only students actually enrolled in the batch's
 * course are eligible — this is a business rule, not just a UI filter, so
 * it's enforced here regardless of what the picker showed the instructor.
 */
const addStudentToBatch = async (batchId, studentId) => {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { id: true, courseId: true }
  });

  if (!batch) {
    const error = new Error("Batch not found");
    error.statusCode = 404;
    throw error;
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId, courseId: batch.courseId }
  });

  if (!enrollment) {
    const error = new Error("Student is not enrolled in this batch's course");
    error.statusCode = 400;
    throw error;
  }

  return await prisma.batch.update({
    where: { id: batchId },
    data: { students: { connect: { id: studentId } } },
    include: {
      students: {
        select: { id: true, user: { select: { id: true, name: true, email: true } } }
      }
    }
  });
};

const removeStudentFromBatch = async (batchId, studentId) => {
  return await prisma.batch.update({
    where: { id: batchId },
    data: { students: { disconnect: { id: studentId } } },
    include: {
      students: {
        select: { id: true, user: { select: { id: true, name: true, email: true } } }
      }
    }
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
 * schedule, student roster, and announcements, all from real rows. No
 * attendance anywhere (attendanceRate is always null, same convention as
 * everywhere else in this codebase).
 */
const getBatchDetailDashboard = async (batchId) => {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      course: {
        select: {
          id: true,
          title: true,
          modules: {
            select: { id: true, title: true, lessons: { select: { id: true, title: true } } }
          },
          quizzes: { select: { id: true, title: true, dueDate: true } },
          assignments: { select: { id: true, title: true, dueDate: true } }
        }
      },
      students: { select: { id: true, user: { select: { id: true, name: true, email: true } } } },
      sessions: true,
      exams: true
    }
  });

  if (!batch) {
    const error = new Error("Batch not found");
    error.statusCode = 404;
    throw error;
  }

  const studentIds = batch.students.map((s) => s.id);
  const lessons = batch.course.modules.flatMap((m) =>
    m.lessons.map((l) => ({ ...l, moduleTitle: m.title }))
  );
  const lessonIds = lessons.map((l) => l.id);
  const lessonById = new Map(lessons.map((l) => [l.id, l]));
  const quizIds = batch.course.quizzes.map((q) => q.id);
  const assignmentIds = batch.course.assignments.map((a) => a.id);

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const [
    completedProgress,
    quizSubmissions,
    recentProgress,
    recentAssignmentSubmissions,
    recentQuizSubmissions,
    courseContents
  ] = await Promise.all([
    studentIds.length > 0 && lessonIds.length > 0
      ? prisma.progress.findMany({
          where: { studentId: { in: studentIds }, lessonId: { in: lessonIds }, completed: true },
          select: { studentId: true, lessonId: true, completedAt: true }
        })
      : [],
    studentIds.length > 0 && quizIds.length > 0
      ? prisma.quizSubmission.findMany({
          where: { studentId: { in: studentIds }, quizId: { in: quizIds } },
          select: { studentId: true, percentage: true }
        })
      : [],
    studentIds.length > 0 && lessonIds.length > 0
      ? prisma.progress.findMany({
          where: {
            studentId: { in: studentIds },
            lessonId: { in: lessonIds },
            completed: true,
            completedAt: { not: null }
          },
          include: { student: { select: { user: { select: { name: true } } } } },
          orderBy: { completedAt: "desc" },
          take: 15
        })
      : [],
    studentIds.length > 0 && assignmentIds.length > 0
      ? prisma.assignmentSubmission.findMany({
          where: { studentId: { in: studentIds }, assignmentId: { in: assignmentIds } },
          include: {
            assignment: { select: { title: true } },
            student: { select: { user: { select: { name: true } } } }
          },
          orderBy: { submittedAt: "desc" },
          take: 15
        })
      : [],
    studentIds.length > 0 && quizIds.length > 0
      ? prisma.quizSubmission.findMany({
          where: { studentId: { in: studentIds }, quizId: { in: quizIds } },
          include: {
            quiz: { select: { title: true } },
            student: { select: { user: { select: { name: true } } } }
          },
          orderBy: { submittedAt: "desc" },
          take: 15
        })
      : [],
    lessonIds.length > 0
      ? prisma.content.findMany({
          where: { lessonId: { in: lessonIds } },
          select: {
            id: true,
            title: true,
            type: true,
            fileUrl: true,
            videoUrl: true,
            externalUrl: true,
            createdAt: true,
            lessonId: true
          },
          orderBy: { createdAt: "desc" }
        })
      : []
  ]);

  // Per-student progress% and quiz average — same shape as getCourseStudents,
  // scoped to this batch's roster instead of every course enrollment.
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
      status: classifyStudentStatus(progress)
    };
  });

  const activeStudentIds = new Set([
    ...recentProgress
      .filter((p) => p.completedAt >= fourteenDaysAgo)
      .map((p) => p.studentId),
    ...(
      await prisma.assignmentSubmission.findMany({
        where: {
          studentId: { in: studentIds },
          assignmentId: { in: assignmentIds },
          submittedAt: { gte: fourteenDaysAgo }
        },
        select: { studentId: true }
      })
    ).map((r) => r.studentId),
    ...(
      await prisma.quizSubmission.findMany({
        where: {
          studentId: { in: studentIds },
          quizId: { in: quizIds },
          submittedAt: { gte: fourteenDaysAgo }
        },
        select: { studentId: true }
      })
    ).map((r) => r.studentId)
  ]);

  const studentSummary = {
    total: studentList.length,
    active: activeStudentIds.size,
    completed: studentList.filter((s) => lessonIds.length > 0 && s.progress === 100).length,
    needHelp: studentList.filter((s) => s.progress < AT_RISK_THRESHOLD).length
  };

  const recentActivity = [
    ...recentProgress.map((p) => ({
      type: "LESSON_COMPLETED",
      studentName: p.student.user.name,
      title: lessonById.get(p.lessonId)?.title || "a lesson",
      subtitle: lessonById.get(p.lessonId)?.moduleTitle,
      date: p.completedAt
    })),
    ...recentAssignmentSubmissions.map((a) => ({
      type: "ASSIGNMENT_SUBMITTED",
      studentName: a.student.user.name,
      title: a.assignment.title,
      date: a.submittedAt
    })),
    ...recentQuizSubmissions.map((q) => ({
      type: "QUIZ_SCORED",
      studentName: q.student.user.name,
      title: q.quiz.title,
      percentage: q.percentage,
      date: q.submittedAt
    }))
  ]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);

  const now = new Date();
  const upcomingSchedule = [
    ...batch.sessions
      .filter((s) => s.startDate && new Date(s.startDate) >= now)
      .map((s) => ({ id: s.id, type: "SESSION", title: s.title, date: s.startDate })),
    ...batch.exams
      .filter((e) => e.startDate && new Date(e.startDate) >= now)
      .map((e) => ({ id: e.id, type: "EXAM", title: e.title, date: e.startDate })),
    ...batch.course.assignments
      .filter((a) => a.dueDate && new Date(a.dueDate) >= now)
      .map((a) => ({ id: a.id, type: "ASSIGNMENT_DUE", title: a.title, date: a.dueDate })),
    ...batch.course.quizzes
      .filter((q) => q.dueDate && new Date(q.dueDate) >= now)
      .map((q) => ({ id: q.id, type: "QUIZ_DUE", title: q.title, date: q.dueDate }))
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  const announcements = await prisma.announcement.findMany({
    where: { batchId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { instructor: { select: { name: true } } }
  });

  return {
    batch: {
      id: batch.id,
      name: batch.name,
      status: batch.status || "ACTIVE",
      startDate: batch.startDate,
      dueDate: batch.dueDate,
      courseId: batch.course.id,
      courseTitle: batch.course.title
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
      createdAt: a.createdAt
    })),
    // Materials belong to the course, not the batch specifically — this
    // schema has no batch-exclusive file concept, so the same list would
    // show on every batch under this course. Labeled honestly on the
    // frontend as "Course Materials" rather than implying it's batch-only.
    courseMaterials: courseContents.map((c) => ({
      id: c.id,
      title: c.title || "Untitled material",
      type: c.type,
      url: c.fileUrl || c.videoUrl || c.externalUrl || null,
      moduleTitle: lessonById.get(c.lessonId)?.moduleTitle,
      lessonTitle: lessonById.get(c.lessonId)?.title,
      createdAt: c.createdAt
    }))
  };
};

const updateBatchStatus = async (batchId, status) => {
  return await prisma.batch.update({
    where: { id: batchId },
    data: { status }
  });
};

module.exports = {
  getCourses,
  getCourseById,
  createCourse,
  updateCourse,
  updateStatus,
  deleteCourse,
  duplicateCourse,
  getCourseStudents,
  getCourseBatches,
  getInstructorBatches,
  getBatchPerformanceOverview,
  createCourseBatch,
  getCourseStatusCounts,
  getBatchById,
  getEnrollableStudentsForBatch,
  addStudentToBatch,
  removeStudentFromBatch,
  getBatchDetailDashboard,
  updateBatchStatus
};