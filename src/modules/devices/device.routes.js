const express = require("express");
const Joi = require("joi");

const router = express.Router();

const verifyToken = require("../../middleware/auth.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { deviceRegisterRateLimiter } = require("../../middleware/rateLimit.middleware");
const deviceService = require("./device.service");

const registerDeviceSchema = Joi.object({
  label: Joi.string().trim().max(80).optional().allow(null, ""),
});

/**
 * POST /devices/register — refresh the current server-issued device's
 * record. The device is the one the caller's session is bound to.
 */
router.post(
  "/register",
  verifyToken,
  deviceRegisterRateLimiter,
  validate(registerDeviceSchema),
  async (req, res, next) => {
    try {
      const data = await deviceService.registerCurrentDevice({
        deviceId: req.user.deviceId,
        userAgent: req.get("user-agent"),
        label: req.body?.label || null,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
