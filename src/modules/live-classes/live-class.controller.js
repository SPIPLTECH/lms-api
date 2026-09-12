const liveClassService = require("./live-class.service");

const getLiveClasses = async (req, res, next) => {
  try {
    const liveClasses = await liveClassService.getLiveClasses(req.query);
    res.json({ success: true, data: liveClasses });
  } catch (error) {
    next(error);
  }
};

const getLiveClassById = async (req, res, next) => {
  try {
    const liveClass = await liveClassService.getLiveClassById(req.params.liveClassId);

    if (!liveClass) {
      return res.status(404).json({ success: false, message: "Live class not found" });
    }

    res.json({ success: true, data: liveClass });
  } catch (error) {
    next(error);
  }
};

const createLiveClass = async (req, res, next) => {
  try {
    const liveClass = await liveClassService.createLiveClass({
      ...req.body,
      instructorId: req.user.id,
    });

    res.status(201).json({
      success: true,
      message: "Live class scheduled successfully",
      data: liveClass,
    });
  } catch (error) {
    next(error);
  }
};

const updateLiveClass = async (req, res, next) => {
  try {
    const liveClass = await liveClassService.updateLiveClass(
      req.params.liveClassId,
      req.body
    );

    res.json({
      success: true,
      message: "Live class updated successfully",
      data: liveClass,
    });
  } catch (error) {
    next(error);
  }
};

const updateStatus = async (req, res, next) => {
  try {
    const liveClass = await liveClassService.updateStatus(
      req.params.liveClassId,
      req.body.status
    );

    res.json({
      success: true,
      message: "Live class status updated",
      data: liveClass,
    });
  } catch (error) {
    next(error);
  }
};

const deleteLiveClass = async (req, res, next) => {
  try {
    await liveClassService.deleteLiveClass(req.params.liveClassId);
    res.json({ success: true, message: "Live class deleted successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLiveClasses,
  getLiveClassById,
  createLiveClass,
  updateLiveClass,
  updateStatus,
  deleteLiveClass,
};
