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

  let tQuizSubmissionsMs = 0;
  let tCertificatesMs = 0;
  let tReviewsMs = 0;

  const tRelationsStart = Date.now();
  const [quizSubmissions, certificates, reviews] = await Promise.all([
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
  console.log(`Step 1c quizSubmissions relation query: ${tQuizSubmissionsMs} ms (count: ${quizSubmissions.length})`);
  console.log(`Step 1d certificates relation query: ${tCertificatesMs} ms (count: ${certificates.length})`);
  console.log(`Step 1e reviews relation query: ${tReviewsMs} ms (count: ${reviews.length})`);
  console.log(`Step 1 TOTAL: ${Date.now() - tStep1Start} ms`);

  const student = {
    id: studentId,
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
    },
    enrolledCoursesList,
    certificatesList: student.certificates,
    reviewsList: student.reviews,
    recommendations: formattedRecommendations,
  };
};

module.exports = {
  getAdminDashboard,
  getStudentDashboard
};