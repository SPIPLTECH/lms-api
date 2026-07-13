const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure upload directory exists
const uploadDir = path.join(__dirname, "../../uploads/attachments");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + "-" + file.originalname);
    },
});

// File upload configuration
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
    },
});

/**
 * Maps mime types and file extensions to database AttachmentType enum.
 * Enum values: IMAGE, VIDEO, DOCUMENT, AUDIO, OTHER
 */
const getAttachmentType = (mimeType, fileName) => {
    if (!mimeType) return "OTHER";
    if (mimeType.startsWith("image/")) return "IMAGE";
    if (mimeType.startsWith("video/")) return "VIDEO";
    if (mimeType.startsWith("audio/")) return "AUDIO";

    const docExtensions = [".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls", ".txt", ".csv"];
    const fileExt = path.extname(fileName).toLowerCase();
    if (
        docExtensions.includes(fileExt) ||
        mimeType.includes("pdf") ||
        mimeType.includes("document") ||
        mimeType.includes("presentation") ||
        mimeType.includes("sheet") ||
        mimeType.includes("msword") ||
        mimeType.includes("excel")
    ) {
        return "DOCUMENT";
    }

    return "OTHER";
};

module.exports = {
    upload,
    getAttachmentType,
};
