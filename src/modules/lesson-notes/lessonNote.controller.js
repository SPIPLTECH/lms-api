const lessonNoteService = require("./lessonNote.service");

const getNotes = async (req, res, next) => {
  try {
    const notes = await lessonNoteService.getNotes(req.query.lessonId, req.user.id);

    res.json({
      success: true,
      data: notes
    });
  } catch (error) {
    next(error);
  }
};

const createNote = async (req, res, next) => {
  try {
    const note = await lessonNoteService.createNote(req.user.id, req.body);

    res.status(201).json({
      success: true,
      data: note
    });
  } catch (error) {
    next(error);
  }
};

const updateNote = async (req, res, next) => {
  try {
    const note = await lessonNoteService.updateNote(
      req.params.noteId,
      req.user.id,
      req.body
    );

    res.json({
      success: true,
      data: note
    });
  } catch (error) {
    next(error);
  }
};

const deleteNote = async (req, res, next) => {
  try {
    await lessonNoteService.deleteNote(req.params.noteId, req.user.id);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getNotes,
  createNote,
  updateNote,
  deleteNote
};
