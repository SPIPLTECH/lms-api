const prisma = require("../../config/database");
const { deviceLabelFrom, toDeviceDto } = require("../sessions/session.service");

/**
 * Devices are issued at sign-in (session.service.createSession hands the
 * browser its key). This only refreshes what is recorded about the current
 * one — last seen, user agent, label — for an authenticated session; it never
 * creates a device or moves a session to another.
 */
async function registerCurrentDevice({ deviceId, userAgent = null, label = null }) {
  const agent = typeof userAgent === "string" ? userAgent.slice(0, 512) : null;
  const device = await prisma.device.update({
    where: { id: deviceId },
    data: {
      lastSeenAt: new Date(),
      ...(agent ? { userAgent: agent } : {}),
      label: label || deviceLabelFrom(agent) || undefined,
    },
  });
  return toDeviceDto(device);
}

module.exports = { registerCurrentDevice };
