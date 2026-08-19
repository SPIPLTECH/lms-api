const batchService = require("./batch.service");

const createBatch = async (req, res, next) => {
  try {
    const { courseIds, ...data } = req.body;
    const batch = await batchService.createBatch(data, courseIds);

    res.status(201).json({
      success: true,
      data: batch,
      message: "Batch created successfully",
    });
  } catch (error) {
    next(error);
  }
};

const listBatches = async (req, res, next) => {
  try {
    const { courseId, status, startDate, endDate, search } = req.query;
    const batches = await batchService.listBatches(req.user, {
      courseId,
      status,
      startDate,
      endDate,
      search,
    });

    res.json({
      success: true,
      data: batches,
    });
  } catch (error) {
    next(error);
  }
};

const getBatchPerformanceOverview = async (req, res, next) => {
  try {
    const { courseId, batchId, startDate, endDate, search } = req.query;
    const overview = await batchService.getBatchPerformanceOverview(req.user, {
      courseId,
      batchId,
      startDate,
      endDate,
      search,
    });

    res.json({
      success: true,
      data: overview,
    });
  } catch (error) {
    next(error);
  }
};

const getBatchById = async (req, res, next) => {
  try {
    const batch = await batchService.getBatchById(req.params.batchId);

    res.json({
      success: true,
      data: batch,
    });
  } catch (error) {
    next(error);
  }
};

const updateBatch = async (req, res, next) => {
  try {
    const batch = await batchService.updateBatch(req.params.batchId, req.body);

    res.json({
      success: true,
      data: batch,
      message: "Batch updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

const updateBatchStatus = async (req, res, next) => {
  try {
    const batch = await batchService.updateBatchStatus(req.params.batchId, req.body.status);

    res.json({
      success: true,
      data: batch,
      message: "Batch status updated",
    });
  } catch (error) {
    next(error);
  }
};

const deleteBatch = async (req, res, next) => {
  try {
    await batchService.deleteBatch(req.params.batchId);

    res.status(200).json({
      success: true,
      message: "Batch deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

const addCourseToBatch = async (req, res, next) => {
  try {
    const batch = await batchService.addCourseToBatch(req.params.batchId, req.params.courseId);

    res.json({
      success: true,
      data: batch,
      message: "Course added to batch",
    });
  } catch (error) {
    next(error);
  }
};

const removeCourseFromBatch = async (req, res, next) => {
  try {
    const batch = await batchService.removeCourseFromBatch(req.params.batchId, req.params.courseId);

    res.json({
      success: true,
      data: batch,
      message: "Course removed from batch",
    });
  } catch (error) {
    next(error);
  }
};

const getEnrollableStudentsForBatch = async (req, res, next) => {
  try {
    const students = await batchService.getEnrollableStudentsForBatch(req.params.batchId);

    res.json({
      success: true,
      data: students,
    });
  } catch (error) {
    next(error);
  }
};

const addStudentToBatch = async (req, res, next) => {
  try {
    const batch = await batchService.addStudentToBatch(req.params.batchId, req.body.studentId);

    res.status(201).json({
      success: true,
      data: batch,
      message: "Student added to batch",
    });
  } catch (error) {
    next(error);
  }
};

const removeStudentFromBatch = async (req, res, next) => {
  try {
    const batch = await batchService.removeStudentFromBatch(req.params.batchId, req.params.studentId);

    res.json({
      success: true,
      data: batch,
      message: "Student removed from batch",
    });
  } catch (error) {
    next(error);
  }
};

const getBatchDetailDashboard = async (req, res, next) => {
  try {
    const dashboard = await batchService.getBatchDetailDashboard(req.params.batchId);

    res.json({
      success: true,
      data: dashboard,
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
      data: announcements,
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
    const courseId = req.batch.courses[0]?.id;

    const announcement = await announcementService.createAnnouncement({
      courseId,
      instructorId: req.user.id,
      title,
      message,
      batchId,
    });
    await notificationService.notifyEnrolledStudents(courseId, { title, message }, batchId);

    res.status(201).json({
      success: true,
      data: announcement,
      message: "Announcement sent to batch.",
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
      req.user.id,
      req.user.role
    );

    res.status(201).json({
      success: true,
      data: conversation,
      message: "Batch conversation ready",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createBatch,
  listBatches,
  getBatchPerformanceOverview,
  getBatchById,
  updateBatch,
  updateBatchStatus,
  deleteBatch,
  addCourseToBatch,
  removeCourseFromBatch,
  getEnrollableStudentsForBatch,
  addStudentToBatch,
  removeStudentFromBatch,
  getBatchDetailDashboard,
  getBatchAnnouncements,
  createBatchAnnouncement,
  startBatchConversation,
};
