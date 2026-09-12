const express = require('express');
const router = express.Router();

const progressController = require('./progress.controller');
const verifyToken = require('../../middleware/auth.middleware');
const checkRole = require('../../middleware/role.middleware');
const validate = require('../../middleware/joiValidation.middleware');
const verifyCourseOwnership = require('../../middleware/courseOwnership.middleware');
const { completeContentSchema, completeLessonSchema, markVisitedSchema } = require('./progress.validation');

router.use(verifyToken);

// Ownership check is required in addition to the role check: without it any
// INSTRUCTOR could read every student's progress in a course they don't own.
router.get(
  '/instructor/courses/:courseId',
  checkRole(['INSTRUCTOR', 'ADMIN']),
  verifyCourseOwnership,
  progressController.getInstructorProgress
);

router.post(
  '/content-complete',
  validate(completeContentSchema),
  progressController.markContentComplete
);

router.post(
  '/complete',
  validate(completeLessonSchema),
  progressController.markLessonComplete
);

router.post(
  '/visit',
  validate(markVisitedSchema),
  progressController.markVisited
);

router.get('/courses/:courseId', progressController.getCourseProgress);

router.get('/', progressController.getOverallProgress);

module.exports = router;
