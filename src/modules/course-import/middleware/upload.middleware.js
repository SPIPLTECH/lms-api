const multer = require("multer");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Ephemeral staging for the raw uploaded zip only (deleted right after
// extraction in courseImporter.service.js#createJob) — kept out of the
// permanent uploads/ tree, same "ephemeral, not kept" precedent as
// question.import.service.js's temp file.
const tempDir = path.join(os.tmpdir(), "course-import-uploads");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`),
});

const zipFileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();
  if (extension === ".zip") return cb(null, true);
  cb(new Error("Only .zip course packages are supported."), false);
};

// No fileSize limit — course packages are accepted regardless of size.
const packageUpload = multer({
  storage,
  fileFilter: zipFileFilter,
});

// Memory storage for JSON file imports
const memoryStorage = multer.memoryStorage();
const jsonUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max JSON size
});

module.exports = { packageUpload, jsonUpload };
