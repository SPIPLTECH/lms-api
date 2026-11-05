const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");

const submitFeedback = async (userId, courseId, data) => {
  const student = await prisma.studentProfile.findUnique({
    where: { userId },
  });

  if (!student) {
    throw new ApiError(404, "Student profile not found");
  }

  // Verify enrollment
  const enrollment = await prisma.enrollment.findUnique({
    where: {
      studentId_courseId: {
        studentId: student.id,
        courseId,
      },
    },
  });

  if (!enrollment) {
    throw new ApiError(403, "You must be enrolled in this course to submit feedback");
  }

  if (!enrollment.completed) {
    throw new ApiError(400, "Feedback can only be submitted after course completion");
  }

  // Check duplicate submission
  const existingReview = await prisma.review.findUnique({
    where: {
      studentId_courseId: {
        studentId: student.id,
        courseId,
      },
    },
  });

  if (existingReview) {
    throw new ApiError(409, "You have already submitted feedback for this course");
  }

  const overall = Number(data.overallRating || data.rating || 5);
  const commentText = data.comments !== undefined ? data.comments : data.review;

  return prisma.review.create({
    data: {
      courseId,
      studentId: student.id,
      rating: overall,
      overallRating: overall,
      contentQualityRating: data.contentQualityRating !== undefined && data.contentQualityRating !== null ? Number(data.contentQualityRating) : null,
      quizzesRating: data.quizzesRating !== undefined && data.quizzesRating !== null ? Number(data.quizzesRating) : null,
      assignmentsRating: data.assignmentsRating !== undefined && data.assignmentsRating !== null ? Number(data.assignmentsRating) : null,
      syllabusRating: data.syllabusRating !== undefined && data.syllabusRating !== null ? Number(data.syllabusRating) : null,
      teachingRating: data.teachingRating !== undefined && data.teachingRating !== null ? Number(data.teachingRating) : null,
      review: commentText || null,
      comments: commentText || null,
    },
    include: {
      student: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      course: { select: { id: true, title: true } },
    },
  });
};

const getMyFeedback = async (userId, courseId) => {
  const student = await prisma.studentProfile.findUnique({
    where: { userId },
  });

  if (!student) {
    return {
      isEnrolled: false,
      hasCompletedCourse: false,
      feedback: null,
    };
  }

  const [enrollment, review] = await Promise.all([
    prisma.enrollment.findUnique({
      where: {
        studentId_courseId: {
          studentId: student.id,
          courseId,
        },
      },
      select: {
        completed: true,
        progressPercent: true,
      },
    }),
    prisma.review.findUnique({
      where: {
        studentId_courseId: {
          studentId: student.id,
          courseId,
        },
      },
      include: {
        course: { select: { id: true, title: true } },
      },
    }),
  ]);

  return {
    isEnrolled: !!enrollment,
    hasCompletedCourse: !!enrollment?.completed,
    progressPercent: enrollment?.progressPercent || 0,
    feedback: review || null,
  };
};

const getCourseFeedback = async (requester, courseId) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true, creatorId: true },
  });

  if (!course) {
    throw new ApiError(404, "Course not found");
  }

  if (requester.role === "INSTRUCTOR" && course.creatorId !== requester.id) {
    throw new ApiError(403, "Forbidden: you do not have permission to view feedback for this course");
  }

  if (requester.role === "STUDENT") {
    throw new ApiError(403, "Students cannot view aggregate feedback");
  }

  const reviews = await prisma.review.findMany({
    where: { courseId },
    include: {
      student: {
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Calculate averages
  const count = reviews.length;
  let sumOverall = 0;
  let sumContent = 0;
  let countContent = 0;
  let sumQuizzes = 0;
  let countQuizzes = 0;
  let sumAssignments = 0;
  let countAssignments = 0;
  let sumSyllabus = 0;
  let countSyllabus = 0;
  let sumTeaching = 0;
  let countTeaching = 0;

  for (const r of reviews) {
    const o = r.overallRating || r.rating || 0;
    sumOverall += o;

    if (r.contentQualityRating) {
      sumContent += r.contentQualityRating;
      countContent++;
    }
    if (r.quizzesRating) {
      sumQuizzes += r.quizzesRating;
      countQuizzes++;
    }
    if (r.assignmentsRating) {
      sumAssignments += r.assignmentsRating;
      countAssignments++;
    }
    if (r.syllabusRating) {
      sumSyllabus += r.syllabusRating;
      countSyllabus++;
    }
    if (r.teachingRating) {
      sumTeaching += r.teachingRating;
      countTeaching++;
    }
  }

  const round = (val) => (val ? Math.round(val * 10) / 10 : 0);

  return {
    totalReviews: count,
    averages: {
      overall: count > 0 ? round(sumOverall / count) : 0,
      contentQuality: countContent > 0 ? round(sumContent / countContent) : 0,
      quizzes: countQuizzes > 0 ? round(sumQuizzes / countQuizzes) : 0,
      assignments: countAssignments > 0 ? round(sumAssignments / countAssignments) : 0,
      syllabus: countSyllabus > 0 ? round(sumSyllabus / countSyllabus) : 0,
      teaching: countTeaching > 0 ? round(sumTeaching / countTeaching) : 0,
    },
    reviews,
  };
};

module.exports = {
  submitFeedback,
  getMyFeedback,
  getCourseFeedback,
};
