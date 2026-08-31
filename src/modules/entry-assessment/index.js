/**
 * AI Student Entry Phase — course-enrollment onboarding assessment.
 * Extracted from the (removed) assessment/student-state agent modules so
 * this feature survives their removal. See backup/ai-agents/ARCHITECTURE.md
 * for the full history. Not one of the 12 removed agents; not part of that
 * backup or its restoration.
 *
 * Mounted in app.js as:
 *   app.use("/assessment/entry", require("./modules/entry-assessment").entryAssessmentRouter);
 *   app.use("/student-state", require("./modules/entry-assessment").courseStateRouter);
 */
const entryAssessmentRouter = require("./routes/entryAssessment.routes");
const courseStateRouter = require("./routes/courseState.routes");
const entryAssessmentService = require("./services/entryAssessment.service");
const studentCourseStateService = require("./services/studentCourseState.service");

module.exports = {
  entryAssessmentRouter,
  courseStateRouter,
  generateForStudent: entryAssessmentService.generateForStudent,
  getEntryAssessment: entryAssessmentService.getEntryAssessment,
  submitEntryAssessment: entryAssessmentService.submitEntryAssessment,
  getResult: entryAssessmentService.getResult,
  initializeCourseState: studentCourseStateService.initializeCourseState,
  getCourseState: studentCourseStateService.getCourseState,
};
