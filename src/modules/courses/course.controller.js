const fs = require("fs");
const courseService = require("./course.service");

const getCourses = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const { courses, total } = await courseService.getCourses(
      req.user.role,
      req.user.id,
      {
        search: req.query.search || "",
        page,
        limit,
        status: req.query.status || undefined,
        category: req.query.category || undefined,
        level: req.query.level || undefined,
        sortBy: req.query.sortBy || undefined,
        scope: req.query.scope || undefined,
      }
    );

    res.status(200).json({
      success: true,
      data: courses,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
const getCourseStatusCounts = async (req, res, next) => {
  try {
    const counts = await courseService.getCourseStatusCounts(req.user.id);
    res.json({ success: true, data: counts });
  } catch (error) {
    next(error);
  }
};

const getCourseById = async (
  req,
  res,
  next
) => {
  try {
    const course =
      await courseService.getCourseById(
        req.params.courseId,
        req.user?.role,
        req.user?.id
      );

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found"
      });
    }

    res.json({
      success: true,
      data: course
    });
  } catch (error) {
    next(error);
  }
};

const createCourse = async (
  req,
  res,
  next
) => {
  try {
    const course =
      await courseService.createCourse(
        req.body,
        req.user.id
      );

    res.status(201).json({
      success: true,
      data: course,
      message: "Course created successfully"
    });
  } catch (error) {
    next(error);
  }
};

const updateCourse = async (
  req,
  res,
  next
) => {
  try {
    const course =
      await courseService.updateCourse(
        req.params.courseId,
        req.body
      );

    res.json({
      success: true,
      data: course,
      message: "Course updated successfully"
    });
  } catch (error) {
    next(error);
  }
};

const validatePublish = async (req, res, next) => {
  try {
    const validation = await courseService.validateCourseForPublish(
      req.params.courseId
    );
    res.json({
      success: true,
      data: validation
    });
  } catch (error) {
    next(error);
  }
};

const publishCourse = async (req, res, next) => {
  try {
    const course = await courseService.publishCourse(
      req.params.courseId,
      req.user.id,
      req.user.role
    );
    res.json({
      success: true,
      data: course,
      message: "Course published successfully"
    });
  } catch (error) {
    next(error);
  }
};

const unpublishCourse = async (req, res, next) => {
  try {
    const course = await courseService.unpublishCourse(
      req.params.courseId,
      req.user.id,
      req.user.role
    );
    res.json({
      success: true,
      data: course,
      message: "Course unpublished successfully"
    });
  } catch (error) {
    next(error);
  }
};

const archiveCourse = async (req, res, next) => {
  try {
    const course = await courseService.archiveCourse(
      req.params.courseId,
      req.user.id,
      req.user.role
    );
    res.json({
      success: true,
      data: course,
      message: "Course archived successfully"
    });
  } catch (error) {
    next(error);
  }
};

const restoreCourse = async (req, res, next) => {
  try {
    const course = await courseService.restoreCourse(
      req.params.courseId,
      req.user.id,
      req.user.role
    );
    res.json({
      success: true,
      data: course,
      message: "Course restored to DRAFT successfully"
    });
  } catch (error) {
    next(error);
  }
};

const updateStatus = async (
  req,
  res,
  next
) => {
  try {
    const course =
      await courseService.updateStatus(
        req.params.courseId,
        req.body.status,
        req.user.id,
        req.user.role
      );

    res.json({
      success: true,
      data: course,
      message: "Course status updated successfully"
    });
  } catch (error) {
    next(error);
  }
};

const deleteCourse = async (
  req,
  res,
  next
) => {
  try {
    await courseService.deleteCourse(
      req.params.courseId,
      req.user.id,
      req.user.role
    );

    res.status(200).json({
      success: true,
      message: "Course deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};
const duplicateCourse = async (
  req,
  res,
  next
) => {
  try {
    const course = await courseService.duplicateCourse(
      req.params.courseId,
      req.user.id
    );

    res.status(201).json({
      success: true,
      data: course,
      message: "Course duplicated successfully"
    });
  } catch (error) {
    next(error);
  }
};

const getCourseStudents = async (
  req,
  res,
  next
) => {
  try {
    const students =
      await courseService.getCourseStudents(
        req.params.courseId
      );

    res.json({
      success: true,
      data: students
    });
  } catch (error) {
    next(error);
  }
};

const sendAnnouncement = async (req, res, next) => {
  try {
    const { title, message } = req.body;
    const notificationService = require("../notifications/notification.service");
    const announcementService = require("../announcements/announcement.service");
    await announcementService.createAnnouncement({
      courseId: req.params.courseId,
      instructorId: req.user.id,
      title,
      message
    });
    await notificationService.notifyEnrolledStudents(req.params.courseId, { title, message });
    res.json({
      success: true,
      message: "Announcement broadcasted successfully."
    });
  } catch (error) {
    next(error);
  }
};

const exportCourse = async (req, res, next) => {
  try {
    const packageResult = await courseService.exportCourse(req.params.courseId);

    res.download(packageResult.filePath, packageResult.filename, (err) => {
      // Clean up temporary ZIP file on disk after response finishes
      if (fs.existsSync(packageResult.filePath)) {
        try {
          fs.unlinkSync(packageResult.filePath);
        } catch (unlinkErr) {
          // Ignore unlink cleanup error
        }
      }
      if (err && !res.headersSent) {
        next(err);
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCourses,
  getCourseById,
  createCourse,
  updateCourse,
  updateStatus,
  deleteCourse,
  validatePublish,
  publishCourse,
  unpublishCourse,
  archiveCourse,
  restoreCourse,
  duplicateCourse,
  getCourseStudents,
  sendAnnouncement,
  getCourseStatusCounts,
  exportCourse
};
