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

    const totalSubmissions = relevantAssignmentSubmissions.length;
    const gradedSubmissions = relevantAssignmentSubmissions.filter((a) => a.status === "Graded" || a.grade).length;
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
      certificates: relevantCertificates.map((c) => ({
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
