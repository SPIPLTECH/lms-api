const express = require("express");
const path = require("path");

const router = express.Router();

const controller = require(
  "./content.controller"
);

const verifyToken = require(
  "../../middleware/auth.middleware"
);

const checkRole = require(
  "../../middleware/role.middleware"
);

const verifyContentOwnership = require(
  "../../middleware/contentOwnership.middleware"
);

const verifyContentParentOwnership = require(
  "../../middleware/contentParentOwnership.middleware"
);

const { upload, sanitizeSvgUpload } = require(
  "../../middleware/upload.middleware"
);
const validate = require("../../middleware/joiValidation.middleware");
const {
  createContentSchema,
  updateContentSchema
} = require("./content.validation");
// Same PDF-only rules as an Assignment-model submission.
const {
  submitAssignmentSchema,
  gradeSubmissionSchema
} = require("../assignments/assignment.validation");

// File upload endpoint for DOCUMENT / PRESENTATION content
router.post(
  "/upload-file",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  upload.single("file"),
  sanitizeSvgUpload,
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded."
      });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const relativePath = req.file.path
      .replace(/\\/g, "/")
      .split("uploads/")[1];

    const fileUrl = `${baseUrl}/uploads/${relativePath}`;

    return res.status(200).json({
      success: true,
      fileUrl,
      originalName: req.file.originalname,
      size: req.file.size,
    });
  }
);

router.patch(
  "/reorder",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  controller.reorderContents
);

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  controller.getContents
);

// Instructor: every ASSIGNMENT content block in their own courses. Must stay
// above GET /:contentId, which would otherwise capture "assignments".
router.get(
  "/assignments",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  controller.getAssignmentContents
);

// Instructor: student submissions for one ASSIGNMENT content block they own.
router.get(
  "/:contentId/submissions",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyContentOwnership,
  controller.getContentSubmissions
);

// Instructor: grade one student submission for an ASSIGNMENT content block.
router.patch(
  "/:contentId/submissions/:submissionId/grade",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyContentOwnership,
  validate(gradeSubmissionSchema),
  controller.gradeContentSubmission
);

router.get(
  "/:contentId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  controller.getContentById
);

// Student submission for an ASSIGNMENT content block (lesson-composer
// assignment). Enrollment and content type are checked in the service.
router.get(
  "/:contentId/submission",
  verifyToken,
  checkRole(["STUDENT"]),
  controller.getMySubmission
);

router.post(
  "/:contentId/submit",
  verifyToken,
  checkRole(["STUDENT"]),
  validate(submitAssignmentSchema),
  controller.submitContent
);

router.post(
  "/",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  validate(createContentSchema),
  verifyContentParentOwnership.fromBody,
  controller.createContent
);

router.put(
  "/:contentId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyContentOwnership,
  validate(updateContentSchema),
  controller.updateContent
);

router.delete(
  "/:contentId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyContentOwnership,
  controller.deleteContent
);

module.exports = router;