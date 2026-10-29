const express = require("express");

const verifyToken = require("../../middleware/auth.middleware");
const { upload, validateUploadedFileSignature, getAttachmentType } = require("../../middleware/upload.middleware");

const router = express.Router();

/**
 * POST /files/upload
 *
 * Generic authenticated file upload (assignment attachments, instructor
 * notes). Lived at /messages/upload until human-to-human chat was removed;
 * the behaviour and response shape are unchanged.
 */
router.post("/upload", verifyToken, upload.single("file"), validateUploadedFileSignature, (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded." });
    }

    const type = getAttachmentType(req.file.mimetype, req.file.originalname);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const fileUrl = `${baseUrl}/uploads/attachments/${req.file.filename}`;

    return res.status(200).json({
      success: true,
      message: "File uploaded successfully.",
      data: {
        fileName: req.file.originalname,
        fileUrl,
        mimeType: req.file.mimetype,
        size: req.file.size,
        type,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
