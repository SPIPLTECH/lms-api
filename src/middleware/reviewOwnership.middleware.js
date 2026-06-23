const prisma = require("../config/database");

const verifyReviewOwnership = async (
  req,
  res,
  next
) => {
  try {
    const review = await prisma.review.findUnique({
      where: {
        id: req.params.reviewId
      }
    });

    if (!review) {
      return res.status(404).json({
        message: "Review not found"
      });
    }

    if (
      req.user.role !== "ADMIN" &&
      review.userId !== req.user.id
    ) {
      return res.status(403).json({
        message: "Access denied"
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = verifyReviewOwnership;