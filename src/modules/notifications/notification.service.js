const prisma = require("../../config/database");
const { getIO } = require("../../socket");

const createNotification = async (userId, data) => {
  const notification = await prisma.notification.create({
    data: {
      userId,
      title: data.title,
      message: data.message,
      type: data.type,
      link: data.link || null,
    },
  });

  // Real-time Push via Socket.io
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
  return prisma.notification.update({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
};

const markAllAsRead = async (userId) => {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
};

const notifyEnrolledStudents = async (courseId, notificationData, batchId = null) => {
  try {
    // When a batchId is given, only notify that batch's roster instead of
    // every student enrolled in the course.
    const userIds = batchId
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

    for (const userId of userIds) {
      await createNotification(userId, {
        title: notificationData.title || "New Announcement 📢",
        message: notificationData.message,
        type: "ANNOUNCEMENT",
        link: notificationData.link || `/student/dashboard`,
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
  notifyEnrolledStudents,
};
