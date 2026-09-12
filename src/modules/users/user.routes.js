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
const { avatarUpload } = require("../../middleware/upload.middleware");

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN"]),
  userController.getUsers
);

// Registered before the /:userId routes below — otherwise Express would
// match "/profile/me" as "/:userId" with userId="profile" and gate it
// behind ADMIN-only access, making these self-profile routes unreachable.
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

// Also registered ahead of "/:userId" — see the comment above "/profile/me".
router.post(
  "/profile/avatar",
  verifyToken,
  avatarUpload.single("avatar"),
  userController.uploadAvatar
);

router.delete(
  "/profile/avatar",
  verifyToken,
  userController.deleteAvatar
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

module.exports = router;