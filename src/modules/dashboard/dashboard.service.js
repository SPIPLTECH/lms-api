const prisma = require("../../config/database");

const getAdminDashboard = async () => {
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
    recentUsers
  };
};

const getInstructorDashboard = async (instructorId, courseId) => {
  // Fetch all courses owned/created by the instructor
  const allInstructorCourses = await prisma.course.findMany({
    where: {
      creatorId: instructorId
    },
    include: {
      enrollments: true,
      modules: {
        include: {
          lessons: {
            include: {
              progress: true
            }
          }
        }
      },
      quizzes: {
        include: {
          quizSubmissions: true
        }
      },
      reviews: true
    }
  });

  const courseIds = allInstructorCourses.map(c => c.id);

  // If a specific course filter is active, filter the target courses
  const activeCourseId = (courseId && courseId !== "all") ? courseId : null;
  const targetCourses = activeCourseId
    ? allInstructorCourses.filter(c => c.id === activeCourseId)
    : allInstructorCourses;
  const targetCourseIds = targetCourses.map(c => c.id);

  // 1. Calculate Enrollments / Active Learners
  const totalEnrollments = targetCourses.reduce((sum, c) => sum + c.enrollments.length, 0);

  // Enrollment trend (vs last week)
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const newEnrollmentsThisWeek = targetCourses.reduce((sum, c) => {
    return sum + c.enrollments.filter(e => e.enrolledAt >= oneWeekAgo).length;
  }, 0);
  const oldEnrollments = totalEnrollments - newEnrollmentsThisWeek;
  const enrollmentTrend = oldEnrollments > 0
    ? parseFloat(((newEnrollmentsThisWeek / oldEnrollments) * 100).toFixed(1))
    : 0;

  // 2. Average Course Completion Rate
  let enrollmentCompletionPercentages = [];
  for (const course of targetCourses) {
    const lessons = course.modules.flatMap(m => m.lessons);
    const lessonIds = lessons.map(l => l.id);
    const enrolledCount = course.enrollments.length;

    if (enrolledCount === 0 || lessonIds.length === 0) continue;

    for (const enrollment of course.enrollments) {
      const studentProgress = lessons.reduce((compSum, lesson) => {
        const prog = lesson.progress.find(p => p.studentId === enrollment.studentId);
        return compSum + (prog && prog.completed ? 1 : 0);
      }, 0);
      const percent = Math.round((studentProgress / lessonIds.length) * 100);
      enrollmentCompletionPercentages.push(percent);
    }
  }

  const averageCompletion = enrollmentCompletionPercentages.length > 0
    ? Math.round(enrollmentCompletionPercentages.reduce((sum, p) => sum + p, 0) / enrollmentCompletionPercentages.length)
    : 0;

  // 3. Quiz average score calculations
  let quizScores = [];
  for (const course of targetCourses) {
    for (const quiz of course.quizzes) {
      for (const sub of quiz.quizSubmissions) {
        quizScores.push(sub.percentage);
      }
    }
  }
  const avgQuizScore = quizScores.length > 0
    ? Math.round(quizScores.reduce((sum, s) => sum + s, 0) / quizScores.length)
    : 0;

  // 4. Average rating calculations
  let ratings = [];
  for (const course of targetCourses) {
    for (const review of course.reviews) {
      ratings.push(review.rating);
    }
  }
  const avgRating = ratings.length > 0
    ? parseFloat((ratings.reduce((sum, r) => sum + r, 0) / ratings.length).toFixed(1))
    : 0;

  // 5. Inactive Students Count (no progress or login activity for 5+ days)
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  const inactiveStudentsCount = await prisma.studentProfile.count({
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
  });

  // 6. Unanswered messages in the last 5 days
  const pendingFeedbackCount = await prisma.message.count({
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
  });

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

  // Video Analytics Calculation
  let totalVideoWatchTime = 0;
  for (const course of targetCourses) {
    if (course.videoAnalytics) {
       for (const va of course.videoAnalytics) {
          totalVideoWatchTime += (va.watchTime || 0);
       }
    }
  }
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
    performanceAnalytics = allInstructorCourses.map(course => {
      const enrolledCount = course.enrollments.length;
      const maxEnrolls = Math.max(...allInstructorCourses.map(c => c.enrollments.length), 1);
      const popularityScore = Math.round((enrolledCount / maxEnrolls) * 100);
      return {
        course: course.title,
        popularity: popularityScore,
        enrollments: enrolledCount
      };
    });
  } else {
    const selectedCourse = targetCourses[0];
    const lessons = selectedCourse?.modules.flatMap(m => m.lessons) ?? [];
    const enrolledCount = selectedCourse?.enrollments.length ?? 0;
    performanceAnalytics = lessons.map(lesson => {
      const completedCount = lesson.progress.filter(p => p.completed).length;
      const masteryPercent = enrolledCount > 0 ? Math.round((completedCount / enrolledCount) * 100) : 0;
      return {
        course: lesson.title,
        popularity: masteryPercent,
        enrollments: completedCount
      };
    });
  }

  // 10. Student Engagement daily statistics for past 7 days
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const studentEngagement = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dayLabel = daysOfWeek[date.getDay()];
    
    const startOfDay = new Date(date.setHours(0,0,0,0));
    const endOfDay = new Date(date.setHours(23,59,59,999));
    
    let dailyActiveStudents = new Set();
    let dailyCompletions = 0;
    let dailyQuizAttempts = 0;
    
    for (const course of targetCourses) {
      course.enrollments.forEach(e => {
        if (e.enrolledAt >= startOfDay && e.enrolledAt <= endOfDay) {
          dailyActiveStudents.add(e.studentId);
        }
      });
      course.modules.flatMap(m => m.lessons).forEach(lesson => {
        lesson.progress.forEach(p => {
          if (p.completedAt && p.completedAt >= startOfDay && p.completedAt <= endOfDay) {
            dailyActiveStudents.add(p.studentId);
            dailyCompletions++;
          }
        });
      });
      course.quizzes.forEach(quiz => {
        quiz.quizSubmissions.forEach(qs => {
          if (qs.submittedAt >= startOfDay && qs.submittedAt <= endOfDay) {
            dailyActiveStudents.add(qs.studentId);
            dailyQuizAttempts++;
          }
        });
      });
    }
    
    studentEngagement.push({
      day: dayLabel,
      activeStudents: dailyActiveStudents.size,
      lessonsCompleted: dailyCompletions,
      quizAttempts: dailyQuizAttempts
    });
  }

  // 11. Course Performance (All Courses Table)
  const coursePerformance = allInstructorCourses.map(course => {
    const enrolledCount = course.enrollments.length;
    const lessons = course.modules.flatMap(m => m.lessons);
    
    let completionRate = 0;
    if (enrolledCount > 0 && lessons.length > 0) {
      let studentCompletions = 0;
      for (const enrollment of course.enrollments) {
        const compCount = lessons.reduce((sum, l) => {
          const prog = l.progress.find(p => p.studentId === enrollment.studentId);
          return sum + (prog && prog.completed ? 1 : 0);
        }, 0);
        studentCompletions += (compCount / lessons.length);
      }
      completionRate = Math.round((studentCompletions / enrolledCount) * 100);
    }
    
    let quizScores = [];
    for (const quiz of course.quizzes) {
      for (const sub of quiz.quizSubmissions) {
        quizScores.push(sub.percentage);
      }
    }
    const courseQuizAverage = quizScores.length > 0
      ? Math.round(quizScores.reduce((sum, s) => sum + s, 0) / quizScores.length)
      : 0;

    const courseRatings = course.reviews.map(r => r.rating);
    const courseRating = courseRatings.length > 0
      ? parseFloat((courseRatings.reduce((sum, r) => sum + r, 0) / courseRatings.length).toFixed(1))
      : 0;
      
    let health = 'No Data';
    if (enrolledCount > 0) {
      const signals = [completionRate];
      if (quizScores.length > 0) signals.push(courseQuizAverage);
      const worstSignal = Math.min(...signals);
      const bestSignal = Math.min(completionRate, quizScores.length > 0 ? courseQuizAverage : 100);

      health = 'Good';
      if (worstSignal < 60) health = 'Critical';
      else if (worstSignal < 75) health = 'Needs Review';
      else if (completionRate >= 85 && bestSignal >= 80) health = 'Excellent';
    }
    
    return {
      id: course.id,
      course: course.title,
      meta: `${course.modules.length} Modules • ${lessons.length} Lessons`,
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
    const lessons = course.modules.flatMap(m => m.lessons);
    const enrolledCount = course.enrollments.length;
    
    for (const lesson of lessons) {
      const completedCount = lesson.progress.filter(p => p.completed).length;
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
  const courses = allInstructorCourses.map(course => ({
    id: course.id,
    course: course.title
  }));

  // 15. Summary text array
  const summary = [
    `Overall Quiz Average stands at ${avgQuizScore}%`,
    `Managing ${allInstructorCourses.length} active courses and cohorts`,
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
          contents: {
            select: {
              duration: true,
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
      if (p.lesson.contents && p.lesson.contents.length > 0) {
        p.lesson.contents.forEach((c) => {
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

  // Calculate student percentile rank
  const allStudents = await prisma.studentProfile.findMany({
    select: {
      id: true,
      progress: {
        where: { completed: true },
        select: { id: true }
      }
    }
  });

  const studentCompletionCounts = allStudents.map(s => ({
    id: s.id,
    count: s.progress.length
  })).sort((a, b) => a.count - b.count);

  const myIndex = studentCompletionCounts.findIndex(s => s.id === studentId);
  let rankPercentile = 100;
  if (studentCompletionCounts.length > 0 && myIndex !== -1) {
    // percentile score is the percentage of students below this student
    rankPercentile = Math.round(((studentCompletionCounts.length - 1 - myIndex) / studentCompletionCounts.length) * 100);
  }

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