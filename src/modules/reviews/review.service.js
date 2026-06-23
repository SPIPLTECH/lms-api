const prisma = require("../../config/database");

const getReviews = async (
userId,
courseId,
page = 1,
limit = 10
) => {
const where = {};

if (userId) {
where.userId = userId;
}

if (courseId) {
where.courseId = courseId;
}

const skip = (page - 1) * limit;

return prisma.review.findMany({
where,
include: {
user: {
select: {
id: true,
name: true,
email: true
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
user: {
select: {
id: true,
name: true,
email: true
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
userId
) => {

const course =
await prisma.course.findUnique({
where: {
id: data.courseId
}
});

if (!course) {
throw new Error(
"Course not found"
);
}

const enrollment =
await prisma.enrollment.findFirst({
where: {
userId,
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
userId,
courseId: data.courseId
}
});

if (existingReview) {
throw new Error(
"You have already reviewed this course"
);
}

return prisma.review.create({
data: {
rating: data.rating,
review: data.review,
courseId: data.courseId,
userId
},
include: {
user: {
select: {
id: true,
name: true
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
user: {
select: {
id: true,
name: true
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
// const getCourseReviewStats =
//   async (courseId) => {

//     const stats =
//       await prisma.review.aggregate({
//         where: {
//           courseId
//         },
//         _avg: {
//           rating: true
//         },
//         _count: {
//           id: true
//         }
//       });

//     return {
//       averageRating:
//         stats._avg.rating || 0,
//       totalReviews:
//         stats._count.id
//     };
//   };
module.exports = {
  getReviews,
  getReviewById,
  createReview,
  updateReview,
  deleteReview,
  getCourseReviewStats
};
