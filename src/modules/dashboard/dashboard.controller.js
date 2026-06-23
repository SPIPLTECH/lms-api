const dashboardService = require("./dashboard.service");

const getAdminDashboard = async (
  req,
  res,
  next
) => {
  try {
    const data =
      await dashboardService.getAdminDashboard();

    res.json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
};

const getInstructorDashboard = async (
  req,
  res,
  next
) => {
  try {
    const data =
      await dashboardService.getInstructorDashboard(
        req.user.id
      );

    res.json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
};

const getStudentDashboard = async (
  req,
  res,
  next
) => {
  try {
    const data =
      await dashboardService.getStudentDashboard(
        req.user.id
      );

    res.json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAdminDashboard,
  getInstructorDashboard,
  getStudentDashboard
};