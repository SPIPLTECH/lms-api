const Joi = require("joi");

const service = require("./career.service");

const goalSchema = Joi.object({ roleKey: Joi.string().trim().max(100).required() });

/** GET /career/roles — the role catalogue. */
const listRoles = (req, res) => res.json({ success: true, data: service.listRoles() });

/** GET /career/me — readiness for the chosen role, gaps, top matches. */
const getMine = async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.getMyCareer(req.user) });
  } catch (error) {
    next(error);
  }
};

/** PUT /career/goal { roleKey } */
const setGoal = async (req, res, next) => {
  try {
    const { error, value } = goalSchema.validate(req.body ?? {}, { stripUnknown: true });
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    res.json({ success: true, data: await service.setMyGoal(req.user, value.roleKey) });
  } catch (error) {
    next(error);
  }
};

module.exports = { listRoles, getMine, setGoal };
