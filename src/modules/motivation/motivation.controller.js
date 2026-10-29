const service = require("./motivation.service");

/** GET /motivation/me — the signed-in student's streak and nudges. */
const getMine = async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.getMyMotivation(req.user) });
  } catch (error) {
    next(error);
  }
};

/** POST /motivation/nudges/:id/dismiss */
const dismiss = async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.dismissNudge(req.user, req.params.id) });
  } catch (error) {
    next(error);
  }
};

module.exports = { getMine, dismiss };
