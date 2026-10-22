const express = require('express');
const router = express.Router();

const progressController = require('./progress.controller');
const verifyToken = require('../../middleware/auth.middleware');
const checkRole = require('../../middleware/role.middleware');
const validate = require('../../middleware/joiValidation.middleware');
const verifyCourseOwnership = require('../../middleware/courseOwnership.middleware');
const { completeContentSchema, completeLessonSchema, markVisitedSchema } = require('./progress.validation');
const requireContentAccess = require('../../middleware/contentAccess.middleware');

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
  requireContentAccess,
  validate(completeContentSchema),
  progressController.markContentComplete
);

router.post(
  '/complete',
  requireContentAccess,
  validate(completeLessonSchema),
  progressController.markLessonComplete
);

router.post(
  '/visit',
  requireContentAccess,
  validate(markVisitedSchema),
  progressController.markVisited
);

// The student's ordered path through a course. A query parameter, not a
// nested path — the path is a view over one course, not a sub-resource of it,
// and keeping it flat leaves /progress/:something free of ambiguity. Declared
// before /courses/:courseId only for readability; the two don't collide.
router.get('/learning-path', requireContentAccess, progressController.getLearningPath);

// The unified learning sequence (Content, Quiz and Assignment steps in one
// order) the player, the Course Map and resume all read.
router.get('/learning-sequence', requireContentAccess, progressController.getLearningSequence);

// Per-course progress summary — course content; gated while another device
// holds the playback lease.
router.get('/courses/:courseId', requireContentAccess, progressController.getCourseProgress);

// Overall progress across all enrolled courses — exposes enrolled-course
// content; gated while another device holds the playback lease.
router.get('/', requireContentAccess, progressController.getOverallProgress);

module.exports = router;
