const prisma = require("../../config/database");

const getLiveClasses = async (query = {}) => {
  const where = {};

  if (query.courseId) {
    where.courseId = query.courseId;
  }

  if (query.status) {
    where.status = query.status;
  }

  // Default: show upcoming + live classes only, unless a specific status is requested
  if (!query.status && !query.all) {
    where.status = { in: ["SCHEDULED", "LIVE"] };
  }

  return prisma.liveClass.findMany({
    where,
    include: {
      course: {
        select: { id: true, title: true, category: true },
      },
    },
    orderBy: { scheduledAt: "asc" },
  });
};

const getLiveClassById = async (liveClassId) => {
  return prisma.liveClass.findUnique({
    where: { id: liveClassId },
    include: {
      course: {
        select: { id: true, title: true, category: true },
      },
    },
  });
};

const createLiveClass = async (data) => {
  return prisma.liveClass.create({
    data: {
      title: data.title,
      topic: data.topic,
      courseId: data.courseId,
      instructorId: data.instructorId,
      scheduledAt: new Date(data.scheduledAt),
      duration: data.duration ? parseInt(data.duration) : null,
      meetingUrl: data.meetingUrl,
    },
    include: {
      course: {
        select: { id: true, title: true },
      },
    },
  });
};

const updateLiveClass = async (liveClassId, data) => {
  const liveClass = await prisma.liveClass.findUnique({
    where: { id: liveClassId },
  });

  if (!liveClass) {
    const error = new Error("Live class not found");
    error.statusCode = 404;
    throw error;
  }

  return prisma.liveClass.update({
    where: { id: liveClassId },
    data: {
      title: data.title !== undefined ? data.title : liveClass.title,
      topic: data.topic !== undefined ? data.topic : liveClass.topic,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : liveClass.scheduledAt,
      duration: data.duration !== undefined ? parseInt(data.duration) : liveClass.duration,
      meetingUrl: data.meetingUrl !== undefined ? data.meetingUrl : liveClass.meetingUrl,
    },
    include: {
      course: { select: { id: true, title: true } },
    },
  });
};

const updateStatus = async (liveClassId, status) => {
  const validStatuses = ["SCHEDULED", "LIVE", "COMPLETED", "CANCELLED"];

  if (!validStatuses.includes(status)) {
    const error = new Error(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  return prisma.liveClass.update({
    where: { id: liveClassId },
    data: { status },
  });
};

const deleteLiveClass = async (liveClassId) => {
  return prisma.liveClass.delete({ where: { id: liveClassId } });
};

module.exports = {
  getLiveClasses,
  getLiveClassById,
  createLiveClass,
  updateLiveClass,
  updateStatus,
  deleteLiveClass,
};
