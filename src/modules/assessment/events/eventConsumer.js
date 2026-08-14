const observation = require("../../observation");
const studentState = require("../../student-state");
const assessmentService = require("../services/assessment.service");

/**
 * Primary trigger: every observed event. The pipeline itself filters to
 * evaluative types (QUIZ_COMPLETED, ASSIGNMENT_SUBMITTED, ...) and to
 * events with usable payload data — subscribing to everything here and
 * filtering downstream keeps this file trivial and the filter defined in
 * exactly one place (constants/index.js EVALUATIVE_EVENT_TYPES).
 */
const handleObservationEvent = async (event) => {
  try {
    await assessmentService.evaluate(event);
  } catch (error) {
    console.error(`[assessment] failed to evaluate event ${event?.id}:`, error);
  }
};

/**
 * Secondary trigger: Student State's aggregate updated. Only dropout-risk
 * escalation matters here (see assessment.service.reconcileRiskEscalation)
 * — everything else about Student State's update is irrelevant to this
 * agent's job.
 */
const handleStudentStateUpdate = async (payload) => {
  try {
    await assessmentService.reconcileRiskEscalation(payload.studentId);
  } catch (error) {
    console.error(`[assessment] failed to reconcile risk for ${payload?.studentId}:`, error);
  }
};

/**
 * Tertiary trigger: Learning Path Agent — not built yet in this codebase.
 * Wired defensively so the moment it exists, this subscribes with zero
 * changes here; until then it logs once and does nothing. See module
 * README (index.js) for the expected contract once it's built.
 */
const tryStartLearningPathConsumer = () => {
  let learningPath;
  try {
    learningPath = require("../../learning-path");
  } catch (error) {
    console.warn("[assessment] learning-path module not found — skipping that subscription for now");
    return () => {};
  }

  if (!learningPath || typeof learningPath.subscribe !== "function") {
    console.warn("[assessment] learning-path module exists but has no subscribe() — skipping");
    return () => {};
  }

  // Contract assumed once Learning Path exists: an event carrying at
  // least { studentId }. Re-runs the same risk-style reconciliation path
  // as Student State until Learning Path's actual needs are known.
  return learningPath.subscribe(learningPath.LEARNING_PATH_EVENT_NAMES?.PATH_UPDATED || "learning-path:updated", async (payload) => {
    try {
      if (payload?.studentId) {
        await assessmentService.reconcileRiskEscalation(payload.studentId);
      }
    } catch (error) {
      console.error("[assessment] failed to reconcile on learning-path update:", error);
    }
  });
};

const start = () => {
  const unsubscribeObservation = observation.subscribe(
    observation.OBSERVATION_EVENT_NAMES.EVENT_CREATED,
    handleObservationEvent
  );
  console.log("[assessment] subscribed to observation:event.created");

  const unsubscribeStudentState = studentState.subscribe(
    studentState.STUDENT_STATE_EVENT_NAMES.STATE_UPDATED,
    handleStudentStateUpdate
  );
  console.log("[assessment] subscribed to student-state:updated");

  const unsubscribeLearningPath = tryStartLearningPathConsumer();

  return () => {
    unsubscribeObservation();
    unsubscribeStudentState();
    unsubscribeLearningPath();
  };
};

module.exports = { start, handleObservationEvent, handleStudentStateUpdate };
