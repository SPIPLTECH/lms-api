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
  userController.updateUserStatus
);

router.patch(
  "/:userId/role",
  verifyToken,
  checkRole(["ADMIN"]),
  userController.updateUserRole
);

module.exports = router;