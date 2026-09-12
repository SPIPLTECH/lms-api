const prisma = require("../../config/database");

const getInstructorExams = async (instructorId, courseId) => {
  const where = {};
  if (courseId) {
    where.courseId = courseId;
  } else {
    where.course = { creatorId: instructorId };
  }

  return prisma.exam.findMany({
    where,
    include: {
      course: { select: { id: true, title: true } }
    },
    orderBy: { createdAt: "desc" }
  });
};

const getExamById = async (examId) => {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: {
      course: { select: { id: true, title: true } }
    }
  });

  if (!exam) {
    const err = new Error("Test not found.");
    err.statusCode = 404;
    throw err;
  }

  return exam;
};

const createExam = async (data) => {
  return prisma.exam.create({
    data: {
      title: data.title,
      description: data.description || null,
      instructions: data.instructions || null,
      startDate: new Date(data.startDate),
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      duration: data.duration ? parseInt(data.duration) : null,
      courseId: data.courseId,
      isPublished: data.isPublished !== undefined ? data.isPublished : true,
      status: data.status || "SCHEDULED"
    }
  });
};

const updateExam = async (examId, data) => {
  const existing = await prisma.exam.findUnique({ where: { id: examId } });
  if (!existing) {
    const error = new Error("Test not found.");
    error.statusCode = 404;
    throw error;
  }

  return prisma.exam.update({
    where: { id: examId },
    data: {
      title: data.title,
      description: data.description,
      instructions: data.instructions,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      duration: data.duration !== undefined ? parseInt(data.duration) : undefined,
      isPublished: data.isPublished !== undefined ? data.isPublished : undefined,
      status: data.status || undefined
    }
  });
};

const deleteExam = async (examId) => {
  const existing = await prisma.exam.findUnique({ where: { id: examId } });
  if (!existing) {
    const error = new Error("Test not found.");
    error.statusCode = 404;
    throw error;
  }

  return prisma.exam.delete({ where: { id: examId } });
};

module.exports = {
  getInstructorExams,
  getExamById,
  createExam,
  updateExam,
  deleteExam
};
