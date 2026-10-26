const express = require(
  "express"
);

const router = express.Router();

const controller = require(
  "./course.controller"
);

const verifyToken = require(
  "../../middleware/auth.middleware"
);
const { optionalToken } = require(
  "../../middleware/auth.middleware"
);

const checkRole = require(
  "../../middleware/role.middleware"
);
const { contentAccess } = require("../../middleware/contentAccess.middleware");

const verifyCourseOwnership = require(
  "../../middleware/courseOwnership.middleware"
);
const validate = require("../../middleware/joiValidation.middleware");
const {
  createCourseSchema,
  updateCourseSchema,
  updateCourseStatusSchema,
} = require("./course.validation");
// Public read — optionalToken allows unauthenticated (GUEST) access.
// The service layer already filters: guests/students see only PUBLISHED courses;
// admins/instructors see all. verifyToken is NOT used here because guests
// must be able to browse the course catalogue without a token.
router.get(
  "/",
  optionalToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR",
    "STUDENT",
    "GUEST",
  ]),
  controller.getCourses
);

// Public read — optionalToken allows unauthenticated access for course preview.
// Students/guests only receive PUBLISHED course data; the service enforces this.
router.get(
  "/:courseId",
  optionalToken,
  // The full tree is course content; ?include=meta (title, card data) is not.
  contentAccess({ skip: (req) => req.query.include === "meta" }),
  controller.getCourseById
);

// Public, no token: the marketing site's course summary (card fields, live
// counts, latest reviews). Only PUBLISHED, non-PRIVATE courses; the service
// returns null (404) for anything else.
router.get(
  "/:courseId/marketing",
  controller.getCourseMarketingInfo
);

router.post(
  "/",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  validate(createCourseSchema),
  controller.createCourse
);

router.put(
  "/:courseId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyCourseOwnership,
  validate(updateCourseSchema),
  controller.updateCourse
);

router.post(
  "/:courseId/publish",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyCourseOwnership,
  controller.publishCourse
);

router.post(
  "/:courseId/unpublish",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyCourseOwnership,
  controller.unpublishCourse
);

router.post(
  "/:courseId/restore",
  verifyToken,
  checkRole([
    "ADMIN"
  ]),
  controller.restoreCourse
);

router.patch(
  "/:courseId/status",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyCourseOwnership,
  validate(updateCourseStatusSchema),
  controller.updateStatus
);

router.delete(
  "/:courseId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyCourseOwnership,
  controller.deleteCourse
);

router.patch(
  "/:courseId/view",
  verifyToken,
  checkRole(["INSTRUCTOR"]),
  verifyCourseOwnership,
  controller.trackCourseView
);

module.exports = router;