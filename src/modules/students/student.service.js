const prisma = require("../../config/database");

const getStudents = async (user) => {
  const whereClause = {
    user: {
      role: "STUDENT",
    },
  };

  if (user && user.role === "INSTRUCTOR") {
    const instructorCourses = await prisma.course.findMany({
      where: { creatorId: user.id },
      select: { id: true },
    });
    const courseIds = instructorCourses.map((c) => c.id);

    whereClause.enrollments = {
      some: {
        courseId: { in: courseIds },
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
              modules: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          },
        },
      },
      // No `progress` relation here: the Progress model is gone from the
      // schema, and unlike the prisma.progress shim in config/database.js a
      // nested include is passed straight to Prisma, which rejects the unknown
      // field and fails the whole query. Completion now comes from
      // ContentProgress, loaded in bulk below.
      assignmentSubmissions: {
        include: {
          assignment: {
            select: { id: true, title: true, dueDate: true },
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

  // Completion is content-based (ContentProgress), not lesson-based — the
  // Progress model this used to read is gone. Content can hang off a course at
  // any of four levels, so every level is counted; missing one silently
  // undercounts the denominator and inflates everyone's percentage.
  //
  // Loaded in bulk rather than per student: three queries total regardless of
  // how many students come back.
  const studentIds = students.map((s) => s.id);
  const courseIds = [
    ...new Set(
      students.flatMap((s) => s.enrollments.map((e) => e.course?.id).filter(Boolean))
    ),
  ];

  const contents = courseIds.length
    ? await prisma.content.findMany({
        where: {
          OR: [
            { courseId: { in: courseIds } },
            { module: { courseId: { in: courseIds } } },
            { lesson: { module: { courseId: { in: courseIds } } } },
            { topic: { lesson: { module: { courseId: { in: courseIds } } } } },
          ],
        },
        select: {
          id: true,
          courseId: true,
          module: { select: { id: true, courseId: true } },
          lesson: { select: { module: { select: { id: true, courseId: true } } } },
          topic: {
            select: {
              lesson: { select: { module: { select: { id: true, courseId: true } } } },
            },
          },
        },
      })
    : [];

  // contentId -> owning course, and contentId -> owning module (null for
  // content attached straight to the course).
  const courseContentIds = new Map();
  const moduleContentIds = new Map();
  for (const c of contents) {
    const owner =
      c.topic?.lesson?.module || c.lesson?.module || c.module || null;
    const cid = owner?.courseId || c.courseId;
    if (!cid) continue;
    if (!courseContentIds.has(cid)) courseContentIds.set(cid, new Set());
    courseContentIds.get(cid).add(c.id);
    if (owner?.id) {
      if (!moduleContentIds.has(owner.id)) moduleContentIds.set(owner.id, new Set());
      moduleContentIds.get(owner.id).add(c.id);
    }
  }

  const visitRows = studentIds.length
    ? await prisma.contentProgress.findMany({
        where: { studentId: { in: studentIds } },
        select: { studentId: true, contentId: true },
      })
    : [];

  const visitsByStudent = new Map();
  for (const v of visitRows) {
    if (!visitsByStudent.has(v.studentId)) visitsByStudent.set(v.studentId, new Set());
    visitsByStudent.get(v.studentId).add(v.contentId);
  }

  const countVisited = (visited, ids) => {
    if (!ids) return 0;
    let n = 0;
    for (const id of ids) if (visited.has(id)) n += 1;
    return n;
  };

  return students.map((student) => {
    const firstEnrollment = student.enrollments[0];
    const courseTitle = firstEnrollment?.course?.title || "General Course";

    const visited = visitsByStudent.get(student.id) || new Set();

    let totalContentCount = 0;
    let visitedContentCount = 0;
    // Dedupe: the same course enrolled twice must not count twice.
    const countedCourseIds = new Set();
    for (const e of student.enrollments) {
      const cid = e.course?.id;
      if (!cid || countedCourseIds.has(cid)) continue;
      countedCourseIds.add(cid);
      const ids = courseContentIds.get(cid);
      if (!ids) continue;
      totalContentCount += ids.size;
      visitedContentCount += countVisited(visited, ids);
    }

    const progressPercent = totalContentCount > 0
      ? Math.round((visitedContentCount / totalContentCount) * 100)
      : 0;

    // Every course this student is enrolled in, not just the first. The
    // directory's course filter matches against this — filtering on the single
    // `course` title below silently hid anyone whose first enrollment happened
    // to be a different course.
    const enrolledCourses = [];
    const seenCourseIds = new Set();
    for (const e of student.enrollments) {
      if (!e.course?.id || seenCourseIds.has(e.course.id)) continue;
      seenCourseIds.add(e.course.id);
      enrolledCourses.push({ id: e.course.id, title: e.course.title });
    }

    const totalSubmissions = student.assignmentSubmissions.length;
    const gradedSubmissions = student.assignmentSubmissions.filter((a) => a.status === "Graded" || a.grade).length;
    const assignmentRate = totalSubmissions > 0
      ? Math.round((gradedSubmissions / totalSubmissions) * 100)
      : 0;

    // These four labels are exactly the filter chips on the Student Directory,
    // so every student must land on one of them. "Not Started" means literally
    // zero content visited — it used to swallow everyone under 40%, which left
    // a student at 39% indistinguishable from one who had never opened the
    // course.
    let status;
    if (progressPercent === 0) status = "Not Started";
    else if (progressPercent >= 85) status = "Top Performer";
    else if (progressPercent >= 60) status = "Behind Average";
    else status = "Struggling";

    const joinedDateStr = new Date(student.createdAt || student.user.createdAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    return {
      id: student.id,
      userId: student.user.id,
      name: student.user.name,
      email: student.user.email,
      role: student.user.role,
      course: courseTitle,
      courses: enrolledCourses,
      courseIds: enrolledCourses.map((c) => c.id),
      status: status,
      progress: progressPercent,
      assignmentRate: assignmentRate,
      // No attendance-tracking feature exists yet, so this is intentionally
      // null rather than a fabricated number - frontend should render "N/A".
      attendanceRate: null,
      joinedDate: joinedDateStr,
      assignments: student.assignmentSubmissions.map((as) => ({
        id: as.id,
        title: as.assignment?.title || "Assignment",
        status: as.status || "Submitted",
        score: as.grade ? parseInt(as.grade, 10) : null,
        maxScore: 100,
        date: new Date(as.submittedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      })),
      modules: (firstEnrollment?.course?.modules || []).map((m) => {
        const moduleIds = moduleContentIds.get(m.id);
        const moduleTotal = moduleIds ? moduleIds.size : 0;
        const moduleVisited = countVisited(visited, moduleIds);
        const moduleProgress = moduleTotal > 0
          ? Math.round((moduleVisited / moduleTotal) * 100)
          : 0;

        return {
          name: m.title,
          progress: moduleProgress,
          status: moduleProgress === 100 ? "Completed" : moduleProgress > 0 ? "In Progress" : "Not Started",
        };
      }),
      certificates: student.certificates.map((c) => ({
        id: c.id,
        title: c.course?.title || "Certificate of Completion",
        date: new Date(c.issuedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
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

const getStudentProgress = async (studentId) => {
  const progress = await prisma.progress.findMany({
    where: {
      studentId
    },
    include: {
      lesson: true
    }
  });

  const totalLessons = progress.length;
  const completedLessons = progress.filter(
    (item) => item.completed
  ).length;

  const completionPercentage =
    totalLessons === 0
      ? 0
      : Math.round(
          (completedLessons / totalLessons) * 100
        );

  return {
    totalLessons,
    completedLessons,
    completionPercentage,
    progress
  };
};

module.exports = {
  getStudents,
  getStudentById,
  updateStudent,
  getStudentProgress
};
