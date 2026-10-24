const express = require("express");
const router = express.Router();

const sessionController = require("../sessions/session.controller");

const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

// Protect all admin routes
router.use(verifyToken);
router.use(checkRole("ADMIN"));

/* Session Management — explicit, audited; ordinary sign-in never ends
   another device's session. */
router.get(
  "/users/:id/sessions",
  sessionController.listUserSessions
);

router.post(
  "/sessions/:id/revoke",
  sessionController.revokeSession
);

module.exports = router;
