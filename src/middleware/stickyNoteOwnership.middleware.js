const prisma = require("../config/database");

const verifyStickyNoteOwnership = async (
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
        message: "Student profile not found"
      });
    }

    const stickyNote =
      await prisma.stickyNote.findUnique({
        where: {
          id: req.params.stickyNoteId
        }
      });

    if (!stickyNote) {
      return res.status(404).json({
        success: false,
        message: "Sticky note not found"
      });
    }

    if (
      stickyNote.studentId !== student.id
    ) {
      return res.status(403).json({
        success: false,
        message:
          "You are not authorized to perform this action"
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports =
  verifyStickyNoteOwnership;