const express = require('express');
const router = express.Router();

const progressController = require('./progress.controller');
const verifyToken = require('../../middleware/auth.middleware');
const validate = require('../../middleware/joiValidation.middleware');
const { completeContentSchema, markVisitedSchema } = require('./progress.validation');
const requireContentAccess = require('../../middleware/contentAccess.middleware');

router.use(verifyToken);

router.post(
  '/content-complete',
  requireContentAccess,
  validate(completeContentSchema),
  progressController.markContentComplete
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

module.exports = router;
