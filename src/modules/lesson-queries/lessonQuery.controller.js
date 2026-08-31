const lessonQueryService = require("./lessonQuery.service");

const getQueries = async (req, res, next) => {
  try {
    const queries = await lessonQueryService.getQueriesForLesson(req.query.lessonId);

    res.json({
      success: true,
      data: queries
    });
  } catch (error) {
    next(error);
  }
};

const getMyQueries = async (req, res, next) => {
  try {
    const { courseId, status, startDate, endDate } = req.query;
    const queries = await lessonQueryService.getQueriesForInstructor(req.user.id, {
      courseId,
      status,
      startDate,
      endDate
    });

    res.json({
      success: true,
      data: queries
    });
  } catch (error) {
    next(error);
  }
};

const createQuery = async (req, res, next) => {
  try {
    const query = await lessonQueryService.createQuery(req.user.id, req.body);

    res.status(201).json({
      success: true,
      data: query
    });
  } catch (error) {
    next(error);
  }
};

const replyToQuery = async (req, res, next) => {
  try {
    const query = await lessonQueryService.replyToQuery(
      req.params.queryId,
      req.user,
      req.body.reply
    );

    res.json({
      success: true,
      data: query
    });
  } catch (error) {
    next(error);
  }
};

const updateStatus = async (req, res, next) => {
  try {
    const query = await lessonQueryService.updateStatus(
      req.params.queryId,
      req.user,
      req.body.status
    );

    res.json({
      success: true,
      data: query
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getQueries,
  getMyQueries,
  createQuery,
  replyToQuery,
  updateStatus
};
