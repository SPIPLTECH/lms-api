const express = require("express");
const multer = require("multer");
const ImportController = require("../controllers/ImportController");
const authMiddleware = require("../../../middleware/auth.middleware");
const roleMiddleware = require("../../../middleware/role.middleware");

const router = express.Router();

// Memory storage for ZIP file processing
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max ZIP size
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/zip" || file.mimetype === "application/x-zip-compressed" || file.originalname.endsWith(".zip")) {
      cb(null, true);
    } else {
      cb(new Error("Only .zip files are allowed for course import."));
    }
  },
});

router.use(authMiddleware);
router.use(roleMiddleware(["INSTRUCTOR", "ADMIN"]));

router.post("/validate", upload.single("package"), ImportController.validateZip);
router.post("/process", upload.single("package"), ImportController.importCourse);

module.exports = router;
