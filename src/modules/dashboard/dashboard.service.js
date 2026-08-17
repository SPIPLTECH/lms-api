const prisma = require("../../config/database");

const getAdminDashboard = async () => {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const totalUsers = await prisma.user.count();

  const totalStudents =
    await prisma.user.count({
      where: { role: "STUDENT" }
    });

  const totalInstructors =
    await prisma.user.count({
      where: { role: "INSTRUCTOR" }
    });

  const activeUsers =
    await prisma.user.count({
      where: { status: "ACTIVE" }
    });

  const blockedUsers =
    await prisma.user.count({
      where: { status: "BLOCKED" }
    });

  const totalCourses =
    await prisma.course.count();

  const publishedCourses =
    await prisma.course.count({
      where: {
        status: "PUBLISHED"
      }
    });

  const draftCourses =
    await prisma.course.count({
      where: {
        status: "DRAFT"
      }
    });

  const totalEnrollments =
    await prisma.enrollment.count();

  const recentUsers =
    await prisma.user.findMany({
      take: 5,
      orderBy: {
        createdAt: "desc"
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true
      }
    });

  // Growth deltas for the KPI cards — only counters with a real, unambiguous
  // "since when" (createdAt/enrolledAt/publishedAt/issuedAt), no revenue.
  const [
    newStudentsToday,
    newCoursesThisMonth,
    newEnrollmentsToday,
    newUsersToday
  ] = await Promise.all([
    prisma.user.count({ where: { role: "STUDENT", createdAt: { gte: startOfToday } } }),
    prisma.course.count({ where: { createdAt: { gte: startOfMonth } } }),
    prisma.enrollment.count({ where: { enrolledAt: { gte: startOfToday } } }),
    prisma.user.count({ where: { createdAt: { gte: startOfToday } } })
  ]);

  // Today's Snapshot
  const [coursesPublishedToday, certificatesIssuedToday] = await Promise.all([
    prisma.course.count({ where: { status: "PUBLISHED", publishedAt: { gte: startOfToday } } }),
    prisma.certificate.count({ where: { issuedAt: { gte: startOfToday } } })
  ]);

  // Course Performance — top 6 courses by enrollment, with real rating +
  // completion rate (mirrors the per-course completion math used on the
  // instructor side, scoped down to just these courses for cost).
  const topCourses = await prisma.course.findMany({
    orderBy: { enrollments: { _count: "desc" } },
    take: 6,
    select: {
      id: true,
      title: true,
      category: true,
      level: true,
      status: true,
      _count: { select: { enrollments: true } }
    }
  });

  const topCourseIds = topCourses.map((c) => c.id);

  const [ratingGroups, courseModules, courseEnrollments] = await Promise.all([
    topCourseIds.length
      ? prisma.review.groupBy({
          by: ["courseId"],
          where: { courseId: { in: topCourseIds } },
          _avg: { rating: true }
        })
      : [],
    topCourseIds.length
      ? prisma.module.findMany({
          where: { courseId: { in: topCourseIds } },
          select: { courseId: true, lessons: { select: { id: true } } }
        })
      : [],
    topCourseIds.length
      ? prisma.enrollment.findMany({
          where: { courseId: { in: topCourseIds } },
          select: { courseId: true, studentId: true }
        })
      : []
  ]);

  const ratingByCourse = new Map(
    ratingGroups.map((r) => [r.courseId, r._avg.rating ? parseFloat(r._avg.rating.toFixed(1)) : 0])
  );

  const lessonIdsByCourse = new Map(topCourseIds.map((id) => [id, []]));
  courseModules.forEach((m) => {
    lessonIdsByCourse.get(m.courseId)?.push(...m.lessons.map((l) => l.id));
  });

  const allLessonIds = [...lessonIdsByCourse.values()].flat();
  const allEnrolledStudentIds = [...new Set(courseEnrollments.map((e) => e.studentId))];

  const progressRows =
    allLessonIds.length && allEnrolledStudentIds.length
      ? await prisma.progress.findMany({
          where: {
            lessonId: { in: allLessonIds },
            studentId: { in: allEnrolledStudentIds },
            completed: true
          },
          select: { lessonId: true, studentId: true }
        })
      : [];

  const completedSet = new Set(progressRows.map((p) => `${p.lessonId}:${p.studentId}`));

  const coursePerformance = topCourses.map((course) => {
    const lessonIds = lessonIdsByCourse.get(course.id) || [];
    const enrollmentsForCourse = courseEnrollments.filter((e) => e.courseId === course.id);

    let completionRate = 0;
    if (lessonIds.length > 0 && enrollmentsForCourse.length > 0) {
      const perStudentRates = enrollmentsForCourse.map((e) => {
        const completedCount = lessonIds.filter((lessonId) => completedSet.has(`${lessonId}:${e.studentId}`)).length;
        return completedCount / lessonIds.length;
      });
      completionRate = Math.round(
        (perStudentRates.reduce((sum, r) => sum + r, 0) / perStudentRates.length) * 100
      );
    }

    return {
      id: course.id,
      title: course.title,
      category: course.category || "General",
      level: course.level || "—",
      status: course.status,
      students: course._count.enrollments,
      avgRating: ratingByCourse.get(course.id) ?? 0,
      completionRate
    };
  });

  // Top Performing Instructor — ranked by real students taught, tie-broken
  // by real average rating across their courses. No time window claimed.
  const instructors = await prisma.user.findMany({
    where: { role: "INSTRUCTOR" },
    select: {
      id: true,
      name: true,
      email: true,
      courses: {
        select: {
          id: true,
          _count: { select: { enrollments: true } }
        }
      }
    }
  });

  let topInstructor = null;
  if (instructors.length > 0) {
    const allInstructorCourseIds = instructors.flatMap((i) => i.courses.map((c) => c.id));
    const instructorRatingGroups = allInstructorCourseIds.length
      ? await prisma.review.groupBy({
          by: ["courseId"],
          where: { courseId: { in: allInstructorCourseIds } },
          _avg: { rating: true },
          _count: { rating: true }
        })
      : [];
    const instructorRatingByCourse = new Map(
      instructorRatingGroups.map((r) => [r.courseId, { avg: r._avg.rating || 0, count: r._count.rating }])
    );

    const ranked = instructors
      .map((i) => {
        const coursesCount = i.courses.length;
        const studentsCount = i.courses.reduce((sum, c) => sum + c._count.enrollments, 0);
        let ratingSum = 0;
        let ratingCount = 0;
        i.courses.forEach((c) => {
          const r = instructorRatingByCourse.get(c.id);
          if (r) {
            ratingSum += r.avg * r.count;
            ratingCount += r.count;
          }
        });
        const avgRating = ratingCount > 0 ? parseFloat((ratingSum / ratingCount).toFixed(1)) : 0;
        return {
          id: i.id,
          name: i.name,
          email: i.email,
          coursesCount,
          studentsCount,
          avgRating
        };
      })
      .sort((a, b) => b.studentsCount - a.studentsCount || b.avgRating - a.avgRating);

    topInstructor = ranked[0] && (ranked[0].coursesCount > 0) ? ranked[0] : null;
  }

  return {
    totalUsers,
    totalStudents,
    totalInstructors,
    activeUsers,
    blockedUsers,
    totalCourses,
    publishedCourses,
    draftCourses,
    totalEnrollments,
    recentUsers,
    trends: {
      newStudentsToday,
      newCoursesThisMonth,
      newEnrollmentsToday,
      newUsersToday
    },
    todaySnapshot: {
      newUsersToday,
      newEnrollmentsToday,
      coursesPublishedToday,
      certificatesIssuedToday
    },
    coursePerformance,
    topInstructor
  };
};

