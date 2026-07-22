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

const storage = multer.diskStorage({

  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {

    const uniqueSuffix =
      Date.now() +
      "-" +
      Math.round(
        Math.random() * 1e9
      );

    cb(
      null,
      uniqueSuffix +
        "-" +
        file.originalname
    );

  },

});

// =====================================
// Allowed Import File Extensions
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

  ".html",

  ".pdf",

  ".docx",

];

// =====================================
// Import File Filter
// =====================================

const importFileFilter = (
  req,
  file,
  cb
) => {

  const extension =
    path
      .extname(file.originalname)
      .toLowerCase();

  if (
    allowedImportExtensions.includes(
      extension
    )
  ) {

    return cb(
      null,
      true
    );

  }

  cb(
    new Error(
      `Unsupported import file: ${extension}`
    ),
    false
  );

};

// =====================================
// Default Upload
// (Attachments)
// =====================================

const upload = multer({

  storage,

  limits: {

    fileSize:
      50 * 1024 * 1024,

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