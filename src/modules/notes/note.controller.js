const prisma = require("../../config/database");
const noteService = require("./note.service");

const getNotes = async (req, res, next) => {
  try {
    const student = await prisma.studentProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!student) {
      return res.status(404).json({ success: false, message: "Student profile not found" });
    }

    const notes = await noteService.getNotes(student.id, req.query);

    res.json({ success: true, data: notes });
  } catch (error) {
    next(error);
  }
};

const getNoteById = async (req, res, next) => {
  try {
    const student = await prisma.studentProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!student) {
      return res.status(404).json({ success: false, message: "Student profile not found" });
    }

    const note = await noteService.getNoteById(req.params.noteId, student.id);

    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }

    res.json({ success: true, data: note });
  } catch (error) {
    next(error);
  }
};

const createNote = async (req, res, next) => {
  try {
    const student = await prisma.studentProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!student) {
      return res.status(404).json({ success: false, message: "Student profile not found" });
    }

    const note = await noteService.createNote(req.body, student.id);

    res.status(201).json({
      success: true,
      message: "Note created successfully",
      data: note,
    });
  } catch (error) {
    next(error);
  }
};

const updateNote = async (req, res, next) => {
  try {
    const student = await prisma.studentProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!student) {
      return res.status(404).json({ success: false, message: "Student profile not found" });
    }

    const note = await noteService.updateNote(req.params.noteId, student.id, req.body);

    res.json({
      success: true,
      message: "Note updated successfully",
      data: note,
    });
  } catch (error) {
    next(error);
  }
};

const toggleStar = async (req, res, next) => {
  try {
    const student = await prisma.studentProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!student) {
      return res.status(404).json({ success: false, message: "Student profile not found" });
    }

    const note = await noteService.toggleStar(req.params.noteId, student.id);

    res.json({
      success: true,
      message: "Note star toggled",
      data: note,
    });
  } catch (error) {
    next(error);
  }
};

const deleteNote = async (req, res, next) => {
  try {
    const student = await prisma.studentProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!student) {
      return res.status(404).json({ success: false, message: "Student profile not found" });
    }

    await noteService.deleteNote(req.params.noteId, student.id);

    res.json({ success: true, message: "Note deleted successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = { getNotes, getNoteById, createNote, updateNote, toggleStar, deleteNote };
