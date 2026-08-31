const prisma = require("../../config/database");

const getNotes = async (studentId, query = {}) => {
  const where = { studentId };

  if (query.category) {
    where.category = query.category;
  }

  if (query.starred === "true") {
    where.starred = true;
  }

  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: "insensitive" } },
      { content: { contains: query.search, mode: "insensitive" } },
    ];
  }

  return prisma.note.findMany({
    where,
    orderBy: [
      { starred: "desc" },
      { updatedAt: "desc" },
    ],
  });
};

const getNoteById = async (noteId, studentId) => {
  return prisma.note.findFirst({
    where: { id: noteId, studentId },
  });
};

const createNote = async (data, studentId) => {
  return prisma.note.create({
    data: {
      title: data.title,
      content: data.content,
      category: data.category || "General",
      studentId,
    },
  });
};

const updateNote = async (noteId, studentId, data) => {
  const note = await prisma.note.findFirst({
    where: { id: noteId, studentId },
  });

  if (!note) {
    const error = new Error("Note not found or access denied");
    error.statusCode = 404;
    throw error;
  }

  return prisma.note.update({
    where: { id: noteId },
    data: {
      title: data.title !== undefined ? data.title : note.title,
      content: data.content !== undefined ? data.content : note.content,
      category: data.category !== undefined ? data.category : note.category,
    },
  });
};

const toggleStar = async (noteId, studentId) => {
  const note = await prisma.note.findFirst({
    where: { id: noteId, studentId },
  });

  if (!note) {
    const error = new Error("Note not found or access denied");
    error.statusCode = 404;
    throw error;
  }

  return prisma.note.update({
    where: { id: noteId },
    data: { starred: !note.starred },
  });
};

const deleteNote = async (noteId, studentId) => {
  const note = await prisma.note.findFirst({
    where: { id: noteId, studentId },
  });

  if (!note) {
    const error = new Error("Note not found or access denied");
    error.statusCode = 404;
    throw error;
  }

  return prisma.note.delete({ where: { id: noteId } });
};

module.exports = { getNotes, getNoteById, createNote, updateNote, toggleStar, deleteNote };
