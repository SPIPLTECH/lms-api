const prisma = require("../../config/database");
const notificationService = require("../notifications/notification.service");
const {
  calculateEnrollmentExpiration,
  isEnrollmentExpired,
  getRemainingAccessDays,
} = require("../../utils/enrollmentExpiration");

const getEnrollments = async (
  studentId,
  courseId
) => {
  const where = {};

  if (studentId) {
    where.studentId = studentId;
  }

  if (courseId) {
    where.courseId = courseId;
  }

  const enrollments = await prisma.enrollment.findMany({
    where,
    orderBy: [
      { lastAccessedAt: { sort: "desc", nulls: "last" } },
      { enrolledAt: "desc" }
    ],
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
      },
      course: {
        select: {
          id: true,
          title: true,
          description: true,
          thumbnailUrl: true,
          accessDurationDays: true,
          // "SSC Class 10": a student enrolled only in such courses gets no
          // Submissions or Certificates in the web app.
          category: true,
          // false: the course keeps no progress, so the card shows none.
          sequentialLearning: true,
          creator: { select: { name: true } },
          modules: {
            select: {
              lessons: { select: { id: true } }
            }
          }
        }
      }
    }
  });

  const now = new Date();
  return enrollments.map((e) => ({
    ...e,
    isExpired: isEnrollmentExpired(e, now),
    remainingDays: getRemainingAccessDays(e.expiresAt, now),
  }));
};

const ApiError = require("../../utils/ApiError");

const createEnrollment = async (
  studentId,
  courseId
) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, status: true, accessDurationDays: true }
  });

  if (!course) {
    throw new ApiError(404, "Course not found");
  }

  if (course.status !== "PUBLISHED") {
    throw new ApiError(400, "This course is not open for enrollment.");
  }

  const existing =
    await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId
      }
    });

  if (existing) {
    throw new ApiError(400, "Already enrolled in this course");
  }

  const enrolledAt = new Date();
  const expiresAt = calculateEnrollmentExpiration(
    enrolledAt,
    course.accessDurationDays
  );

  const enrollment = await prisma.enrollment.create({
    data: {
      studentId,
      courseId,
      enrolledAt,
      expiresAt
    },
    include: {
      student: {
        include: {
          user: {
            select: {
              name: true
            }
          }
        }
      },
      course: {
        select: {
          title: true,
          creatorId: true
        }
      }
    }
  });

  try {
    await notificationService.createNotification(enrollment.course.creatorId, {
      title: "New Student Enrolled 🎓",
      message: `${enrollment.student.user.name} enrolled in your course "${enrollment.course.title}".`,
      type: "ENROLLMENT",
      link: `/courses/${courseId}/students`,
      eventId: `enrollment_${enrollment.id}`,
      actorId: enrollment.student.userId
    });
  } catch (error) {
    console.error("Error creating enrollment notification:", error.message);
  }

  return enrollment;
};

const deleteEnrollment = async (
  enrollmentId
) => {
  const existing = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
  if (!existing) {
    const error = new Error("Enrollment not found");
    error.statusCode = 404;
    throw error;
  }

  return await prisma.enrollment.delete({
    where: {
      id: enrollmentId
    }
  });
};

const updateLastAccessed = async (
  studentId,
  courseId
) => {
  if (!studentId || !courseId) return null;
  try {
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_courseId: {
          studentId,
          courseId
        }
      },
      select: { id: true, expiresAt: true }
    });
    if (!enrollment) return null;
    if (isEnrollmentExpired(enrollment)) {
      throw new ApiError(403, "Course access expired", "ENROLLMENT_EXPIRED");
    }

    return await prisma.enrollment.update({
      where: {
        id: enrollment.id
      },
      data: {
        lastAccessedAt: new Date()
      }
    });
  } catch (error) {
    if (error.code === "P2025") {
      return null;
    }
    throw error;
  }
};

/**
 * Reconciles missing or legacy enrollment expiration dates.
 * 
 * Rules:
 * - Only applies to courses where `accessDurationDays > 0`.
 * - Only updates enrollments where `expiresAt IS NULL`.
 * - If `courseId` is provided, limits to that course; otherwise handles all duration-configured courses.
 * - Enrollments where `expiresAt` is already set are never overwritten.
 * - Self-paced/lifetime courses (`accessDurationDays IS NULL` or `<= 0`) are never touched.
 * - Sets `expiresAt = calculateEnrollmentExpiration(enrolledAt, course.accessDurationDays)`.
 */
const reconcileEnrollmentExpirations = async (courseId = null) => {
  const courseWhere = {
    accessDurationDays: {
      gt: 0,
    },
  };
  if (courseId) {
    courseWhere.id = courseId;
  }

  const eligibleCourses = await prisma.course.findMany({
    where: courseWhere,
    select: {
      id: true,
      accessDurationDays: true,
    },
  });

  if (eligibleCourses.length === 0) {
    return { reconciledCount: 0, affectedCourseIds: [] };
  }

  const eligibleCourseMap = new Map(eligibleCourses.map((c) => [c.id, c.accessDurationDays]));
  const targetCourseIds = Array.from(eligibleCourseMap.keys());

  const enrollmentsToReconcile = await prisma.enrollment.findMany({
    where: {
      courseId: { in: targetCourseIds },
      expiresAt: null,
    },
    select: {
      id: true,
      courseId: true,
      enrolledAt: true,
    },
  });

  if (enrollmentsToReconcile.length === 0) {
    return { reconciledCount: 0, affectedCourseIds: targetCourseIds };
  }

  const updates = enrollmentsToReconcile.map((e) => {
    const durationDays = eligibleCourseMap.get(e.courseId);
    const calculatedExpiresAt = calculateEnrollmentExpiration(e.enrolledAt, durationDays);
    return prisma.enrollment.update({
      where: { id: e.id },
      data: { expiresAt: calculatedExpiresAt },
    });
  });

  await prisma.$transaction(updates);

  return {
    reconciledCount: enrollmentsToReconcile.length,
    affectedCourseIds: targetCourseIds,
  };
};

/**
 * Synchronizes enrollment expiration dates when an instructor updates a course's accessDurationDays.
 * - If durationDays > 0: recalculates `expiresAt = calculateEnrollmentExpiration(enrolledAt, durationDays)` for all enrollments in this course.
 * - If durationDays is null or <= 0: resets `expiresAt = null` (self-paced/lifetime) for all enrollments in this course.
 */
const syncEnrollmentExpirationsForCourse = async (courseId, durationDays) => {
  if (!courseId) return { updatedCount: 0 };

  const enrollments = await prisma.enrollment.findMany({
    where: { courseId },
    select: { id: true, enrolledAt: true, expiresAt: true },
  });

  if (enrollments.length === 0) return { updatedCount: 0 };

  const updates = enrollments.map((e) => {
    const newExpiresAt = (durationDays && durationDays > 0)
      ? calculateEnrollmentExpiration(e.enrolledAt, durationDays)
      : null;
    return prisma.enrollment.update({
      where: { id: e.id },
      data: { expiresAt: newExpiresAt },
    });
  });

  await prisma.$transaction(updates);

  return { updatedCount: enrollments.length };
};

module.exports = {
  getEnrollments,
  createEnrollment,
  deleteEnrollment,
  updateLastAccessed,
  reconcileEnrollmentExpirations,
  syncEnrollmentExpirationsForCourse,
};