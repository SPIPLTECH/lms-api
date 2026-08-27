const studentState = require("../../student-state");
const recommendation = require("../../recommendation");
const motivationService = require("../services/motivation.service");
const { RECOMPUTE_DEBOUNCE_MS } = require("../constants");

// Per-student debounce: Student State and Recommendation updates for the
// same student often land within milliseconds of each other (both react to
// the same underlying learning event) — collapse into one recompute.
const pendingTimers = new Map();

const scheduleRecompute = (studentId, reason) => {
  if (!studentId) return;

  const existing = pendingTimers.get(studentId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingTimers.delete(studentId);
    motivationService.generateForStudent(studentId, reason).catch((error) => {
      console.error(`[motivation] failed to generate for ${studentId} (trigger: ${reason}):`, error);
    });
  }, RECOMPUTE_DEBOUNCE_MS);

  timer.unref?.();
  pendingTimers.set(studentId, timer);
};

const handleStudentStateUpdate = (payload) => {
  scheduleRecompute(payload?.studentId, "student-state:updated");
};

const handleRecommendationUpdate = (payload) => {
  scheduleRecompute(payload?.studentId, "recommendation:updated");
};

/**
 * Learning Path Agent — not built yet in this codebase. Wired defensively
 * so the moment it exists, this subscribes with zero changes here.
 */
const tryStartLearningPathConsumer = () => {
  let learningPath;
  try {
    learningPath = require("../../learning-path");
  } catch (error) {
    console.warn("[motivation] learning-path module not found — skipping that subscription for now");
    return () => {};
  }

  if (!learningPath || typeof learningPath.subscribe !== "function") {
    console.warn("[motivation] learning-path module exists but has no subscribe() — skipping");
    return () => {};
  }

  return learningPath.subscribe(learningPath.LEARNING_PATH_EVENT_NAMES?.PATH_UPDATED || "learning-path:updated", (payload) => {
    scheduleRecompute(payload?.studentId, "learning-path:updated");
  });
};

const start = () => {
  const unsubscribeStudentState = studentState.subscribe(studentState.STUDENT_STATE_EVENT_NAMES.STATE_UPDATED, handleStudentStateUpdate);
  console.log("[motivation] subscribed to student-state:updated");

  const unsubscribeRecommendation = recommendation.subscribe(
    recommendation.RECOMMENDATION_EVENT_NAMES.RECOMMENDATION_UPDATED,
    handleRecommendationUpdate
  );
  console.log("[motivation] subscribed to recommendation:updated");

  const unsubscribeLearningPath = tryStartLearningPathConsumer();

  return () => {
    unsubscribeStudentState();
    unsubscribeRecommendation();
    unsubscribeLearningPath();
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    pendingTimers.clear();
  };
};

module.exports = { start, handleStudentStateUpdate, handleRecommendationUpdate };