const getInstructorDashboard = async (instructorId, courseId) => {
  // Base course list only -- no nested include. Everything else below is
  // fetched as its own minimally-selected/aggregated query and joined in JS
  // via O(1) Map lookups, instead of one giant nested include plus
  // nested-loop-with-.find() scans over the fully materialized object graph.
  const instructorCourses = await prisma.course.findMany({
    where: {
      creatorId: instructorId
    },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true
    }
  });

  const courseIds = instructorCourses.map(c => c.id);

  // If a specific course filter is active, filter the target courses
  const activeCourseId = (courseId && courseId !== "all") ? courseId : null;
  const targetCourses = activeCourseId
    ? instructorCourses.filter(c => c.id === activeCourseId)
    : instructorCourses;
  const targetCourseIds = targetCourses.map(c => c.id);
  const targetCourseSet = new Set(targetCourseIds);

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  // Query-level lower bound for the 7-day engagement window (day loop below
  // covers "today" back through 6 days ago) -- used only to avoid fetching
  // rows that could never fall inside that window.
  const sevenDayWindowStart = new Date();
  sevenDayWindowStart.setDate(sevenDayWindowStart.getDate() - 6);
  sevenDayWindowStart.setHours(0, 0, 0, 0);

  const [
    enrollments,
    moduleGroups,
    lessons,
    completedProgress,
    quizzes,
    quizSubmissionGroups,
    quizSubmissionsThisWeek,
    reviewGroups,
    inactiveStudentsCount,
    pendingFeedbackCount
  ] = await Promise.all([
    // All enrollments for this instructor's own courses (bounded, not platform-wide)
    prisma.enrollment.findMany({
      where: { courseId: { in: courseIds } },
      select: { studentId: true, courseId: true, enrolledAt: true }
    }),
    // Module count per course
    prisma.module.groupBy({
      by: ["courseId"],
      where: { courseId: { in: courseIds } },
      _count: { _all: true }
    }),
    // Lesson id/title + course id (via module), for lesson counts and concept mastery labels
    prisma.lesson.findMany({
      where: { module: { courseId: { in: courseIds } } },
      select: { id: true, title: true, module: { select: { courseId: true } } }
    }),
    // Completed progress rows only, minimal fields, courseId resolved through the relation
    prisma.progress.findMany({
      where: { completed: true, lesson: { module: { courseId: { in: courseIds } } } },
      select: {
        studentId: true,
        lessonId: true,
        completedAt: true,
        lesson: { select: { module: { select: { courseId: true } } } }
      }
    }),
    prisma.quiz.findMany({
      where: { courseId: { in: courseIds } },
      select: { id: true, courseId: true }
    }),
    // Per-quiz submission aggregate (avg %, count) -- DB-side, not per-submission rows
    prisma.quizSubmission.groupBy({
      by: ["quizId"],
      where: { quiz: { courseId: { in: courseIds } } },
      _avg: { percentage: true },
      _count: { _all: true }
    }),
    // Submission rows are needed (not just the aggregate) for the day-by-day
    // engagement bucket, bounded to target courses + the last 7 days
    prisma.quizSubmission.findMany({
      where: { quiz: { courseId: { in: targetCourseIds } }, submittedAt: { gte: sevenDayWindowStart } },
      select: { studentId: true, submittedAt: true }
    }),
    // Per-course rating aggregate -- DB-side, mirrors review.service.js's existing pattern
    prisma.review.groupBy({
      by: ["courseId"],
      where: { courseId: { in: courseIds } },
      _avg: { rating: true },
      _count: { rating: true }
    }),
    // 5. Inactive Students Count (no progress or login activity for 5+ days)
    prisma.studentProfile.count({
      where: {
        enrollments: {
          some: {
            courseId: { in: targetCourseIds }
          }
        },
        NOT: {
          progress: {
            some: {
              completedAt: { gte: fiveDaysAgo }
            }
          }
        }
      }
    }),
    // 6. Unanswered messages in the last 5 days
    prisma.message.count({
      where: {
        conversation: {
          participants: {
            some: {
              userId: instructorId
            }
          }
        },
        NOT: {
          senderId: instructorId
        },
        createdAt: {
          gte: fiveDaysAgo
        }
      }
    })
  ]);

  // ---- Build O(1)-lookup maps once, single pass over each minimal result set ----

  const courseModuleCount = new Map(moduleGroups.map(g => [g.courseId, g._count._all]));

  const courseLessonCount = new Map();
  const lessonsByCourse = new Map();
  for (const l of lessons) {
    const cid = l.module.courseId;
    courseLessonCount.set(cid, (courseLessonCount.get(cid) || 0) + 1);
    if (!lessonsByCourse.has(cid)) lessonsByCourse.set(cid, []);
    lessonsByCourse.get(cid).push(l);
  }

  const courseEnrollments = new Map();
  for (const e of enrollments) {
    if (!courseEnrollments.has(e.courseId)) courseEnrollments.set(e.courseId, []);
    courseEnrollments.get(e.courseId).push(e);
  }

  // Per (studentId, courseId) and per-lesson completed counts, from one pass
  const completedByStudentCourse = new Map();
  const completedByLesson = new Map();
  for (const p of completedProgress) {
    const cid = p.lesson.module.courseId;
    const key = `${p.studentId}:${cid}`;
    completedByStudentCourse.set(key, (completedByStudentCourse.get(key) || 0) + 1);
    completedByLesson.set(p.lessonId, (completedByLesson.get(p.lessonId) || 0) + 1);
  }

  const quizCourseMap = new Map(quizzes.map(q => [q.id, q.courseId]));
  const courseQuizAgg = new Map(); // courseId -> { totalSubs, sumPercentage }
  for (const g of quizSubmissionGroups) {
    const cid = quizCourseMap.get(g.quizId);
    if (cid == null) continue;
    const prev = courseQuizAgg.get(cid) || { totalSubs: 0, sumPercentage: 0 };
    const subCount = g._count._all;
    prev.totalSubs += subCount;
    prev.sumPercentage += (g._avg.percentage || 0) * subCount;
    courseQuizAgg.set(cid, prev);
  }

  const courseReviewAgg = new Map(
    reviewGroups.map(g => [g.courseId, { avg: g._avg.rating || 0, count: g._count.rating }])
  );

  // Per-enrollment completion %, matching the original formula exactly
  // (rounded per-enrollment, then averaged) -- reused for both the per-course
  // table and the target-scope flat KPI average.
  const enrollmentCompletionPercent = (studentId, cid) => {
    const totalLessons = courseLessonCount.get(cid) || 0;
    if (totalLessons === 0) return 0;
    const completed = completedByStudentCourse.get(`${studentId}:${cid}`) || 0;
    return Math.round((completed / totalLessons) * 100);
  };

  const courseCompletionRate = (cid) => {
    const courseEnrolls = courseEnrollments.get(cid) || [];
    const totalLessons = courseLessonCount.get(cid) || 0;
    if (courseEnrolls.length === 0 || totalLessons === 0) return 0;
    let sumPercent = 0;
    for (const e of courseEnrolls) {
      sumPercent += enrollmentCompletionPercent(e.studentId, cid);
    }
    return Math.round(sumPercent / courseEnrolls.length);
  };

  // 1. Calculate Enrollments / Active Learners (target scope)
  const targetEnrollmentRows = targetCourseIds.flatMap(cid => courseEnrollments.get(cid) || []);
  const totalEnrollments = targetEnrollmentRows.length;

  // Enrollment trend (vs last week)
  const newEnrollmentsThisWeek = targetEnrollmentRows.filter(e => e.enrolledAt >= oneWeekAgo).length;
  const oldEnrollments = totalEnrollments - newEnrollmentsThisWeek;
  const enrollmentTrend = oldEnrollments > 0
    ? parseFloat(((newEnrollmentsThisWeek / oldEnrollments) * 100).toFixed(1))
    : 0;

  // 2. Average Course Completion Rate (flat average across target enrollments,
  // matching the original's flat-array-then-average semantics exactly)
  let enrollmentCompletionPercentages = [];
  for (const cid of targetCourseIds) {
    const courseEnrolls = courseEnrollments.get(cid) || [];
    if (courseEnrolls.length === 0 || (courseLessonCount.get(cid) || 0) === 0) continue;
    for (const e of courseEnrolls) {
      enrollmentCompletionPercentages.push(enrollmentCompletionPercent(e.studentId, cid));
    }
  }
  const averageCompletion = enrollmentCompletionPercentages.length > 0
    ? Math.round(enrollmentCompletionPercentages.reduce((sum, p) => sum + p, 0) / enrollmentCompletionPercentages.length)
    : 0;

  // 3. Quiz average score (flat/weighted average across target courses --
  // mathematically identical to averaging every individual submission's %,
  // since a weighted mean of per-quiz means with weight = submission count
  // equals the overall mean)
  let targetQuizSubs = 0;
  let targetQuizWeightedSum = 0;
  for (const cid of targetCourseIds) {
    const agg = courseQuizAgg.get(cid);
    if (!agg) continue;
    targetQuizSubs += agg.totalSubs;
    targetQuizWeightedSum += agg.sumPercentage;
  }
  const avgQuizScore = targetQuizSubs > 0 ? Math.round(targetQuizWeightedSum / targetQuizSubs) : 0;

  // 4. Average rating (same weighted-mean-equals-flat-mean reasoning as quiz score)
  let targetReviewCount = 0;
  let targetReviewWeightedSum = 0;
  for (const cid of targetCourseIds) {
    const agg = courseReviewAgg.get(cid);
    if (!agg) continue;
    targetReviewCount += agg.count;
    targetReviewWeightedSum += agg.avg * agg.count;
  }
  const avgRating = targetReviewCount > 0
    ? parseFloat((targetReviewWeightedSum / targetReviewCount).toFixed(1))
    : 0;

  // 7. KPIs Array with appropriate styling config
  const kpis = [
    {
      id: 1,
      title: 'Active Learners',
      value: totalEnrollments,
      trend: enrollmentTrend,
      contextLabel: 'Top Focus',
      contextValue: targetCourses.length > 0 ? targetCourses[0].title : 'None',
      trendLabel: 'vs last week',
      status: totalEnrollments > 0 ? 'Healthy Growth' : 'No Activity',
      icon: 'Users',
      iconBg: 'bg-orange-500/10',
      iconColor: 'text-orange-400'
    },
    {
      id: 2,
      title: 'Total Enrollments',
      value: totalEnrollments,
      trend: enrollmentTrend,
      trendLabel: 'this week',
      status: enrollmentTrend > 0 ? 'Strong Demand' : 'Stable',
      icon: 'Users',
      iconBg: 'bg-emerald-500/10',
      iconColor: 'text-emerald-400'
    },
    {
      id: 3,
      title: 'Course Completion',
      value: `${averageCompletion}%`,
      trend: 4.1,
      trendLabel: 'vs last month',
      status: averageCompletion >= 70 ? 'On Track' : 'Needs Focus',
      icon: 'GraduationCap',
      iconBg: 'bg-sky-500/10',
      iconColor: 'text-sky-400'
    },
    {
      id: 4,
      title: 'Average Quiz Score',
      value: `${avgQuizScore}%`,
      trend: -1.8,
      trendLabel: 'vs last week',
      status: avgQuizScore >= 75 ? 'Satisfactory' : 'Needs Review',
      icon: 'ClipboardCheck',
      iconBg: 'bg-violet-500/10',
      iconColor: 'text-violet-400'
    },
    {
      id: 5,
      title: 'Average Course Rating',
      value: `${avgRating}/5`,
      trend: 3.9,
      trendLabel: 'this month',
      status: avgRating >= 4.5 ? 'Excellent' : 'Good',
      icon: 'Award',
      iconBg: 'bg-amber-500/10',
      iconColor: 'text-amber-400'
    }
  ];

  // Video Analytics Calculation -- videoAnalytics was never part of this
  // query (before or after this rewrite), so this has always evaluated to 0.
  // Left as-is: wiring up real video-watch-time tracking is a separate
  // feature, not part of this performance fix.
  const totalVideoWatchTime = 0;
  const formatWatchTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs}h ${mins}m`;
  };

  kpis.push({
    id: 6,
    title: 'Total Video Watch Time',
    value: formatWatchTime(totalVideoWatchTime),
    trend: 5.2,
    trendLabel: 'vs last week',
    status: totalVideoWatchTime > 3600 ? 'High Engagement' : 'Needs Focus',
    icon: 'PlayCircle',
    iconBg: 'bg-indigo-500/10',
    iconColor: 'text-indigo-400'
  });

  // 8. Action Center Priorities
  const priorities = [];
  
  if (pendingFeedbackCount > 0) {
    priorities.push({
      id: 1,
      icon: 'Sparkles',
      color: 'amber',
      value: String(pendingFeedbackCount),
      title: 'Unread Messages',
      description: 'New learner comments and questions need your reply.',
      action: 'Open Inbox'
    });
  } else {
    priorities.push({
      id: 1,
      icon: 'Sparkles',
      color: 'green',
      value: '0',
      title: 'Messages Clear',
      description: 'You have answered all recent student inquiries.',
      action: 'Open Inbox'
    });
  }

  if (inactiveStudentsCount > 0) {
    priorities.push({
      id: 2,
      icon: 'TrendingUp',
      color: 'orange',
      value: String(inactiveStudentsCount),
      title: 'Inactive Students',
      description: 'Students with no progress updates in 5+ days.',
      action: 'View Roster'
    });
  } else {
    priorities.push({
      id: 2,
      icon: 'TrendingUp',
      color: 'green',
      value: 'Active',
      title: 'Engagement Solid',
      description: 'All enrolled students are actively learning.',
      action: 'View Insights'
    });
  }

  const draftCoursesCount = targetCourses.filter(c => c.status === 'DRAFT').length;
  priorities.push({
    id: 3,
    icon: 'CheckCircle2',
    color: draftCoursesCount > 0 ? 'blue' : 'green',
    value: String(draftCoursesCount),
    title: draftCoursesCount > 0 ? 'Draft Courses' : 'All Published',
    description: draftCoursesCount > 0 ? 'You have courses in draft stage. Ready to publish?' : 'All your course content is successfully published.',
    action: draftCoursesCount > 0 ? 'Open Courses' : 'Manage Content'
  });

  // 9. Performance Analytics
  let performanceAnalytics = [];
  if (!activeCourseId) {
    const maxEnrolls = Math.max(
      ...instructorCourses.map(c => (courseEnrollments.get(c.id) || []).length),
      1
    );
    performanceAnalytics = instructorCourses.map(course => {
      const enrolledCount = (courseEnrollments.get(course.id) || []).length;
      const popularityScore = Math.round((enrolledCount / maxEnrolls) * 100);
      return {
        course: course.title,
        popularity: popularityScore,
        enrollments: enrolledCount
      };
    });
  } else {
    const selectedCourseId = targetCourseIds[0];
    const selectedLessons = lessonsByCourse.get(selectedCourseId) || [];
    const enrolledCount = (courseEnrollments.get(selectedCourseId) || []).length;
    performanceAnalytics = selectedLessons.map(lesson => {
      const completedCount = completedByLesson.get(lesson.id) || 0;
      const masteryPercent = enrolledCount > 0 ? Math.round((completedCount / enrolledCount) * 100) : 0;
      return {
        course: lesson.title,
        popularity: masteryPercent,
        enrollments: completedCount
      };
    });
  }

  // 10. Student Engagement daily statistics for past 7 days.
  // Pre-filter to target-course, last-7-days rows ONCE (O(n)) instead of
  // re-scanning the full nested object graph on every one of the 7 days.
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const targetEnrollmentsRecent = enrollments.filter(
    e => targetCourseSet.has(e.courseId) && e.enrolledAt >= sevenDayWindowStart
  );
  const targetProgressRecent = completedProgress.filter(
    p => targetCourseSet.has(p.lesson.module.courseId) && p.completedAt && p.completedAt >= sevenDayWindowStart
  );
  // quizSubmissionsThisWeek is already scoped to target courses + the 7-day window by its query.

  const studentEngagement = [];
  for (let i = 6; i >= 0; i--) {
    const dayRef = new Date();
    dayRef.setDate(dayRef.getDate() - i);
    const dayLabel = daysOfWeek[dayRef.getDay()];

    const startOfDay = new Date(dayRef);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dayRef);
    endOfDay.setHours(23, 59, 59, 999);

    const dailyActiveStudents = new Set();
    let dailyCompletions = 0;
    let dailyQuizAttempts = 0;

    for (const e of targetEnrollmentsRecent) {
      if (e.enrolledAt >= startOfDay && e.enrolledAt <= endOfDay) {
        dailyActiveStudents.add(e.studentId);
      }
    }
    for (const p of targetProgressRecent) {
      if (p.completedAt >= startOfDay && p.completedAt <= endOfDay) {
        dailyActiveStudents.add(p.studentId);
        dailyCompletions++;
      }
    }
    for (const qs of quizSubmissionsThisWeek) {
      if (qs.submittedAt >= startOfDay && qs.submittedAt <= endOfDay) {
        dailyActiveStudents.add(qs.studentId);
        dailyQuizAttempts++;
      }
    }

    studentEngagement.push({
      day: dayLabel,
      activeStudents: dailyActiveStudents.size,
      lessonsCompleted: dailyCompletions,
      quizAttempts: dailyQuizAttempts
    });
  }

  // 11. Course Performance (All Courses Table)
  const coursePerformance = instructorCourses.map(course => {
    const cid = course.id;
    const enrolledCount = (courseEnrollments.get(cid) || []).length;
    const totalLessons = courseLessonCount.get(cid) || 0;
    const completionRate = courseCompletionRate(cid);

    const quizAgg = courseQuizAgg.get(cid);
    const hasQuizData = !!(quizAgg && quizAgg.totalSubs > 0);
    const courseQuizAverage = hasQuizData ? Math.round(quizAgg.sumPercentage / quizAgg.totalSubs) : 0;

    const reviewAgg = courseReviewAgg.get(cid);
    const courseRating = reviewAgg ? parseFloat(reviewAgg.avg.toFixed(1)) : 0;

    let health = 'No Data';
    if (enrolledCount > 0) {
      const signals = [completionRate];
      if (hasQuizData) signals.push(courseQuizAverage);
      const worstSignal = Math.min(...signals);
      const bestSignal = Math.min(completionRate, hasQuizData ? courseQuizAverage : 100);

      health = 'Good';
      if (worstSignal < 60) health = 'Critical';
      else if (worstSignal < 75) health = 'Needs Review';
      else if (completionRate >= 85 && bestSignal >= 80) health = 'Excellent';
    }

    return {
      id: course.id,
      course: course.title,
      meta: `${courseModuleCount.get(cid) || 0} Modules • ${totalLessons} Lessons`,
      enrollments: enrolledCount,
      completion: completionRate,
      quizAverage: courseQuizAverage,
      rating: courseRating,
      health: health,
      trend: completionRate >= 75 ? 'up' : 'down',
      createdBy: 'current-user'
    };
  });

  // 12. Concept Mastery
  const conceptMastery = [];
  let conceptId = 1;
  for (const course of targetCourses) {
    const courseLessons = lessonsByCourse.get(course.id) || [];
    const enrolledCount = (courseEnrollments.get(course.id) || []).length;

    for (const lesson of courseLessons) {
      const completedCount = completedByLesson.get(lesson.id) || 0;
      const masteryPercent = enrolledCount > 0 ? Math.round((completedCount / enrolledCount) * 100) : 0;

      let status = 'Good';
      if (masteryPercent < 60) status = 'Critical';
      else if (masteryPercent < 75) status = 'Needs Review';
      else if (masteryPercent >= 85) status = 'Excellent';

      conceptMastery.push({
        id: lesson.id || String(conceptId++),
        concept: lesson.title,
        students: enrolledCount,
        mastery: masteryPercent,
        context: `Part of ${course.title}`,
        status: status,
        trend: masteryPercent >= 70 ? 'up' : 'down'
      });
    }
  }
  
  if (conceptMastery.length === 0) {
    conceptMastery.push(
      { id: '1', concept: 'Getting Started', students: totalEnrollments, mastery: 85, context: 'Onboarding & setup', status: 'Good', trend: 'up' }
    );
  }

  // 13. Recommended Actions
  const recommendedActions = [
    {
      id: 1,
      title: 'Review Student Progress',
      description: inactiveStudentsCount > 0 
        ? `${inactiveStudentsCount} students have shown no learning activity in 5 days.`
        : 'All students are showing active progress.',
      priority: inactiveStudentsCount > 5 ? 'Critical' : inactiveStudentsCount > 0 ? 'Needs Review' : 'Good',
      action: 'Send Message',
    },
    {
      id: 2,
      title: 'Audit Quiz Performance',
      description: `Cohort quiz average stands at ${avgQuizScore}%. Check rubrics for clarity.`,
      priority: avgQuizScore < 70 ? 'Critical' : 'Needs Review',
      action: 'Open Quizzes',
    },
    {
      id: 3,
      title: 'Answer Pending Queries',
      description: pendingFeedbackCount > 0 
        ? `You have ${pendingFeedbackCount} student messages waiting for response.`
        : 'No pending student messages in your inbox.',
      priority: pendingFeedbackCount > 0 ? 'Needs Review' : 'Excellent',
      action: 'Open Inbox',
    }
  ];

  // 14. Course Options list (for dropdown filter)
  const courses = instructorCourses.map(course => ({
    id: course.id,
    course: course.title
  }));

  // 15. Summary text array
  const summary = [
    `Overall Quiz Average stands at ${avgQuizScore}%`,
    `Managing ${instructorCourses.length} active courses and cohorts`,
    `${inactiveStudentsCount} student(s) currently need progress remediation`,
  ];

  return {
    summary,
    kpis,
    priorities,
    performanceAnalytics,
    studentEngagement,
    coursePerformance,
    conceptMastery,
    recommendedActions,
    courses
  };
};
const getStudentDashboard = async (userId) => {
  const student = await prisma.studentProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      batches: {
        select: { name: true },
      },
      enrollments: {
        include: {
          course: {
            include: {
              creator: {
                select: {
                  name: true,
                  email: true,
                },
              },
              modules: {
                include: {
                  lessons: true,
                },
              },
              quizzes: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
      },
      quizSubmissions: {
        select: {
          id: true,
          score: true,
          totalMarks: true,
          percentage: true,
          passed: true,
        },
      },
      certificates: {
        include: {
          course: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      },
      reviews: {
        include: {
          course: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      },
    },
  });

  if (!student) {
    throw new Error("Student not found");
  }

  const studentId = student.id;

  const progress = await prisma.progress.findMany({
    where: { studentId },
    include: {
      lesson: {
        select: {
          id: true,
          title: true,
          module: {
            select: {
              courseId: true,
            },
          },
          topics: {
            select: {
              contents: {
                select: {
                  duration: true,
                },
              },
            },
          },
        },
      },
    },
  });

  // Calculate study time metrics
  const now = new Date();
  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay();
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
  startOfWeek.setDate(diff);
  startOfWeek.setHours(0, 0, 0, 0);

  let totalLearningTime = 0;
  let totalLearningTimeThisWeek = 0;

  progress.forEach((p) => {
    if (p.completed) {
      let lessonTime = 0;
      const lessonContents = (p.lesson.topics || []).flatMap((t) => t.contents || []);
      if (lessonContents.length > 0) {
        lessonContents.forEach((c) => {
          lessonTime += (c.duration && c.duration > 0) ? c.duration : 10;
        });
      } else {
        lessonTime = 10;
      }
      totalLearningTime += lessonTime;

      if (p.completedAt) {
        const completedDate = new Date(p.completedAt);
        if (completedDate >= startOfWeek) {
          totalLearningTimeThisWeek += lessonTime;
        }
      }
    }
  });

  // Total lessons from all enrolled courses
  const totalLessons = student.enrollments.reduce(
    (courseTotal, enrollment) =>
      courseTotal +
      enrollment.course.modules.reduce(
        (moduleTotal, module) =>
          moduleTotal + module.lessons.length,
        0
      ),
    0
  );

  const completedLessons = progress.filter(
    (p) => p.completed
  ).length;

  const completionRate =
    totalLessons === 0
      ? 0
      : Math.round(
          (completedLessons / totalLessons) * 100
        );

  // Quizzes stats
  const totalQuizzes = student.enrollments.reduce(
    (courseTotal, enrollment) =>
      courseTotal + (enrollment.course.quizzes ? enrollment.course.quizzes.length : 0),
    0
  );

  const completedQuizzes = student.quizSubmissions ? student.quizSubmissions.length : 0;

  let avgQuizScore = 0;
  let passingRate = 0;
  if (student.quizSubmissions && student.quizSubmissions.length > 0) {
    const sum = student.quizSubmissions.reduce((acc, sub) => acc + sub.percentage, 0);
    avgQuizScore = Math.round(sum / student.quizSubmissions.length);

    const passedCount = student.quizSubmissions.filter((sub) => sub.passed).length;
    passingRate = Math.round((passedCount / student.quizSubmissions.length) * 100);
  }

  // Format enrolled courses for frontend
  const enrolledCoursesList = student.enrollments.map(
    (enrollment) => {
      const totalCourseLessons =
        enrollment.course.modules.reduce(
          (sum, module) =>
            sum + module.lessons.length,
          0
        );

      const completedCourseLessons =
        progress.filter(
          (p) =>
            p.completed &&
            p.lesson.module.courseId ===
              enrollment.course.id
        ).length;

      const progressPercent =
        totalCourseLessons === 0
          ? 0
          : Math.round(
              (completedCourseLessons /
                totalCourseLessons) *
                100
            );

      return {
        id: enrollment.id,
        courseId: enrollment.courseId,
        enrolledAt: enrollment.enrolledAt,
        studentId: enrollment.studentId,

        course: {
          id: enrollment.course.id,
          title: enrollment.course.title,
          description:
            enrollment.course.description,
          category:
            enrollment.course.category,
          level: enrollment.course.level,
          thumbnailUrl:
            enrollment.course.thumbnailUrl,
          instructor:
            enrollment.course.creator?.name ||
            "Unknown",
          lessons: totalCourseLessons,
        },

        completedLessons:
          completedCourseLessons,
        progress: progressPercent,
      };
    }
  );

  // Calculate learning streak
  const completionDates = progress
    .filter(p => p.completed && p.completedAt)
    .map(p => new Date(p.completedAt).toISOString().split("T")[0]);

  const uniqueDates = [...new Set(completionDates)].sort((a, b) => new Date(b) - new Date(a));

  let streak = 0;
  if (uniqueDates.length > 0) {
    const todayStr = new Date().toISOString().split("T")[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    let currentCheckDate = uniqueDates[0];
    if (currentCheckDate === todayStr || currentCheckDate === yesterdayStr) {
      streak = 1;
      let checkDate = new Date(currentCheckDate);
      for (let i = 1; i < uniqueDates.length; i++) {
        checkDate.setDate(checkDate.getDate() - 1);
        const expectedStr = checkDate.toISOString().split("T")[0];
        if (uniqueDates[i] === expectedStr) {
          streak++;
        } else {
          break;
        }
      }
    }
  }

  // Calculate student percentile rank via a single DB-side window-function
  // query, computed entirely in PostgreSQL -- returns exactly one row (this
  // student's), never the whole student table. PERCENT_RANK() ranks
  // ascending by completed-lesson count (0 = lowest, 1 = highest); this uses
  // the standard "higher count -> higher percentile" convention. (Note: the
  // previous JS implementation's formula was inverted -- the lowest
  // completion count produced the highest percentile number -- but no
  // frontend component reads this field, so this fix normalizes to the
  // intuitive convention rather than replicating that inversion.)
  const percentileRows = await prisma.$queryRaw`
    WITH completion_counts AS (
      SELECT sp.id AS student_id,
             COUNT(p.id) FILTER (WHERE p.completed) AS completed_count
      FROM "StudentProfile" sp
      LEFT JOIN "Progress" p ON p."studentId" = sp.id
      GROUP BY sp.id
    ),
    ranked AS (
      SELECT student_id,
             completed_count,
             PERCENT_RANK() OVER (ORDER BY completed_count) AS pct_rank
      FROM completion_counts
    )
    SELECT completed_count::int AS completed_count, pct_rank::float AS pct_rank
    FROM ranked
    WHERE student_id = ${studentId}
  `;
  const rankPercentile = percentileRows.length > 0
    ? Math.round(Number(percentileRows[0].pct_rank) * 100)
    : 0;

  // Group course progress by category for dynamic Skills Progress
  const categoryProgress = {};
  enrolledCoursesList.forEach(c => {
    const cat = c.course.category || "General";
    if (!categoryProgress[cat]) {
      categoryProgress[cat] = [];
    }
    categoryProgress[cat].push(c.progress);
  });

  const skills = Object.keys(categoryProgress).map(cat => {
    const avg = Math.round(categoryProgress[cat].reduce((sum, val) => sum + val, 0) / categoryProgress[cat].length);
    return {
      name: cat,
      percentage: avg || 0
    };
  });

  // Fallbacks if skills list is empty
  if (skills.length === 0) {
    skills.push({ name: "Problem Solving", percentage: 80 });
    skills.push({ name: "Coding", percentage: 70 });
    skills.push({ name: "Database", percentage: 60 });
    skills.push({ name: "Web Development", percentage: 50 });
  } else {
    // Add default placeholders to complete lists if necessary
    const defaults = [
      { name: "Problem Solving", percentage: 80 },
      { name: "Coding", percentage: 70 },
      { name: "Database", percentage: 60 },
      { name: "Web Development", percentage: 50 }
    ];
    while (skills.length < 4) {
      const needed = defaults[skills.length];
      skills.push(needed);
    }
  }

  // Recommend published courses not currently enrolled in
  const enrolledCourseIds = student.enrollments.map(e => e.courseId);
  const recommendedCourses = await prisma.course.findMany({
    where: {
      status: "PUBLISHED",
      id: { notIn: enrolledCourseIds }
    },
    take: 3,
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      level: true,
      thumbnailUrl: true,
      status: true,
      createdAt: true,
      store: {
        select: { price: true, discountPrice: true, currency: true, isFree: true }
      },
      reviews: {
        select: { rating: true }
      },
      modules: {
        select: {
          lessons: { select: { id: true } }
        }
      }
    }
  });

  const formattedRecommendations = recommendedCourses.map(c => {
    const totalLessonsCount = c.modules.reduce((sum, m) => sum + m.lessons.length, 0);
    return {
      id: c.id,
      title: c.title,
      description: c.description || "",
      category: c.category || "General",
      level: c.level || "Beginner",
      thumbnailUrl: c.thumbnailUrl || null,
      status: c.status,
      createdAt: c.createdAt,
      price: c.store?.price ?? 0,
      discountPrice: c.store?.discountPrice ?? null,
      currency: c.store?.currency || "INR",
      isFree: c.store?.isFree ?? false,
      reviews: c.reviews,
      lessonsCount: totalLessonsCount
    };
  });

  return {
    stats: {
      enrolledCourses: student.enrollments.length,
      completedLessons,
      certificates: student.certificates.length,
      reviews: student.reviews.length,
      completionRate,
      totalLearningTime,
      totalLearningTimeThisWeek,
      totalLessons,
      totalQuizzes,
      completedQuizzes,
      avgQuizScore,
      passingRate,
      streak,
      rankPercentile,
      activeBatchName: student.batches[0]?.name || null,
    },
    enrolledCoursesList,
    certificatesList: student.certificates,
    reviewsList: student.reviews,
    progressList: progress,
    skills,
    recommendations: formattedRecommendations,
  };
};

const getUpcomingTasks = async (userId) => {
  const student = await prisma.studentProfile.findUnique({
    where: { userId },
    select: { id: true }
  });

  if (!student) {
    throw new Error("Student not found");
  }

  const studentId = student.id;

  const enrollments = await prisma.enrollment.findMany({
    where: { studentId },
    select: { courseId: true }
  });

  const enrolledCourseIds = enrollments.map((e) => e.courseId);

  if (enrolledCourseIds.length === 0) {
    return [];
  }

  const now = new Date();

  // Run all 5 event-type queries in parallel to avoid sequential round-trips
  const [assignments, quizzes, liveClasses, exams, batchSessions] = await Promise.all([

    // 1. Assignments not yet submitted, still due
    prisma.assignment.findMany({
      where: {
        courseId: { in: enrolledCourseIds },
        dueDate: { gte: now },
        isPublished: true,
        submissions: { none: { studentId } }
      },
      include: { course: { select: { title: true } } }
    }),

    // 2. Quizzes not yet submitted, still available
    prisma.quiz.findMany({
      where: {
        courseId: { in: enrolledCourseIds },
        isPublished: true,
        quizSubmissions: { none: { studentId } },
        OR: [
          { dueDate: { gte: now } },
          { startDate: { gte: now } },
          { availableUntil: { gte: now } }
        ]
      },
      include: { course: { select: { title: true } } }
    }),

    // 3. Live classes not yet completed/cancelled
    prisma.liveClass.findMany({
      where: {
        courseId: { in: enrolledCourseIds },
        isPublished: true,
        scheduledAt: { gte: now },
        status: { notIn: ["COMPLETED", "CANCELLED"] }
      },
      include: { course: { select: { title: true } } }
    }),

    // 4. Exams upcoming
    prisma.exam.findMany({
      where: {
        courseId: { in: enrolledCourseIds },
        isPublished: true,
        OR: [
          { startDate: { gte: now } },
          { examDate: { gte: now } }
        ]
      },
      include: { course: { select: { title: true } } }
    }),

    // 5. Batch Sessions upcoming
    prisma.batchSession.findMany({
      where: {
        courseId: { in: enrolledCourseIds },
        isPublished: true,
        OR: [
          { startDate: { gte: now } },
          { dueDate: { gte: now } }
        ]
      },
      include: { course: { select: { title: true } } }
    })
  ]);

  const mergedEvents = [];

  // Helper to format date and time in student/server local timezone (avoiding UTC offset shifts)
  const formatDateTime = (dateTime) => {
    if (!dateTime) return { date: "", time: "" };
    const d = new Date(dateTime);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const dateStr = String(d.getDate()).padStart(2, "0");
    const date = `${year}-${month}-${dateStr}`;

    const time = d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
    return { date, time };
  };

  // Map Assignments
  assignments.forEach((item) => {
    const targetDate = new Date(item.dueDate);
    const diffHours = (targetDate - now) / (1000 * 60 * 60);
    const priority = diffHours <= 24 ? "HIGH" : diffHours <= 72 ? "MEDIUM" : "LOW";
    const { date, time } = formatDateTime(item.dueDate);

    mergedEvents.push({
      id: item.id,
      type: "ASSIGNMENT",
      title: item.title,
      courseName: item.course?.title || "Unknown Course",
      date,
      time,
      priority,
      rawDate: targetDate
    });
  });

  // Map Quizzes
  quizzes.forEach((item) => {
    const targetDate = new Date(item.dueDate || item.availableUntil || item.startDate);
    const diffHours = (targetDate - now) / (1000 * 60 * 60);
    const priority = diffHours <= 24 ? "HIGH" : diffHours <= 72 ? "MEDIUM" : "LOW";
    const { date, time } = formatDateTime(item.dueDate || item.availableUntil || item.startDate);

    mergedEvents.push({
      id: item.id,
      type: "QUIZ",
      title: item.title,
      courseName: item.course?.title || "Unknown Course",
      date,
      time,
      priority,
      rawDate: targetDate
    });
  });

  // Map Live Classes
  liveClasses.forEach((item) => {
    const targetDate = new Date(item.scheduledAt);
    const diffHours = (targetDate - now) / (1000 * 60 * 60);
    const priority = diffHours <= 2 ? "HIGH" : diffHours <= 24 ? "MEDIUM" : "LOW";
    const { date, time } = formatDateTime(item.scheduledAt);

    mergedEvents.push({
      id: item.id,
      type: "LIVE_CLASS",
      title: item.title,
      courseName: item.course?.title || "Unknown Course",
      date,
      time,
      priority,
      rawDate: targetDate
    });
  });

  // Map Exams
  exams.forEach((item) => {
    const targetDate = new Date(item.examDate || item.startDate);
    const { date, time } = formatDateTime(item.examDate || item.startDate);

    mergedEvents.push({
      id: item.id,
      type: "EXAM",
      title: item.title,
      courseName: item.course?.title || "Unknown Course",
      date,
      time,
      priority: "HIGH",
      rawDate: targetDate
    });
  });

  // Map Batch Sessions
  batchSessions.forEach((item) => {
    const targetDate = new Date(item.startDate);
    const { date, time } = formatDateTime(item.startDate);

    mergedEvents.push({
      id: item.id,
      type: "BATCH",
      title: item.title,
      courseName: item.course?.title || "Unknown Course",
      date,
      time,
      priority: "MEDIUM",
      rawDate: targetDate
    });
  });

  // Sort by nearest date/time ascending
  mergedEvents.sort((a, b) => a.rawDate - b.rawDate);

  // Return next 10 events without rawDate
  return mergedEvents.slice(0, 10).map(({ rawDate, ...rest }) => rest);
};

module.exports = {
  getAdminDashboard,
  getInstructorDashboard,
  getStudentDashboard,
  getUpcomingTasks
};