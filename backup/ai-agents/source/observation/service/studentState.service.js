const studentActivityStateRepository = require("../repository/studentActivityState.repository");

/**
 * Single responsibility: keep StudentActivityState in sync with the
 * activity log. Deliberately does not compute streaks, engagement scores,
 * or any interpretive metric — that analysis belongs to a future Analytics
 * or Motivation Agent that reads LearningEvent + this state, not to the
 * Observation Agent itself.
 */
const updateStateFromEvent = async (event) => {
  const previousState = await studentActivityStateRepository.findByStudent(event.studentId);
  const isNewSession = !previousState || previousState.lastSessionId !== event.sessionId;

  return studentActivityStateRepository.upsertFromEvent({
    studentId: event.studentId,
    event,
    isNewSession,
  });
};

module.exports = { updateStateFromEvent };
