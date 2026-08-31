const prisma = require("../../config/database");
const stickyNoteService = require("./sticky-note.service");

const getStickyNotes = async (
  req,
  res,
  next
) => {
  try {
    const student =
      await prisma.studentProfile.findUnique({
        where: {
          userId: req.user.id
        }
      });

    if (!student) {
      return res.status(404).json({
        success: false,
        message:
          "Student profile not found"
      });
    }

    const stickyNotes =
      await stickyNoteService.getStickyNotes(
        student.id,
        req.query.lessonId
      );

    res.json({
      success: true,
      data: stickyNotes
    });
  } catch (error) {
    next(error);
  }
};

const getStickyNoteById = async (
  req,
  res,
  next
) => {
  try {
    const stickyNote =
      await stickyNoteService.getStickyNoteById(
        req.params.stickyNoteId
      );

    if (!stickyNote) {
      return res.status(404).json({
        success: false,
        message:
          "Sticky note not found"
      });
    }

    res.json({
      success: true,
      data: stickyNote
    });
  } catch (error) {
    next(error);
  }
};

const createStickyNote = async (
  req,
  res,
  next
) => {
  try {
    const student =
      await prisma.studentProfile.findUnique({
        where: {
          userId: req.user.id
        }
      });

    if (!student) {
      return res.status(404).json({
        success: false,
        message:
          "Student profile not found"
      });
    }

    const stickyNote =
      await stickyNoteService.createStickyNote(
        req.body,
        student.id
      );

    res.status(201).json({
      success: true,
      message:
        "Sticky note created successfully",
      data: stickyNote
    });
  } catch (error) {
    next(error);
  }
};

const updateStickyNote = async (
  req,
  res,
  next
) => {
  try {
    const stickyNote =
      await stickyNoteService.updateStickyNote(
        req.params.stickyNoteId,
        req.body
      );

    res.json({
      success: true,
      message:
        "Sticky note updated successfully",
      data: stickyNote
    });
  } catch (error) {
    next(error);
  }
};

const deleteStickyNote = async (
  req,
  res,
  next
) => {
  try {
    await stickyNoteService.deleteStickyNote(
      req.params.stickyNoteId
    );

    res.json({
      success: true,
      message:
        "Sticky note deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};

const togglePin = async (
  req,
  res,
  next
) => {
  try {
    const stickyNote =
      await stickyNoteService.togglePin(
        req.params.stickyNoteId
      );

    res.json({
      success: true,
      message:
        "Sticky note updated successfully",
      data: stickyNote
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getStickyNotes,
  getStickyNoteById,
  createStickyNote,
  updateStickyNote,
  deleteStickyNote,
  togglePin
};