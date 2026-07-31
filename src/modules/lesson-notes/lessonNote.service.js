const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");

const getNotes = async (lessonId, instructorId) => {
  return prisma.instructorLessonNote.findMany({
    where: { lessonId, instructorId },
    orderBy: { createdAt: "desc" }
  });
};

const createNote = async (instructorId, data) => {
  return prisma.instructorLessonNote.create({
    data: {
      instructorId,
      lessonId: data.lessonId,
      content: data.content,
      timestampSeconds: data.timestampSeconds ?? null
    }
  });
};

const findOwnedNote = async (noteId, instructorId) => {
  const note = await prisma.instructorLessonNote.findUnique({ where: { id: noteId } });

  if (!note) {
    throw new ApiError(404, "Lesson note not found");
  }

  if (note.instructorId !== instructorId) {
    throw new ApiError(403, "Forbidden: you do not own this note");
  }

  return note;
};

const updateNote = async (noteId, instructorId, data) => {
  await findOwnedNote(noteId, instructorId);

  return prisma.instructorLessonNote.update({
    where: { id: noteId },
    data: {
      ...(data.content !== undefined ? { content: data.content } : {}),
      ...(data.timestampSeconds !== undefined ? { timestampSeconds: data.timestampSeconds } : {})
    }
  });
};

const deleteNote = async (noteId, instructorId) => {
  await findOwnedNote(noteId, instructorId);
  return prisma.instructorLessonNote.delete({ where: { id: noteId } });
};

module.exports = {
  getNotes,
  createNote,
  updateNote,
  deleteNote
};
