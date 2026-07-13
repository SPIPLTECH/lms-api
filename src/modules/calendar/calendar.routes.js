const express = require("express");
const router = express.Router();

const controller = require("./calendar.controller");
const verifyToken = require("../../middleware/auth.middleware");

router.get(
    "/",
    verifyToken,
    controller.getEvents
);

router.post(
    "/",
    verifyToken,
    controller.createEvent
);

router.delete(
    "/:eventId",
    verifyToken,
    controller.deleteEvent
);

module.exports = router;
