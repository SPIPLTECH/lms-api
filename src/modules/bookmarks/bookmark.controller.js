const prisma = require("../../config/database");
const bookmarkService = require("./bookmark.service");

const getBookmarks = async (req, res, next) => {
  try {
    const student = await prisma.studentProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student profile not found" });
    }

    const bookmarks = await bookmarkService.getBookmarks(student.id, req.query);

    res.json({ success: true, data: bookmarks });
  } catch (error) {
    next(error);
  }
};

const createBookmark = async (req, res, next) => {
  try {
    const student = await prisma.studentProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student profile not found" });
    }

    const bookmark = await bookmarkService.createBookmark(req.body, student.id);

    res.status(201).json({
      success: true,
      message: "Bookmark saved successfully",
      data: bookmark,
    });
  } catch (error) {
    next(error);
  }
};

const deleteBookmark = async (req, res, next) => {
  try {
    const student = await prisma.studentProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student profile not found" });
    }

    await bookmarkService.deleteBookmark(req.params.bookmarkId, student.id);

    res.json({ success: true, message: "Bookmark removed successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = { getBookmarks, createBookmark, deleteBookmark };
