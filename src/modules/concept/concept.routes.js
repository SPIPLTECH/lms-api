const express = require("express");

const router = express.Router();

const conceptController = require("./concept.controller");

const verifyToken = require("../../middleware/auth.middleware");

const checkRole = require("../../middleware/role.middleware");

const verifyConceptOwnership = require("../../middleware/conceptOwnership.middleware");
const verifySubTopicOwnership = require("../../middleware/subTopicOwnership.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const {
  createConceptSchema,
  updateConceptSchema,
  reorderConceptsSchema,
} = require("./concept.validation");

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  conceptController.getConcepts
);

// Must stay above GET /:conceptId, which would otherwise capture "reorder".
router.patch(
  "/reorder",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(reorderConceptsSchema),
  verifySubTopicOwnership.fromBody,
  conceptController.reorderConcepts
);

router.get(
  "/:conceptId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  conceptController.getConceptById
);

router.post(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(createConceptSchema),
  verifySubTopicOwnership.fromBody,
  conceptController.createConcept
);

router.put(
  "/:conceptId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyConceptOwnership,
  validate(updateConceptSchema),
  conceptController.updateConcept
);

router.delete(
  "/:conceptId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyConceptOwnership,
  conceptController.deleteConcept
);

module.exports = router;
