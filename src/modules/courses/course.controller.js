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
        req.user.role
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

const updateStatus = async (
  req,
  res,
  next
) => {
  try {
    const course =
      await courseService.updateStatus(
        req.params.courseId,
        req.body.status
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
      req.params.courseId
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

const getCourseBatches = async (req, res, next) => {
  try {
    const batches = await courseService.getCourseBatches(req.params.courseId);
    res.json({
      success: true,
      data: batches
    });
  } catch (error) {
    next(error);
  }
};

const getInstructorBatches = async (req, res, next) => {
  try {
    const { courseId, status, startDate, endDate } = req.query;
    const batches = await courseService.getInstructorBatches(req.user.id, {
      courseId,
      status,
      startDate,
      endDate
    });
    res.json({
      success: true,
      data: batches
    });
  } catch (error) {
    next(error);
  }
};

const createCourseBatch = async (req, res, next) => {
  try {
    const batch = await courseService.createCourseBatch(req.params.courseId, req.body);
    res.status(201).json({
      success: true,
      data: batch,
      message: "Course batch created successfully"
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
  duplicateCourse,
  getCourseStudents,
  sendAnnouncement,
  getCourseBatches,
  getInstructorBatches,
  createCourseBatch,
  getCourseStatusCounts
};