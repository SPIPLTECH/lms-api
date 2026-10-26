const express = require("express");

const controller = require("./assignmentEvaluation.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const verifyAssignmentOwnership = require("../../middleware/assignmentOwnership.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const {
    rubricSchema,
    previewSchema,
    overrideSchema,
    acceptSchema,
    reEvaluateSchema,
    synonymGroupSchema,
} = require("./assignmentEvaluation.validation");

/**
 * Auto-evaluation for assignments the caller owns. Mounted on /assignments
 * next to the existing assignment routes, so every path is scoped to one
 * assignment and checked with the same ownership rule (ADMIN always passes).
 */
const assignmentRouter = express.Router();
const owner = [verifyToken, checkRole(["INSTRUCTOR", "ADMIN"]), verifyAssignmentOwnership];

assignmentRouter.get("/:assignmentId/rubric", ...owner, controller.getRubric);
assignmentRouter.put("/:assignmentId/rubric", ...owner, validate(rubricSchema), controller.saveRubric);
assignmentRouter.delete("/:assignmentId/rubric", ...owner, controller.deleteRubric);
assignmentRouter.post("/:assignmentId/rubric/preview", ...owner, validate(previewSchema), controller.previewRubric);
assignmentRouter.post("/:assignmentId/evaluate-all", ...owner, controller.evaluateAll);

assignmentRouter.get("/:assignmentId/submissions/:submissionId/evaluation", ...owner, controller.getEvaluation);
assignmentRouter.post("/:assignmentId/submissions/:submissionId/evaluation/accept", ...owner, validate(acceptSchema), controller.accept);
assignmentRouter.post("/:assignmentId/submissions/:submissionId/evaluation/override", ...owner, validate(overrideSchema), controller.override);
assignmentRouter.post("/:assignmentId/submissions/:submissionId/evaluation/re-evaluate", ...owner, validate(reEvaluateSchema), controller.reEvaluate);

/** The synonym dictionary shared by every assignment (a group is removed only by its author or an admin). */
const synonymRouter = express.Router();
const staff = [verifyToken, checkRole(["INSTRUCTOR", "ADMIN"])];

synonymRouter.get("/synonyms", ...staff, controller.listSynonyms);
synonymRouter.post("/synonyms", ...staff, validate(synonymGroupSchema), controller.addSynonymGroup);
synonymRouter.post("/synonyms/starter", ...staff, controller.addStarterSynonyms);
synonymRouter.delete("/synonyms/:groupId", ...staff, controller.removeSynonymGroup);

module.exports = { assignmentRouter, synonymRouter };
