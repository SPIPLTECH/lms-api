const express = require("express");
const router = express.Router();

const verifyToken = require("../../../middleware/auth.middleware");
const validate = require("../../../middleware/joiValidation.middleware");

const resolveMentorActor = require("../middleware/resolveMentorActor.middleware");
const validateQuery = require("../middleware/validateQuery.middleware");

const controller = require("../controllers/mentor.controller");
const { chatBodySchema, historyQuerySchema, feedbackBodySchema } = require("../validators/mentor.validator");

/**
 * Not role-gated (unlike every other agent) — STUDENT/INSTRUCTOR/ADMIN can
 * all use the mentor. resolveMentorActor only resolves identity; access
 * control is ownership-based (see utils/accessControl.util.js).
 */
router.use(verifyToken, resolveMentorActor);

router.post("/chat", validate(chatBodySchema), controller.chat);
router.post("/stream", validate(chatBodySchema), controller.stream);
router.get("/history", validateQuery(historyQuerySchema), controller.getHistory);
router.get("/context", controller.getContext);
router.get("/recommendations", controller.getRecommendations);
router.get("/conversation/:id", controller.getConversation);
router.delete("/conversation/:id", controller.deleteConversation);
router.post("/feedback", validate(feedbackBodySchema), controller.submitFeedback);

module.exports = router;
