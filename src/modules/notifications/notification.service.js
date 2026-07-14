const prisma = require("../../config/database");
const { getIO } = require("../../socket");

const createNotification = async (userId, data) => {
  // Return a mock notification object since the table is missing
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
  // Return safe empty array since the Notification table does not exist in the database
  return [];
};

const markAsRead = async (notificationId, userId) => {
  return { id: notificationId, isRead: true };
};

const markAllAsRead = async (userId) => {
  return { count: 0 };
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
