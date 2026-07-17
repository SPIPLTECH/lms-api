const prisma = require("../../config/database");
const { getIO } = require("../../socket");

const notificationsStore = [];

const createNotification = async (userId, data) => {
  try {
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
  } catch (dbError) {
    console.error("Failed to create notification in DB, using mock fallback:", dbError.message);
    const notification = {
      id: `mock-notify-${Date.now()}`,
      userId,
      title: data.title,
      message: data.message,
      type: data.type,
      link: data.link || null,
      isRead: false,
      createdAt: new Date(),
      updatedAt: new Date()
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
  }
};

const getNotifications = async (userId) => {
  try {
    return await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  } catch (error) {
    console.error("Failed to get notifications from DB, using mock fallback:", error.message);
    return notificationsStore
      .filter(n => n.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
};

const markAsRead = async (notificationId, userId) => {
  try {
    return await prisma.notification.update({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });
  } catch (error) {
    console.error("Failed to mark notification as read in DB, using mock fallback:", error.message);
    const notification = notificationsStore.find(n => n.id === notificationId && n.userId === userId);

    if (!notification) {
      const err = new Error("Notification not found");
      err.statusCode = 404;
      throw err;
    }

    notification.isRead = true;
    return notification;
  }
};

const markAllAsRead = async (userId) => {
  try {
    return await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  } catch (error) {
    console.error("Failed to mark all notifications as read in DB, using mock fallback:", error.message);
    notificationsStore.forEach(n => {
      if (n.userId === userId && !n.isRead) {
        n.isRead = true;
      }
    });
    return { count: notificationsStore.filter(n => n.userId === userId).length };
  }
};

const notifyEnrolledStudents = async (courseId, notificationData) => {
  // No-op fallback
  console.log(`[Notification Fallback] Student notifications bypassed for course ${courseId}`);
};

module.exports = {
  createNotification,
  getNotifications,
  markAsRead,
  markAllAsRead,
  notifyEnrolledStudents,
};
