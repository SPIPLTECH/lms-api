const enrollmentService = require(
  "./enrollment.service"
);

const getEnrollments = async (
  req,
  res,
  next
) => {
  try {
    const enrollments =
      await enrollmentService.getEnrollments(
        req.query.userId,
        req.query.courseId
      );

    res.json({
      success: true,
      data: enrollments
    });
  } catch (error) {
    next(error);
  }
};

const createEnrollment = async (
  req,
  res,
  next
) => {
  try {
    const enrollment =
      await enrollmentService.createEnrollment(
        req.user.id,
        req.body.courseId
      );

    res.status(201).json({
      success: true,
      data: enrollment
    });
  } catch (error) {
    next(error);
  }
};

const deleteEnrollment = async (
  req,
  res,
  next
) => {
  try {
    await enrollmentService.deleteEnrollment(
      req.params.enrollmentId
    );

    res.json({
      success: true,
      message:
        "Enrollment removed successfully"
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getEnrollments,
  createEnrollment,
  deleteEnrollment
};