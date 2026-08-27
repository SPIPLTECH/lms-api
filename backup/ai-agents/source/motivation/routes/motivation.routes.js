const express = require("express");
const router = express.Router();

const verifyToken = require("../../../middleware/auth.middleware");
const validate = require("../../../middleware/joiValidation.middleware");

const resolveStudentAccess = require("../middleware/resolveStudentAccess.middleware");
const validateQuery = require("../middleware/validateQuery.middleware");

const controller = require("../controllers/motivation.controller");
const {
  studentIdQuerySchema,
  actionsQuerySchema,
  historyQuerySchema,
  recalculateBodySchema,
  acknowledgeBodySchema,
} = require("../validators/motivation.validator");

router.use(verifyToken, resolveStudentAccess);

// Literal routes MUST be registered before the /:studentId catch-all below,
// or e.g. "/reminders" would be swallowed as :studentId="reminders".
router.get("/reminders", validateQuery(studentIdQuerySchema), controller.getReminders);
router.get("/streak", validateQuery(studentIdQuerySchema), controller.getStreak);
router.get("/actions", validateQuery(actionsQuerySchema), controller.getActions);
router.get("/history", validateQuery(historyQuerySchema), controller.getHistory);

router.post("/recalculate", validate(recalculateBodySchema), controller.recalculate);
router.post("/acknowledge", validate(acknowledgeBodySchema), controller.acknowledge);

router.get("/:studentId", controller.getById);

module.exports = router;
