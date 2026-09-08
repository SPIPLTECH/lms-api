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

  // Course Performance — top 6 courses by enrollment, with real rating.
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

  const ratingGroups = topCourseIds.length
    ? await prisma.review.groupBy({
        by: ["courseId"],
        where: { courseId: { in: topCourseIds } },
        _avg: { rating: true }
      })
    : [];

  const ratingByCourse = new Map(
    ratingGroups.map((r) => [r.courseId, r._avg.rating ? parseFloat(r._avg.rating.toFixed(1)) : 0])
  );

  const coursePerformance = topCourses.map((course) => {
    return {
      id: course.id,
      title: course.title,
      category: course.category || "General",
      level: course.level || "—",
      status: course.status,
      students: course._count.enrollments,
      avgRating: ratingByCourse.get(course.id) ?? 0
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
    // Lesson id/title + course id (via module), for lesson counts
    prisma.lesson.findMany({
      where: { module: { courseId: { in: courseIds } } },
      select: { id: true, title: true, module: { select: { courseId: true } } }
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
    // 5. Inactive Students Count (no course access recorded in 5+ days)
    prisma.studentProfile.count({
      where: {
        enrollments: {
          some: {
            courseId: { in: targetCourseIds },
            OR: [
              { lastAccessedAt: null },
              { lastAccessedAt: { lt: fiveDaysAgo } }
            ]
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

  // 1. Calculate Enrollments / Active Learners (target scope)
  const targetEnrollmentRows = targetCourseIds.flatMap(cid => courseEnrollments.get(cid) || []);
  const totalEnrollments = targetEnrollmentRows.length;

  // Enrollment trend (vs last week)
  const newEnrollmentsThisWeek = targetEnrollmentRows.filter(e => e.enrolledAt >= oneWeekAgo).length;
  const oldEnrollments = totalEnrollments - newEnrollmentsThisWeek;
  const enrollmentTrend = oldEnrollments > 0
    ? parseFloat(((newEnrollmentsThisWeek / oldEnrollments) * 100).toFixed(1))
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
      description: 'Students with no course activity in 5+ days.',
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

  // 9. Performance Analytics -- course popularity by enrollment share,
  // regardless of whether a single course filter is active.
  const maxEnrolls = Math.max(
    ...instructorCourses.map(c => (courseEnrollments.get(c.id) || []).length),
    1
  );
  const performanceAnalytics = targetCourses.map(course => {
    const enrolledCount = (courseEnrollments.get(course.id) || []).length;
    const popularityScore = Math.round((enrolledCount / maxEnrolls) * 100);
    return {
      course: course.title,
      popularity: popularityScore,
      enrollments: enrolledCount
    };
  });

  // 10. Student Engagement daily statistics for past 7 days.
  // Pre-filter to target-course, last-7-days rows ONCE (O(n)) instead of
  // re-scanning the full nested object graph on every one of the 7 days.
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const targetEnrollmentsRecent = enrollments.filter(
    e => targetCourseSet.has(e.courseId) && e.enrolledAt >= sevenDayWindowStart
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
    let dailyQuizAttempts = 0;

    for (const e of targetEnrollmentsRecent) {
      if (e.enrolledAt >= startOfDay && e.enrolledAt <= endOfDay) {
        dailyActiveStudents.add(e.studentId);
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
      quizAttempts: dailyQuizAttempts
    });
  }

  // 11. Course Performance (All Courses Table)
  const coursePerformance = instructorCourses.map(course => {
    const cid = course.id;
    const enrolledCount = (courseEnrollments.get(cid) || []).length;
    const totalLessons = courseLessonCount.get(cid) || 0;

    const quizAgg = courseQuizAgg.get(cid);
    const hasQuizData = !!(quizAgg && quizAgg.totalSubs > 0);
    const courseQuizAverage = hasQuizData ? Math.round(quizAgg.sumPercentage / quizAgg.totalSubs) : 0;

    const reviewAgg = courseReviewAgg.get(cid);
    const courseRating = reviewAgg ? parseFloat(reviewAgg.avg.toFixed(1)) : 0;

    let health = 'No Data';
    if (enrolledCount > 0 && hasQuizData) {
      health = 'Good';
      if (courseQuizAverage < 60) health = 'Critical';
      else if (courseQuizAverage < 75) health = 'Needs Review';
      else if (courseQuizAverage >= 85) health = 'Excellent';
    }

    return {
      id: course.id,
      course: course.title,
      meta: `${courseModuleCount.get(cid) || 0} Modules • ${totalLessons} Lessons`,
      enrollments: enrolledCount,
      quizAverage: courseQuizAverage,
      rating: courseRating,
      health: health,
      trend: hasQuizData && courseQuizAverage >= 75 ? 'up' : 'down',
      createdBy: 'current-user'
    };
  });

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
    `${inactiveStudentsCount} student(s) have had no recent course activity`,
  ];

  return {
    summary,
    kpis,
    priorities,
    performanceAnalytics,
    studentEngagement,
    coursePerformance,
    recommendedActions,
    courses
  };
};
const getStudentDashboard = async (userId) => {
  const tTotalStart = Date.now();
  console.log(`\n⏱️ ==================================================`);
  console.log(`⏱️ [getStudentDashboard] START for userId=${userId}`);

  const tStep1Start = Date.now();

  const tBaseProfileStart = Date.now();
  const baseProfile = await prisma.studentProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  const tBaseProfileMs = Date.now() - tBaseProfileStart;

  if (!baseProfile) {
    throw new Error("Student not found");
  }

  const studentId = baseProfile.id;

  let tBatchesMs = 0;
  let tQuizSubmissionsMs = 0;
  let tCertificatesMs = 0;
  let tReviewsMs = 0;

  const tRelationsStart = Date.now();
  const [batches, quizSubmissions, certificates, reviews] = await Promise.all([
    (async () => {
      const tStart = Date.now();
      const res = await prisma.batch.findMany({
        where: { students: { some: { id: studentId } } },
        select: { name: true },
      });
      tBatchesMs = Date.now() - tStart;
      return res;
    })(),
    (async () => {
      const tStart = Date.now();
      const res = await prisma.quizSubmission.findMany({
        where: { studentId },
        select: {
          id: true,
          score: true,
          totalMarks: true,
          percentage: true,
          passed: true,
        },
      });
      tQuizSubmissionsMs = Date.now() - tStart;
      return res;
    })(),
    (async () => {
      const tStart = Date.now();
      const res = await prisma.certificate.findMany({
        where: { studentId },
        select: {
          id: true,
          course: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });
      tCertificatesMs = Date.now() - tStart;
      return res;
    })(),
    (async () => {
      const tStart = Date.now();
      const res = await prisma.review.findMany({
        where: { studentId },
        select: {
          id: true,
          course: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });
      tReviewsMs = Date.now() - tStart;
      return res;
    })(),
  ]);

  console.log(`Step 1a base studentProfile query: ${tBaseProfileMs} ms`);
  console.log(`Step 1b batches relation query: ${tBatchesMs} ms (count: ${batches.length})`);
  console.log(`Step 1c quizSubmissions relation query: ${tQuizSubmissionsMs} ms (count: ${quizSubmissions.length})`);
  console.log(`Step 1d certificates relation query: ${tCertificatesMs} ms (count: ${certificates.length})`);
  console.log(`Step 1e reviews relation query: ${tReviewsMs} ms (count: ${reviews.length})`);
  console.log(`Step 1 TOTAL: ${Date.now() - tStep1Start} ms`);

  const student = {
    id: studentId,
    batches,
    quizSubmissions,
    certificates,
    reviews,
  };

  const tStep2Start = Date.now();
  let tEnrollmentsMs = 0;

  const enrollments = await (async () => {
    const tStart = Date.now();
    const res = await prisma.enrollment.findMany({
      where: { studentId },
      select: {
        id: true,
        courseId: true,
        enrolledAt: true,
        studentId: true,
        course: {
          select: {
            id: true,
            title: true,
            description: true,
            category: true,
            level: true,
            thumbnailUrl: true,
            creator: {
              select: {
                name: true,
              },
            },
            modules: {
              select: {
                _count: { select: { lessons: true } },
              },
            },
            _count: { select: { quizzes: true } },
          },
        },
      },
    });
    tEnrollmentsMs = Date.now() - tStart;
    return res;
  })();
  console.log(`Step 2a enrollments query: ${tEnrollmentsMs} ms (count: ${enrollments.length})`);
  console.log(`Step 2 enrollments total: ${Date.now() - tStep2Start} ms`);

  const tStep3Start = Date.now();

  // Total lessons from all enrolled courses
  const totalLessons = enrollments.reduce(
    (courseTotal, enrollment) =>
      courseTotal +
      enrollment.course.modules.reduce(
        (moduleTotal, module) =>
          moduleTotal + module._count.lessons,
        0
      ),
    0
  );

  // Quizzes stats
  const totalQuizzes = enrollments.reduce(
    (courseTotal, enrollment) => courseTotal + (enrollment.course._count?.quizzes || 0),
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
  const enrolledCoursesList = enrollments.map(
    (enrollment) => {
      const totalCourseLessons =
        enrollment.course.modules.reduce(
          (sum, module) =>
            sum + module._count.lessons,
          0
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
      };
    }
  );

  // Student percentile rank: Unused by frontend components. Default to 0 --
  // wiring up a real one would need a platform-wide completion metric, which
  // this schema no longer tracks.
  const rankPercentile = 0;

  console.log(`Step 3 JS processing: ${Date.now() - tStep3Start} ms`);

  const tStep4Start = Date.now();
  // Recommend published courses not currently enrolled in
  const enrolledCourseIds = enrollments.map(e => e.courseId);
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
  console.log(`Step 4 recommendations: ${Date.now() - tStep4Start} ms`);

  const tTotalDuration = Date.now() - tTotalStart;
  console.log(`TOTAL: ${tTotalDuration} ms`);

  return {
    stats: {
      enrolledCourses: enrollments.length,
      certificates: student.certificates.length,
      reviews: student.reviews.length,
      totalLessons,
      totalQuizzes,
      completedQuizzes,
      avgQuizScore,
      passingRate,
      rankPercentile,
      activeBatchName: student.batches[0]?.name || null,
    },
    enrolledCoursesList,
    certificatesList: student.certificates,
    reviewsList: student.reviews,
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