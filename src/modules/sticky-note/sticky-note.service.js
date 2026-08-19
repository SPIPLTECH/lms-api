const prisma = require("../../config/database");

const getStickyNotes = async (
  studentId,
  lessonId
) => {
  const where = {
    studentId
  };

  if (lessonId) {
    where.lessonId = lessonId;
  }

  return prisma.stickyNote.findMany({
    where,
    include: {
      lesson: {
        select: {
          id: true,
          title: true
        }
      }
    },
    orderBy: [
      {
        isPinned: "desc"
      },
      {
        createdAt: "desc"
      }
    ]
  });
};

const getStickyNoteById = async (
  stickyNoteId
) => {
  return prisma.stickyNote.findUnique({
    where: {
      id: stickyNoteId
    },
    include: {
      lesson: {
        select: {
          id: true,
          title: true
        }
      },
      student: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      }
    }
  });
};

const createStickyNote = async (
  data,
  studentId
) => {
  const lesson =
    await prisma.lesson.findUnique({
      where: {
        id: data.lessonId
      }
    });

  if (!lesson) {
    throw new Error("Lesson not found");
  }

  return prisma.stickyNote.create({
    data: {
      content: data.content,
      color: data.color,
      timestamp: data.timestamp,
      lessonId: data.lessonId,
      studentId
    },
    include: {
      lesson: {
        select: {
          id: true,
          title: true
        }
      }
    }
  });
};

const updateStickyNote = async (
  stickyNoteId,
  data
) => {
  const existing = await prisma.stickyNote.findUnique({ where: { id: stickyNoteId } });
  if (!existing) {
    const error = new Error("Sticky note not found");
    error.statusCode = 404;
    throw error;
  }

  return prisma.stickyNote.update({
    where: {
      id: stickyNoteId
    },
    data: {
      content: data.content,
      color: data.color,
      timestamp: data.timestamp,
      isPinned: data.isPinned
    },
    include: {
      lesson: {
        select: {
          id: true,
          title: true
        }
      }
    }
  });
};

const deleteStickyNote = async (
  stickyNoteId
) => {
  const existing = await prisma.stickyNote.findUnique({ where: { id: stickyNoteId } });
  if (!existing) {
    const error = new Error("Sticky note not found");
    error.statusCode = 404;
    throw error;
  }

  return prisma.stickyNote.delete({
    where: {
      id: stickyNoteId
    }
  });
};

const togglePin = async (
  stickyNoteId
) => {
  const note =
    await prisma.stickyNote.findUnique({
      where: {
        id: stickyNoteId
      }
    });

  if (!note) {
    throw new Error(
      "Sticky note not found"
    );
  }

  return prisma.stickyNote.update({
    where: {
      id: stickyNoteId
    },
    data: {
      isPinned: !note.isPinned
    }
  });
};

module.exports = {
  getStickyNotes,
  getStickyNoteById,
  createStickyNote,
  updateStickyNote,
  deleteStickyNote,
  togglePin
};