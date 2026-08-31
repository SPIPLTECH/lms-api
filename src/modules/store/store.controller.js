const storeService = require("./store.service");

const getStoreByCourseId = async (req, res, next) => {
  try {
    const store = await storeService.getStoreByCourseId(req.params.courseId);

    res.json({ success: true, data: store });
  } catch (error) {
    next(error);
  }
};

const setCoursePrice = async (req, res, next) => {
  try {
    const store = await storeService.setCoursePrice(req.params.courseId, req.body);

    res.status(200).json({
      success: true,
      message: "Course price updated successfully",
      data: store,
    });
  } catch (error) {
    next(error);
  }
};

const deleteCoursePrice = async (req, res, next) => {
  try {
    await storeService.deleteCoursePrice(req.params.courseId);

    res.json({ success: true, message: "Course price removed successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = { getStoreByCourseId, setCoursePrice, deleteCoursePrice };
