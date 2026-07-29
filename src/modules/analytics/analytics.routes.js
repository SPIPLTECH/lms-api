const express = require("express");
const router = express.Router();
const analyticsController = require("./analytics.controller");
const authMiddleware = require("../../middleware/auth.middleware");

router.post("/video-ping", authMiddleware, analyticsController.pingVideoProgress);

module.exports = router;
