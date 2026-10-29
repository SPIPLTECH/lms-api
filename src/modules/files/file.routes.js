const express = require("express");

const verifyToken = require("../../middleware/auth.middleware");
const { upload, sanitizeSvgUpload, getAttachmentType } = require("../../middleware/upload.middleware");
const { uploadToBlob } = require("../../utils/blobStorage");

const router = express.Router();

/**
 * POST /files/upload
 *
 * Generic authenticated file upload (assignment attachments, instructor
 * notes). Lived at /messages/upload until human-to-human chat was removed;
 * the response shape is unchanged. The file is stored in Vercel Blob, so
 * fileUrl is a Blob URL rather than one under this API's /uploads.
 */
router.post("/upload", verifyToken, upload.single("file"), sanitizeSvgUpload, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded." });
    }

    const type = getAttachmentType(req.file.mimetype, req.file.originalname);
    const { url: fileUrl } = await uploadToBlob(req.file, "attachments");

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
