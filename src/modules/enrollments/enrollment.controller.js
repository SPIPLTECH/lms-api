const enrollmentService = require(
  "./enrollment.service"
);

const getEnrollments = async (
  req,
  res,
  next
) => {
  try {
    const studentId =
      req.user.role === "ADMIN"
        ? req.query.studentId
        : req.studentId;

    const enrollments =
      await enrollmentService.getEnrollments(
        studentId,
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
        req.studentId,
        req.body.courseId
      );

    res.status(201).json({
      success: true,
      data: enrollment
    });
  } catch (error) {
    if (
      error.message ===
      "Already enrolled in this course"
    ) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

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

const trackCourseAccess = async (
  req,
  res,
  next
) => {
  try {
    await enrollmentService.updateLastAccessed(
      req.studentId,
      req.params.courseId
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getEnrollments,
  createEnrollment,
  deleteEnrollment,
  trackCourseAccess
};