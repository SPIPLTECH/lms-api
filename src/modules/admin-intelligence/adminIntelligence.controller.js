const service = require("./adminIntelligence.service");

/** GET /admin-intelligence/dashboard (ADMIN) */
const getDashboard = async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.getDashboard() });
  } catch (error) {
    next(error);
  }
};

module.exports = { getDashboard };
