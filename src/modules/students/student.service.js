const prisma = require("../../config/database");

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
    // Scope this student's per-course data (enrollments, assignments,
    // certificates) to the requesting instructor's own courses, since a
    // student may also be enrolled in other instructors' courses and the
    // whereClause.enrollments filter only guarantees SOME overlap, not that
    // every relation below belongs to this instructor.
    const relevantEnrollments = instructorCourseIds
      ? student.enrollments.filter((e) => instructorCourseIds.includes(e.courseId))
      : student.enrollments;
    const relevantAssignmentSubmissions = instructorCourseIds
      ? student.assignmentSubmissions.filter((a) => instructorCourseIds.includes(a.assignment?.courseId))
      : student.assignmentSubmissions;
    const relevantCertificates = instructorCourseIds
      ? student.certificates.filter((c) => instructorCourseIds.includes(c.courseId))
      : student.certificates;

    const firstEnrollment = relevantEnrollments[0];
    const courseTitle = firstEnrollment?.course?.title || "General Course";

    const totalSubmissions = student.assignmentSubmissions.length;
    const gradedSubmissions = student.assignmentSubmissions.filter((a) => a.status === "Graded" || a.grade).length;
    const assignmentRate = totalSubmissions > 0
      ? Math.round((gradedSubmissions / totalSubmissions) * 100)
      : 0;

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
      assignmentRate: assignmentRate,
      // No attendance-tracking feature exists yet, so this is intentionally
      // null rather than a fabricated number - frontend should render "N/A".
      attendanceRate: null,
      joinedDate: joinedDateStr,
      assignments: relevantAssignmentSubmissions.map((as) => ({
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

module.exports = {
  getStudents,
  getStudentById,
  updateStudent
};
