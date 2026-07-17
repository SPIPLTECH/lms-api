const { getUpcomingTasks } = require("./upcoming-tasks.service");

const getMyUpcomingTasks = async (req, res) => {
  try {
    const userId = req.user.id;
    const tasks = await getUpcomingTasks(userId);
    res.status(200).json({ success: true, data: tasks });
  } catch (error) {
    console.error("Upcoming tasks error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getMyUpcomingTasks };
