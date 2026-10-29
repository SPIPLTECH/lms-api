const service = require("./agentContext.service");

/** Mentor front door — public surface (used by ai-assistant). */
module.exports = {
  gatherLearnerContext: service.gatherLearnerContext,
  renderLearnerContext: service.renderLearnerContext,
};
