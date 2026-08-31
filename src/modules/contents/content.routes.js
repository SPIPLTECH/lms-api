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

const verifyTopicOwnership = require(
  "../../middleware/topicOwnership.middleware"
);

const { upload, sanitizeSvgUpload } = require(
  "../../middleware/upload.middleware"
);
const validate = require("../../middleware/joiValidation.middleware");
const {
  createContentSchema,
  updateContentSchema
} = require("./content.validation");

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

router.get(
  "/:contentId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  controller.getContentById
);

router.post(
  "/",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  validate(createContentSchema),
  verifyTopicOwnership.fromBody,
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