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
              _count: {
                select: { contents: true }
              }
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

module.exports = {
  getCourses,
  getCourseById,
  createCourse,
  updateCourse,
  updateStatus,
  deleteCourse,
  duplicateCourse,
  getCourseStudents,
  getCourseStatusCounts
};