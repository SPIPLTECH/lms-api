const observation = require("../../observation");
const studentState = require("../../student-state");
const assessment = require("../../assessment");
const recommendationService = require("../services/recommendation.service");
const { TRIGGER_EVENT_TYPES, RECOMPUTE_DEBOUNCE_MS } = require("../constants");

const TRIGGER_EVENT_TYPE_SET = new Set(TRIGGER_EVENT_TYPES);

// Per-student debounce: several triggers for the same student in quick
// succession (e.g. QUIZ_COMPLETED immediately followed by the resulting
// assessment:updated and student-state:updated) collapse into one
// recompute instead of three.
const pendingTimers = new Map();

const scheduleRecompute = (studentId, reason) => {
  if (!studentId) return;

  const existing = pendingTimers.get(studentId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingTimers.delete(studentId);
    recommendationService.generateForStudent(studentId, reason).catch((error) => {
      console.error(`[recommendation] failed to generate for ${studentId} (trigger: ${reason}):`, error);
    });
  }, RECOMPUTE_DEBOUNCE_MS);

  timer.unref?.();
  pendingTimers.set(studentId, timer);
};

/**
 * Primary trigger: Observation's curated allowlist of significant events
 * (see constants/index.js TRIGGER_EVENT_TYPES) — deliberately not every
 * event, or high-frequency micro-events would trigger constant recompute.
 */
const handleObservationEvent = (event) => {
  if (!TRIGGER_EVENT_TYPE_SET.has(event?.eventType)) return;
  scheduleRecompute(event.studentId, `observation:${event.eventType}`);
};

const handleStudentStateUpdate = (payload) => {
  scheduleRecompute(payload?.studentId, "student-state:updated");
};

const handleAssessmentUpdate = (payload) => {
  scheduleRecompute(payload?.studentId, "assessment:updated");
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
    console.warn("[recommendation] learning-path module not found — skipping that subscription for now");
    return () => {};
  }

  if (!learningPath || typeof learningPath.subscribe !== "function") {
    console.warn("[recommendation] learning-path module exists but has no subscribe() — skipping");
    return () => {};
  }

  return learningPath.subscribe(learningPath.LEARNING_PATH_EVENT_NAMES?.PATH_UPDATED || "learning-path:updated", (payload) => {
    scheduleRecompute(payload?.studentId, "learning-path:updated");
  });
};

const start = () => {
  const unsubscribeObservation = observation.subscribe(observation.OBSERVATION_EVENT_NAMES.EVENT_CREATED, handleObservationEvent);
  console.log("[recommendation] subscribed to observation:event.created");

  const unsubscribeStudentState = studentState.subscribe(studentState.STUDENT_STATE_EVENT_NAMES.STATE_UPDATED, handleStudentStateUpdate);
  console.log("[recommendation] subscribed to student-state:updated");

  const unsubscribeAssessment = assessment.subscribe(assessment.ASSESSMENT_EVENT_NAMES.ASSESSMENT_UPDATED, handleAssessmentUpdate);
  console.log("[recommendation] subscribed to assessment:updated");

  const unsubscribeLearningPath = tryStartLearningPathConsumer();

  return () => {
    unsubscribeObservation();
    unsubscribeStudentState();
    unsubscribeAssessment();
    unsubscribeLearningPath();
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    pendingTimers.clear();
  };
};

module.exports = { start, handleObservationEvent, handleStudentStateUpdate, handleAssessmentUpdate };
