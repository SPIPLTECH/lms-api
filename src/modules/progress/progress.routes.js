const express = require('express');
const router = express.Router();

const progressController = require('./progress.controller');
const verifyToken = require('../../middleware/auth.middleware');
const checkRole = require('../../middleware/role.middleware');
const validate = require('../../middleware/joiValidation.middleware');
const { completeContentSchema, completeLessonSchema } = require('./progress.validation');

router.use(verifyToken);

router.get(
  '/instructor/courses/:courseId',
  checkRole(['INSTRUCTOR', 'ADMIN']),
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

router.get('/courses/:courseId', progressController.getCourseProgress);

router.get('/', progressController.getOverallProgress);

module.exports = router;
