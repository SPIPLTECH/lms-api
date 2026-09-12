const announcementService = require("./announcement.service");

const getAnnouncements = async (req, res, next) => {
  try {
    const announcements = await announcementService.getAnnouncements(req.user);

    res.json({
      success: true,
      data: announcements
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAnnouncements
};
