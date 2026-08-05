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

const createBatchAnnouncement = async (req, res, next) => {
  try {
    const { title, message } = req.body;
    const notificationService = require("../notifications/notification.service");
    const announcementService = require("../announcements/announcement.service");
    const batchId = req.params.batchId;
    const courseId = req.batch.courseId;

    const announcement = await announcementService.createAnnouncement({
      courseId,
      instructorId: req.user.id,
      title,
      message,
      batchId
    });
    await notificationService.notifyEnrolledStudents(courseId, { title, message }, batchId);

    res.status(201).json({
      success: true,
      data: announcement,
      message: "Announcement sent to batch."
    });
  } catch (error) {
    next(error);
  }
};

const getBatchAnnouncements = async (req, res, next) => {
  try {
    const announcementService = require("../announcements/announcement.service");
    const announcements = await announcementService.getBatchAnnouncements(req.params.batchId);
    res.json({
      success: true,
      data: announcements
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

const getMyStudentBatches = async (req, res, next) => {
  try {
    const { courseId, status } = req.query;
    const batches = await courseService.getStudentBatches(req.studentId, {
      courseId,
      status
    });
    res.json({
      success: true,
      data: batches
    });
  } catch (error) {
    next(error);
  }
};

const getBatchPerformanceOverview = async (req, res, next) => {
  try {
    const { courseId, batchId, startDate, endDate } = req.query;
    const overview = await courseService.getBatchPerformanceOverview(req.user.id, {
      courseId,
      batchId,
      startDate,
      endDate
    });
    res.json({
      success: true,
      data: overview
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

const getBatchById = async (req, res, next) => {
  try {
    const batch = await courseService.getBatchById(req.params.batchId);
    res.json({
      success: true,
      data: batch
    });
  } catch (error) {
    next(error);
  }
};

const getEnrollableStudentsForBatch = async (req, res, next) => {
  try {
    const students = await courseService.getEnrollableStudentsForBatch(req.params.batchId);
    res.json({
      success: true,
      data: students
    });
  } catch (error) {
    next(error);
  }
};

const addStudentToBatch = async (req, res, next) => {
  try {
    const batch = await courseService.addStudentToBatch(req.params.batchId, req.body.studentId);
    res.status(201).json({
      success: true,
      data: batch,
      message: "Student added to batch"
    });
  } catch (error) {
    next(error);
  }
};

const removeStudentFromBatch = async (req, res, next) => {
  try {
    const batch = await courseService.removeStudentFromBatch(req.params.batchId, req.params.studentId);
    res.json({
      success: true,
      data: batch,
      message: "Student removed from batch"
    });
  } catch (error) {
    next(error);
  }
};

const getBatchDetailDashboard = async (req, res, next) => {
  try {
    const dashboard = await courseService.getBatchDetailDashboard(req.params.batchId);
    res.json({
      success: true,
      data: dashboard
    });
  } catch (error) {
    next(error);
  }
};

const updateBatchStatus = async (req, res, next) => {
  try {
    const batch = await courseService.updateBatchStatus(req.params.batchId, req.body.status);
    res.json({
      success: true,
      data: batch,
      message: "Batch status updated"
    });
  } catch (error) {
    next(error);
  }
};

const startBatchConversation = async (req, res, next) => {
  try {
    const conversationService = require("../conversations/conversation.service");
    const conversation = await conversationService.startBatchConversation(
      req.params.batchId,
      req.user.id
    );
    res.status(201).json({
      success: true,
      data: conversation,
      message: "Batch conversation ready"
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
  getMyStudentBatches,
  getBatchPerformanceOverview,
  createCourseBatch,
  getCourseStatusCounts,
  getBatchById,
  getEnrollableStudentsForBatch,
  addStudentToBatch,
  removeStudentFromBatch,
  getBatchDetailDashboard,
  updateBatchStatus,
  createBatchAnnouncement,
  getBatchAnnouncements,
  startBatchConversation
};