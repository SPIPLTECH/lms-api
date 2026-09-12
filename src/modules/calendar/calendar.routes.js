const express = require("express");
const router = express.Router();

const controller = require("./calendar.controller");
const verifyToken = require("../../middleware/auth.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { createEventSchema } = require("./calendar.validation");

router.get(
    "/",
    verifyToken,
    controller.getEvents
);

router.post(
    "/",
    verifyToken,
    validate(createEventSchema),
    controller.createEvent
);

router.delete(
    "/:eventId",
    verifyToken,
    controller.deleteEvent
);

module.exports = router;
