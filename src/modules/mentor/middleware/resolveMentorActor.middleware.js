const { resolveActor } = require("../context-engine");

/**
 * Resolves req.mentorActor for every mentor route. Unlike every other
 * agent's resolve*Access middleware, this one doesn't gate by role — it
 * just resolves which studentId/instructorId (if any) this user maps to;
 * STUDENT/INSTRUCTOR/ADMIN are all allowed to proceed (see
 * utils/accessControl.util.js for the ownership-based model this module
 * uses instead of role-gating).
 */
const resolveMentorActor = async (req, res, next) => {
  try {
    req.mentorActor = await resolveActor(req.user);
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = resolveMentorActor;
