const multer = require("multer");
const path = require("path");
const fs = require("fs");

// =====================================
// Upload Directory
// =====================================

const uploadDir = path.join(
  __dirname,
  "../../uploads/attachments"
);

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, {
    recursive: true,
  });
}

// =====================================
// Storage
// =====================================

const allowedImportExtensions = [
  ".csv",
  ".xls",
  ".xlsx",
  ".ods",
  ".json",
  ".xml",
  ".txt",
  ".tsv",
  ".pdf",
  ".docx",
];

const forbiddenAttachmentExtensions = [
  ".exe", ".bat", ".cmd", ".sh", ".php", ".js", ".vbs", ".ps1", ".html", ".htm", ".cgi", ".pl", ".py"
];

const attachmentFileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();
  if (forbiddenAttachmentExtensions.includes(extension)) {
    return cb(new Error(`File type ${extension} is not permitted for upload`), false);
  }
  cb(null, true);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const sanitizedOriginal = path.basename(file.originalname).replace(/[^a-zA-Z0-9.-]/g, "_");
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + sanitizedOriginal);
  },
});

const importFileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();
  if (allowedImportExtensions.includes(extension)) {
    return cb(null, true);
  }
  cb(new Error(`Unsupported import file format: ${extension}`), false);
};

const upload = multer({
  storage,
  fileFilter: attachmentFileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});

// =====================================
// Import Upload
// (Question Bank)
// =====================================

const importUpload = multer({

  storage,

  fileFilter:
    importFileFilter,

  limits: {

    fileSize:
      20 * 1024 * 1024,

  },

});

// =====================================
// Attachment Type
// =====================================

const getAttachmentType = (
  mimeType,
  fileName
) => {

  if (!mimeType) {
    return "OTHER";
  }

  if (
    mimeType.startsWith(
      "image/"
    )
  ) {
    return "IMAGE";
  }

  if (
    mimeType.startsWith(
      "video/"
    )
  ) {
    return "VIDEO";
  }

  if (
    mimeType.startsWith(
      "audio/"
    )
  ) {
    return "AUDIO";
  }

  const docExtensions = [

    ".pdf",

    ".docx",

    ".doc",

    ".pptx",

    ".ppt",

    ".xlsx",

    ".xls",

    ".txt",

    ".csv",

    ".json",

    ".xml",

    ".html",

    ".tsv",

    ".ods",

  ];

  const extension =
    path
      .extname(fileName)
      .toLowerCase();

  if (

    docExtensions.includes(
      extension
    ) ||

    mimeType.includes(
      "pdf"
    ) ||

    mimeType.includes(
      "document"
    ) ||

    mimeType.includes(
      "presentation"
    ) ||

    mimeType.includes(
      "sheet"
    ) ||

    mimeType.includes(
      "msword"
    ) ||

    mimeType.includes(
      "excel"
    )

  ) {

    return "DOCUMENT";

  }

  return "OTHER";

};

module.exports = {

  upload,

  importUpload,

  getAttachmentType,

};