const express = require("express");

const verifyToken = require("../../middleware/auth.middleware");
const { isProctoringAvailable } = require("../../config/proctoring");

const router = express.Router();

// Whether the checkbox should be offered at all.
router.get("/config", verifyToken, (req, res) => {
  res.json({ success: true, data: { available: isProctoringAvailable() } });
});

module.exports = router;
