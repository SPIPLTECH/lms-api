const prisma = require("../../config/database");
const { getIO } = require("../../socket");

const createNotification = async (userId, data) => {
  const { title, message, type, link, eventId, actorId } = data || {};

  // 0. Nobody is notified about something they did themselves. Callers that
  // know who performed the action pass `actorId`; callers that don't are
  // unaffected, so student-triggered notifications still reach the instructor.
  if (actorId && String(actorId) === String(userId)) {
    return null;
  }

  // 1. If eventId is provided, check if a notification already exists for this (userId, eventId)
  if (eventId) {
    const existing = await prisma.notification.findFirst({
      where: { userId, eventId },
    });
    if (existing) {
      // DO NOT create DB row, DO NOT emit socket event
      return existing;
    }
  }

  // 2. Insert atomically with fallback for potential unique constraint race conditions
  let notification;
  try {
    notification = await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        type,
        link: link || null,
        eventId: eventId || null,
      },
    });
  } catch (err) {
    // If unique constraint error (P2002) occurs on race condition
    if (err.code === "P2002" && eventId) {
      const existing = await prisma.notification.findFirst({
        where: { userId, eventId },
      });
      if (existing) return existing;
    }
    throw err;
  }

  // 3. Emit Real-time Push via Socket.io ONLY when a new record is created
  try {
    const io = getIO();
    io.to(`user_${userId}`).emit("new_notification", notification);
  } catch (error) {
    console.error("Socket error dispatching notification:", error.message);
  }

  return notification;
};

const NOTIFICATION_HISTORY_LIMIT = 50;

const getNotifications = async (userId) => {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: NOTIFICATION_HISTORY_LIMIT,
  });
};

const markAsRead = async (notificationId, userId) => {
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });

  if (!existing) {
    const error = new Error("Notification not found");
    error.statusCode = 404;
    throw error;
  }

  return prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true },
  });
};

const markAllAsRead = async (userId) => {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
};

const clearAll = async (userId) => {
  return prisma.notification.deleteMany({
    where: { userId },
  });
};

const notifyEnrolledStudents = async (courseId, notificationData, batchId = null, eventIdPrefix = null, actorId = null) => {
  try {
    const effectiveActorId = actorId || notificationData?.actorId || null;

    // When a batchId is given, only notify that batch's roster instead of
    // every student enrolled in the course.
    const rawUserIds = batchId
      ? (
          await prisma.batch.findUnique({
            where: { id: batchId },
            select: { students: { select: { userId: true } } },
          })
        )?.students.map((s) => s.userId) || []
      : (
          await prisma.enrollment.findMany({
            where: { courseId },
            include: { student: { select: { userId: true } } },
          })
        )
          .map((e) => e.student?.userId)
          .filter(Boolean);

    const userIds = rawUserIds.filter((id) => !effectiveActorId || String(id) !== String(effectiveActorId));

    for (const userId of userIds) {
      const eventId = eventIdPrefix || notificationData.eventId
        ? `${eventIdPrefix || notificationData.eventId}_${userId}`
        : null;

      await createNotification(userId, {
        title: notificationData.title || "New Announcement 📢",
        message: notificationData.message,
        type: notificationData.type || "ANNOUNCEMENT",
        link: notificationData.link || `/student/dashboard`,
        eventId,
        actorId: effectiveActorId,
      });
    }
  } catch (error) {
    console.error("Failed to notify enrolled students:", error.message);
  }
};

module.exports = {
  createNotification,
  getNotifications,
  markAsRead,
  markAllAsRead,
  clearAll,
  notifyEnrolledStudents,
};
