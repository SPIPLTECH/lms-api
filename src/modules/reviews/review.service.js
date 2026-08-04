const prisma = require("../../config/database");
const notificationService = require("../notifications/notification.service");

const getReviews = async (
  studentId,
  courseId,
  page = 1,
  limit = 10
) => {
  const where = {};

  if (studentId) {
    where.studentId = studentId;
  }

  if (courseId) {
    where.courseId = courseId;
  }

  const skip = (page - 1) * limit;

  return prisma.review.findMany({
    where,
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
          title: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    skip,
    take: limit
  });
};

const getReviewById = async (reviewId) => {
  return prisma.review.findUnique({
    where: {
      id: reviewId
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
      },
      course: {
        select: {
          id: true,
          title: true
        }
      }
    }
  });
};

const createReview = async (
  data,
  studentId
) => {
  const course =
    await prisma.course.findUnique({
      where: {
        id: data.courseId
      }
    });

  if (!course) {
    throw new Error("Course not found");
  }

  const enrollment =
    await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId: data.courseId
      }
    });

  if (!enrollment) {
    throw new Error(
      "You must enroll before reviewing this course"
    );
  }

  const existingReview =
    await prisma.review.findFirst({
      where: {
        studentId,
        courseId: data.courseId
      }
    });

  if (existingReview) {
    throw new Error(
      "You have already reviewed this course"
    );
  }

  const review = await prisma.review.create({
    data: {
      rating: data.rating,
      review: data.review,
      courseId: data.courseId,
      studentId
    },
    include: {
      student: {
        include: {
          user: {
            select: {
              id: true,
              name: true
            }
          }
        }
      },
      course: {
        select: {
          id: true,
          title: true
        }
      }
    }
  });

  try {
    await notificationService.createNotification(course.creatorId, {
      title: "New Course Review 🌟",
      message: `${review.student.user.name} reviewed your course "${review.course.title}" with a rating of ${review.rating}/5.`,
      type: "COURSE_REVIEW",
      link: `/courses/${review.courseId}/reviews`
    });
  } catch (error) {
    console.error("Error creating course review notification:", error.message);
  }

  return review;
};

const updateReview = async (
  reviewId,
  data
) => {
  return prisma.review.update({
    where: {
      id: reviewId
    },
    data: {
      rating: data.rating,
      review: data.review
    },
    include: {
      student: {
        include: {
          user: {
            select: {
              id: true,
              name: true
            }
          }
        }
      },
      course: {
        select: {
          id: true,
          title: true
        }
      }
    }
  });
};

const deleteReview = async (
  reviewId
) => {
  return prisma.review.delete({
    where: {
      id: reviewId
    }
  });
};

/** Reviews across every course the instructor owns, filterable for the Feedback page. */
const getInstructorReviews = async (instructorId, filters = {}) => {
  const courseWhere = { creatorId: instructorId };
  if (filters.courseId) {
    courseWhere.id = filters.courseId;
  }

  const where = { course: courseWhere };

  if (filters.rating) {
    where.rating = parseInt(filters.rating);
  }
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
    if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
  }

  const [reviews, stats] = await Promise.all([
    prisma.review.findMany({
      where,
      include: {
        student: { include: { user: { select: { id: true, name: true } } } },
        course: { select: { id: true, title: true } }
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.review.aggregate({
      where,
      _avg: { rating: true },
      _count: { id: true }
    })
  ]);

  return {
    reviews,
    averageRating: stats._avg.rating || 0,
    totalReviews: stats._count.id
  };
};

const getCourseReviewStats =
  async (courseId) => {
    const stats =
      await prisma.review.aggregate({
        where: {
          courseId
        },
        _avg: {
          rating: true
        },
        _count: {
          id: true
        }
      });

    return {
      averageRating:
        stats._avg.rating || 0,
      totalReviews:
        stats._count.id
    };
  };

module.exports = {
  getReviews,
  getReviewById,
  getInstructorReviews,
  createReview,
  updateReview,
  deleteReview,
  getCourseReviewStats
};