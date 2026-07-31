const express = require("express");

const router = express.Router();

const userController = require(
  "./user.controller"
);

const verifyToken = require(
  "../../middleware/auth.middleware"
);

const checkRole = require(
  "../../middleware/role.middleware"
);

const validate = require("../../middleware/joiValidation.middleware");
const {
  updateUserSchema,
  updateUserStatusSchema,
  updateUserRoleSchema,
} = require("./user.validation");

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN"]),
  userController.getUsers
);

router.get(
  "/:userId",
  verifyToken,
  checkRole(["ADMIN"]),
  userController.getUserById
);

router.put(
  "/:userId",
  verifyToken,
  checkRole(["ADMIN"]),
  validate(updateUserSchema),
  userController.updateUser
);

router.delete(
  "/:userId",
  verifyToken,
  checkRole(["ADMIN"]),
  userController.deleteUser
);

router.patch(
  "/:userId/status",
  verifyToken,
  checkRole(["ADMIN"]),
  validate(updateUserStatusSchema),
  userController.updateUserStatus
);

router.patch(
  "/:userId/role",
  verifyToken,
  checkRole(["ADMIN"]),
  validate(updateUserRoleSchema),
  userController.updateUserRole
);

router.get(
  "/profile/me",
  verifyToken,
  userController.getMyProfile
);

router.put(
  "/profile/me",
  verifyToken,
  validate(updateUserSchema),
  userController.updateMyProfile
);

module.exports = router;