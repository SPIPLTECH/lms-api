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

const getNotifications = async (userId) => {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
};

const markAsRead = async (notificationId, userId) => {
  // Ensure the notification belongs to the user
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });

  if (!notification) {
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

const notifyEnrolledStudents = async (courseId, notificationData) => {
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: { courseId },
      include: {
        student: {
          select: {
            userId: true
          }
        }
      }
    });

    const notifications = enrollments.map(e => 
      createNotification(e.student.userId, notificationData)
    );

    await Promise.all(notifications);
  } catch (error) {
    console.error("Error notifying enrolled students:", error.message);
  }
};

module.exports = {
  createNotification,
  getNotifications,
  markAsRead,
  markAllAsRead,
  notifyEnrolledStudents,
};
