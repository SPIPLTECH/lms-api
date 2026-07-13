const prisma = require("../../config/database");
const { getIO } = require("../../socket");

const notificationsStore = [];

const createNotification = async (userId, data) => {
  const notification = {
    id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    userId,
    title: data.title,
    message: data.message,
    type: data.type,
    link: data.link || null,
    isRead: false,
    createdAt: new Date(),
  };
  notificationsStore.push(notification);

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
  return notificationsStore
    .filter(n => n.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
};

const markAsRead = async (notificationId, userId) => {
  const notification = notificationsStore.find(n => n.id === notificationId && n.userId === userId);

  if (!notification) {
    const error = new Error("Notification not found");
    error.statusCode = 404;
    throw error;
  }

  notification.isRead = true;
  return notification;
};

const markAllAsRead = async (userId) => {
  notificationsStore.forEach(n => {
    if (n.userId === userId && !n.isRead) {
      n.isRead = true;
    }
  });
  return { count: notificationsStore.filter(n => n.userId === userId).length };
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
