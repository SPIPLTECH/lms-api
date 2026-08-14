const observationService = require("../service/observation.service");
const { extractRequestContext } = require("../utils/requestContext.util");
const { successResponse } = require("../../../utils/response");

/**
 * Controllers stay thin: pull actor/context off the request, delegate to
 * the service, shape the HTTP response. No business logic lives here.
 */

const createEvent = async (req, res, next) => {
  try {
    const event = await observationService.ingestEvent({
      actor: req.observationActor,
      input: req.body,
      requestContext: extractRequestContext(req),
    });

    return successResponse(res, event, "Event recorded", 201);
  } catch (error) {
    next(error);
  }
};

const getEventsByStudent = async (req, res, next) => {
  try {
    const result = await observationService.getEventsByStudent({
      actor: req.observationActor,
      studentId: req.params.studentId,
      filters: req.query,
    });

    return successResponse(res, result, "Events fetched");
  } catch (error) {
    next(error);
  }
};

const getEventsByCourse = async (req, res, next) => {
  try {
    const result = await observationService.getEventsByCourse({
      actor: req.observationActor,
      courseId: req.params.courseId,
      filters: req.query,
    });

    return successResponse(res, result, "Course events fetched");
  } catch (error) {
    next(error);
  }
};

const getEventsBySession = async (req, res, next) => {
  try {
    const result = await observationService.getEventsBySession({
      actor: req.observationActor,
      sessionId: req.params.sessionId,
      filters: req.query,
    });

    return successResponse(res, result, "Session events fetched");
  } catch (error) {
    next(error);
  }
};

const getStatistics = async (req, res, next) => {
  try {
    const result = await observationService.getStatistics({
      actor: req.observationActor,
      studentId: req.query.studentId,
      courseId: req.query.courseId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    return successResponse(res, result, "Statistics fetched");
  } catch (error) {
    next(error);
  }
};

const getToday = async (req, res, next) => {
  try {
    const result = await observationService.getToday({
      actor: req.observationActor,
      studentId: req.query.studentId,
    });

    return successResponse(res, result, "Today's events fetched");
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createEvent,
  getEventsByStudent,
  getEventsByCourse,
  getEventsBySession,
  getStatistics,
  getToday,
};
