const express = require("express");
const router = express.Router();

const controller = require("./notification.controller");
const verifyToken = require("../../middleware/auth.middleware");

router.get("/", verifyToken, controller.getNotifications);
router.patch("/read-all", verifyToken, controller.markAllAsRead);
router.patch("/:notificationId/read", verifyToken, controller.markAsRead);

module.exports = router;
