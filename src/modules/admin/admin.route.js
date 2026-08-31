const express = require("express");
const router = express.Router();

const adminController = require("./admin.controller");

const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

const {
  createAdminSchema,
  updateUserSchema,
  updateUserStatusSchema
} = require("./admin.validation");

const validate = require("../../middleware/joiValidation.middleware");
// Protect all admin routes
router.use(verifyToken);
router.use(checkRole("ADMIN"));

/* Dashboard */
router.get(
  "/dashboard",
  adminController.getDashboardStats
);

/* User Management */
router.get(
  "/users",
  adminController.getUsers
);

router.get(
  "/users/:id",
  adminController.getUserById
);

router.patch(
  "/users/:id",
  validate(updateUserSchema),
  adminController.updateUser
);

router.patch(
  "/users/:id/status",
  validate(updateUserStatusSchema),
  adminController.updateUserStatus
);

router.delete(
  "/users/:id",
  adminController.deleteUser
);

/* Admin Management */
router.post(
  "/create-admin",
  validate(createAdminSchema),
  adminController.createAdmin
);

router.get(
  "/admins",
  adminController.getAdmins
);

/* Course Management */
router.get(
  "/courses",
  adminController.getCourses
);

router.patch(
  "/courses/:id/publish",
  adminController.publishCourse
);

router.patch(
  "/courses/:id/archive",
  adminController.archiveCourse
);

router.delete(
  "/courses/:id",
  adminController.deleteCourse
);

/* Teacher Management */
router.get(
  "/teachers",
  adminController.getTeachers
);

router.get(
  "/teachers/:id",
  adminController.getTeacherById
);

/* Monitoring */
router.get(
  "/enrollments",
  adminController.getEnrollments
);

router.get(
  "/reviews",
  adminController.getReviews
);

router.delete(
    "/reviews/:id",
    adminController.deleteReview
);

router.get(
  "/certificates",
  adminController.getCertificates
);

/* Reports */
router.get(
  "/reports",
  adminController.getReports
);

module.exports = router;